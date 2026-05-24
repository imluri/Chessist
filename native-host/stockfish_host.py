#!/usr/bin/env python3
"""Chessist Engine Launcher — native messaging host that starts ChessistEngine.exe."""

import sys, json, struct, subprocess, os

def send(msg):
    data = json.dumps(msg).encode()
    sys.stdout.buffer.write(struct.pack('<I', len(data)) + data)
    sys.stdout.buffer.flush()

def read():
    raw = sys.stdin.buffer.read(4)
    if not raw: return None
    return json.loads(sys.stdin.buffer.read(struct.unpack('<I', raw)[0]))

def find_engine():
    here = os.path.dirname(os.path.abspath(__file__))
    path = os.path.normpath(os.path.join(here, '..', 'overlay', 'bin', 'Release', 'net48', 'ChessistEngine.exe'))
    return path if os.path.isfile(path) else None

def is_running():
    try:
        out = subprocess.run(['tasklist', '/fi', 'imagename eq ChessistEngine.exe'],
                             capture_output=True, text=True).stdout
        return 'ChessistEngine.exe' in out
    except Exception:
        return False

def kill_engine():
    try:
        subprocess.run(['taskkill', '/f', '/im', 'ChessistEngine.exe'], capture_output=True)
    except Exception:
        pass

def launch(debug=False):
    path = find_engine()
    if not path:
        send({'type': 'launch_result', 'success': False, 'error': 'ChessistEngine.exe not found'})
        return
    if is_running():
        send({'type': 'launch_result', 'success': True, 'already_running': True})
        return
    try:
        flags = subprocess.DETACHED_PROCESS | getattr(subprocess, 'CREATE_NEW_PROCESS_GROUP', 0)
        if not debug:
            flags |= getattr(subprocess, 'CREATE_NO_WINDOW', 0)
        subprocess.Popen([path] + (['-debug'] if debug else []), creationflags=flags)
        send({'type': 'launch_result', 'success': True})
    except Exception as e:
        send({'type': 'launch_result', 'success': False, 'error': str(e)})

while True:
    msg = read()
    if msg is None:
        break
    t = msg.get('type')
    if t == 'launch':
        launch(debug=msg.get('debug', False))
    elif t == 'restart':
        kill_engine()
        import time; time.sleep(0.5)
        launch(debug=msg.get('debug', False))
    elif t == 'kill':
        kill_engine()
    elif t == 'quit':
        break
