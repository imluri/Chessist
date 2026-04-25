#!/usr/bin/env python3
"""
Chessist - Native Messaging Host
Connects to local Stockfish installation for faster analysis.
Keeps Stockfish running between evaluations to preserve hash table.
"""

import sys
import json
import struct
import subprocess
import threading
import os

# Try to find Stockfish in common locations
STOCKFISH_PATHS = [
    # Windows
    r"C:\Program Files\Stockfish\stockfish.exe",
    r"C:\Program Files (x86)\Stockfish\stockfish.exe",
    r"C:\stockfish\stockfish.exe",
    os.path.expanduser(r"~\stockfish\stockfish.exe"),
    # Linux/Mac
    "/usr/bin/stockfish",
    "/usr/local/bin/stockfish",
    "/opt/homebrew/bin/stockfish",
    os.path.expanduser("~/stockfish/stockfish"),
]

stockfish_path = None
stockfish_process = None
output_thread = None
stdout_lock = threading.Lock()
current_eval_fen = None
stop_requested = False
engine_ready = False
analysis_in_progress = False

overlay_process = None  # subprocess handle for chessist_overlay.py
OVERLAY_PORT = 27301
OVERLAY_PING = f'http://127.0.0.1:{OVERLAY_PORT}/ping'


def _overlay_alive():
    try:
        import urllib.request
        urllib.request.urlopen(OVERLAY_PING, timeout=0.5)
        return True
    except Exception:
        return False


def start_overlay(debug=False):
    global overlay_process
    if not debug and ((overlay_process and overlay_process.poll() is None) or _overlay_alive()):
        return  # already running (skip check when restarting in debug mode)
    try:
        host_dir = os.path.dirname(os.path.abspath(__file__))
        # No CREATE_NO_WINDOW in debug mode so the console is visible
        flags = 0 if debug else getattr(subprocess, 'CREATE_NO_WINDOW', 0)

        root   = os.path.dirname(host_dir)
        cs_exe = os.path.join(root, 'overlay', 'bin', 'Release', 'net48', 'ChessistOverlay.exe')

        if not os.path.isfile(cs_exe):
            send_message({"type": "debug", "message": f"Overlay exe not found: {cs_exe}. Run setup.bat to build it."})
            return

        cmd = [cs_exe, '-debug'] if debug else [cs_exe]
        overlay_process = subprocess.Popen(cmd, creationflags=flags)
    except Exception as e:
        send_message({"type": "debug", "message": f"Overlay start failed: {e}"})


def stop_overlay():
    global overlay_process
    if overlay_process and overlay_process.poll() is None:
        try:
            overlay_process.terminate()
        except Exception:
            pass
    overlay_process = None


def find_stockfish():
    """Find Stockfish executable on the system."""
    env_path = os.environ.get("STOCKFISH_PATH")
    if env_path and os.path.isfile(env_path):
        return env_path

    for path in STOCKFISH_PATHS:
        if os.path.isfile(path):
            return path

    import shutil
    path = shutil.which("stockfish")
    if path:
        return path

    return None


def send_message(message):
    """Send a message to the extension (thread-safe)."""
    with stdout_lock:
        try:
            encoded = json.dumps(message).encode('utf-8')
            sys.stdout.buffer.write(struct.pack('I', len(encoded)))
            sys.stdout.buffer.write(encoded)
            sys.stdout.buffer.flush()
        except Exception:
            pass


def read_message():
    """Read a message from the extension."""
    try:
        raw_length = sys.stdin.buffer.read(4)
        if not raw_length:
            return None
        length = struct.unpack('I', raw_length)[0]
        message = sys.stdin.buffer.read(length).decode('utf-8')
        return json.loads(message)
    except Exception:
        return None


def kill_stockfish():
    """Kill the current Stockfish process if running."""
    global stockfish_process, output_thread, engine_ready, analysis_in_progress

    if stockfish_process:
        try:
            stockfish_process.stdin.write("quit\n")
            stockfish_process.stdin.flush()
        except Exception:
            pass

        try:
            stockfish_process.terminate()
            stockfish_process.wait(timeout=1)
        except Exception:
            try:
                stockfish_process.kill()
            except Exception:
                pass

        stockfish_process = None

    output_thread = None
    engine_ready = False
    analysis_in_progress = False


def start_stockfish():
    """Start Stockfish process and initialize UCI."""
    global stockfish_process, output_thread, engine_ready

    if stockfish_process and stockfish_process.poll() is None:
        return True  # Already running

    try:
        stockfish_process = subprocess.Popen(
            [stockfish_path],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            bufsize=1
        )

        # Start output reader thread
        output_thread = threading.Thread(
            target=read_stockfish_output,
            daemon=True
        )
        output_thread.start()

        # Initialize UCI
        stockfish_process.stdin.write("uci\n")
        stockfish_process.stdin.flush()

        return True

    except Exception as e:
        send_message({"type": "error", "message": f"Failed to start Stockfish: {str(e)}"})
        return False


def analyze_position(fen, depth):
    """Analyze a position. Keeps Stockfish running for hash table reuse."""
    global current_eval_fen, stop_requested, analysis_in_progress

    stop_requested = False
    current_eval_fen = fen

    # Ensure Stockfish is running
    if not stockfish_process or stockfish_process.poll() is not None:
        if not start_stockfish():
            return

    # Wait for engine to be ready (with timeout)
    wait_count = 0
    while not engine_ready and wait_count < 50:
        import time
        time.sleep(0.1)
        wait_count += 1

    if not engine_ready:
        send_message({"type": "error", "message": "Engine not ready after timeout"})
        return

    try:
        # Stop any current analysis
        if analysis_in_progress:
            stockfish_process.stdin.write("stop\n")
            stockfish_process.stdin.flush()
            import time
            time.sleep(0.05)  # Brief pause for stop to process

        analysis_in_progress = True

        # Set position and start analysis
        # NOTE: We intentionally DO NOT send ucinewgame to preserve hash table
        send_message({"type": "analyzing", "fen": fen[:50], "depth": depth})
        stockfish_process.stdin.write(f"position fen {fen}\n")
        stockfish_process.stdin.write(f"go depth {depth}\n")
        stockfish_process.stdin.flush()

    except (OSError, BrokenPipeError, IOError) as e:
        # Pipe error - Stockfish process likely crashed, restart it
        send_message({"type": "debug", "message": f"Pipe error, restarting engine: {str(e)}"})
        analysis_in_progress = False
        kill_stockfish()
        # Try to restart and re-analyze
        if start_stockfish():
            # Wait for engine to be ready
            import time
            wait_count = 0
            while not engine_ready and wait_count < 30:
                time.sleep(0.1)
                wait_count += 1
            if engine_ready:
                try:
                    analysis_in_progress = True
                    stockfish_process.stdin.write(f"position fen {fen}\n")
                    stockfish_process.stdin.write(f"go depth {depth}\n")
                    stockfish_process.stdin.flush()
                    send_message({"type": "analyzing", "fen": fen[:50], "depth": depth})
                except Exception:
                    analysis_in_progress = False
                    send_message({"type": "error", "message": "Failed to restart analysis"})
    except Exception as e:
        send_message({"type": "error", "message": f"Analysis error: {str(e)}"})
        analysis_in_progress = False
        kill_stockfish()


def read_stockfish_output():
    """Read output from Stockfish and send to extension."""
    global stop_requested, engine_ready, analysis_in_progress

    # Accumulate MultiPV slots; key = slot index (1-based), value = eval_data
    multipv_slots = {}

    while stockfish_process and stockfish_process.poll() is None:
        try:
            line = stockfish_process.stdout.readline()
            if not line:
                break

            line = line.strip()
            if not line:
                continue

            if line == "uciok":
                # Configure engine
                stockfish_process.stdin.write("setoption name Threads value 4\n")
                stockfish_process.stdin.write("setoption name Hash value 128\n")
                stockfish_process.stdin.write("setoption name MultiPV value 1\n")
                stockfish_process.stdin.write("isready\n")
                stockfish_process.stdin.flush()

            elif line == "readyok":
                if not engine_ready:
                    engine_ready = True
                    send_message({"type": "ready"})

            elif line.startswith("info depth"):
                if stop_requested:
                    continue
                eval_data = parse_info(line)
                if not eval_data or eval_data.get("depth", 0) < 5:
                    continue

                slot = eval_data.get("multipv", 1)
                multipv_slots[slot] = eval_data

                # Only broadcast when slot 1 (the best line) is received.
                # Attach the first move from each slot so the UI can draw
                # alternative arrows for the current position.
                if slot == 1:
                    # Collect best move per slot (all valid moves for this position)
                    multi_pv_moves = []
                    for s in [1, 2, 3]:
                        mv = multipv_slots.get(s, {}).get("bestMove")
                        if mv:
                            multi_pv_moves.append(mv)
                    eval_data["multiPvMoves"] = multi_pv_moves
                    send_message({"type": "eval", "data": eval_data})

            elif line.startswith("bestmove"):
                analysis_in_progress = False
                multipv_slots = {}  # Reset for next position
                if stop_requested:
                    continue
                parts = line.split()
                best_move = parts[1] if len(parts) > 1 else None
                send_message({"type": "bestmove", "move": best_move})

        except Exception as e:
            send_message({"type": "error", "message": f"Output error: {str(e)}"})
            break

    # If we exit the loop, engine has stopped
    engine_ready = False
    analysis_in_progress = False


def parse_info(line):
    """Parse Stockfish info line into evaluation data."""
    data = {}

    # Extract depth
    if "depth " in line:
        try:
            idx = line.index("depth ") + 6
            end = line.index(" ", idx) if " " in line[idx:] else len(line)
            data["depth"] = int(line[idx:end])
        except Exception:
            pass

    # Extract multipv slot index
    if "multipv " in line:
        try:
            idx = line.index("multipv ") + 8
            end = line.index(" ", idx) if " " in line[idx:] else len(line)
            data["multipv"] = int(line[idx:end])
        except Exception:
            pass

    # Extract score
    if "score cp " in line:
        try:
            idx = line.index("score cp ") + 9
            end_idx = idx
            while end_idx < len(line) and (line[end_idx].isdigit() or line[end_idx] == '-'):
                end_idx += 1
            data["cp"] = int(line[idx:end_idx])
        except Exception:
            pass
    elif "score mate " in line:
        try:
            idx = line.index("score mate ") + 11
            end_idx = idx
            while end_idx < len(line) and (line[end_idx].isdigit() or line[end_idx] == '-'):
                end_idx += 1
            data["mate"] = int(line[idx:end_idx])
        except Exception:
            pass

    # Extract PV (Principal Variation)
    if " pv " in line:
        try:
            idx = line.index(" pv ") + 4
            pv_moves = line[idx:].split()
            if pv_moves:
                data["bestMove"] = pv_moves[0]
                data["pv"] = pv_moves
        except Exception:
            pass

    # Extract nps
    if "nps " in line:
        try:
            idx = line.index("nps ") + 4
            end = line.index(" ", idx) if " " in line[idx:] else len(line)
            data["nps"] = int(line[idx:end])
        except Exception:
            pass

    return data if ("cp" in data or "mate" in data) else None


def run_message_loop():
    global stop_requested, analysis_in_progress

    while True:
        try:
            message = read_message()
            if message is None:
                break

            msg_type = message.get("type")

            if msg_type == "evaluate":
                fen = message.get("fen")
                depth = message.get("depth", 18)
                if fen:
                    analyze_position(fen, depth)

            elif msg_type == "stop":
                stop_requested = True
                analysis_in_progress = False
                if stockfish_process and stockfish_process.poll() is None:
                    try:
                        stockfish_process.stdin.write("stop\n")
                        stockfish_process.stdin.flush()
                    except (OSError, BrokenPipeError, IOError):
                        kill_stockfish()
                        start_stockfish()
                    except Exception:
                        pass

            elif msg_type == "reset":
                stop_requested = True
                analysis_in_progress = False
                if stockfish_process and stockfish_process.poll() is None:
                    try:
                        stockfish_process.stdin.write("stop\n")
                        stockfish_process.stdin.write("ucinewgame\n")
                        stockfish_process.stdin.write("isready\n")
                        stockfish_process.stdin.flush()
                        send_message({"type": "debug", "message": "Engine reset (ucinewgame)"})
                    except Exception:
                        kill_stockfish()
                        start_stockfish()
                        send_message({"type": "debug", "message": "Engine reset (restarted)"})
                else:
                    start_stockfish()
                    send_message({"type": "debug", "message": "Engine reset (restarted)"})

            elif msg_type == "set_option":
                name = message.get("name")
                value = message.get("value")
                if name and value is not None and stockfish_process and stockfish_process.poll() is None:
                    try:
                        stockfish_process.stdin.write(f"setoption name {name} value {value}\n")
                        stockfish_process.stdin.flush()
                        send_message({"type": "debug", "message": f"Set option {name} = {value}"})
                    except Exception as e:
                        send_message({"type": "error", "message": f"Failed to set option: {str(e)}"})

            elif msg_type == "start_overlay":
                start_overlay(debug=message.get("debug", False))

            elif msg_type == "stop_overlay":
                stop_overlay()

            elif msg_type == "quit":
                break

        except Exception as e:
            send_message({"type": "error", "message": str(e)})

    kill_stockfish()
    stop_overlay()


def main():
    global stockfish_path

    stockfish_path = find_stockfish()

    if not stockfish_path:
        send_message({
            "type": "error",
            "message": "Stockfish not found. Install Stockfish and add to PATH or set STOCKFISH_PATH."
        })
        return

    send_message({"type": "started", "path": stockfish_path})
    start_stockfish()
    run_message_loop()


if __name__ == "__main__":
    main()
