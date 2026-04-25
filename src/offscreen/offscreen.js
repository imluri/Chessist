// Chessist - Offscreen Document
// Runs Stockfish WASM engine in isolated context

let stockfish = null;
let isReady = false;
let pendingEval = null;
let currentDepth = 18;
let currentFen = null;
let analysisFen = null;  // The FEN currently being analyzed (set when go command is sent)
let analysisRunning = false;
let pendingTimeoutOuter = null;  // Track pending timeouts to cancel on new requests
let pendingTimeoutInner = null;

// MultiPV tracking — holds best result seen so far for each PV slot (1-indexed)
let multiPvResults = {};

// Initialize Stockfish engine
async function initEngine() {
  try {
    console.log('Chessist Offscreen: Initializing Stockfish engine...');

    // Get the URL for the stockfish.js worker
    const stockfishUrl = chrome.runtime.getURL('src/engine/stockfish.js');
    console.log('Chessist Offscreen: Loading from', stockfishUrl);

    // Create worker with Stockfish
    stockfish = new Worker(stockfishUrl);
    console.log('Chessist Offscreen: Worker created');

    stockfish.onmessage = (e) => {
      console.log('Chessist Offscreen: Worker message received');
      handleEngineMessage(e);
    };

    stockfish.onerror = (e) => {
      console.error('Chessist Offscreen: Stockfish worker error:', e.message, e.filename, e.lineno);
    };

    // Wait a bit for worker to initialize, then send UCI
    setTimeout(() => {
      console.log('Chessist Offscreen: Sending UCI command');
      if (stockfish) {
        stockfish.postMessage('uci');
        console.log('Chessist Offscreen: UCI command sent');
      } else {
        console.error('Chessist Offscreen: Worker is null!');
      }
    }, 1000);

  } catch (e) {
    console.error('Chessist Offscreen: Failed to initialize Stockfish:', e.message, e.stack);
  }
}

// Handle messages from Stockfish engine
function handleEngineMessage(event) {
  const message = event.data;

  console.log('Chessist Offscreen: Raw engine data type:', typeof message);

  if (typeof message !== 'string') {
    console.log('Chessist Offscreen: Non-string message:', message);
    return;
  }

  console.log('Chessist Offscreen: Engine says:', message);

  // Engine identification
  if (message.startsWith('id name')) {
    console.log('Chessist: Engine identified -', message);
  }

  // Engine is ready
  if (message === 'uciok') {
    console.log('Chessist Offscreen: UCI OK, setting MultiPV and sending isready');
    stockfish.postMessage('setoption name MultiPV value 1');
    stockfish.postMessage('isready');
  }

  if (message === 'readyok') {
    isReady = true;
    analysisRunning = false;
    console.log('Chessist Offscreen: Stockfish engine ready!');

    // Process pending evaluation if any
    if (pendingEval) {
      evaluatePosition(pendingEval);
      pendingEval = null;
    }
  }

  // Parse evaluation info
  if (message.startsWith('info depth')) {
    const evaluation = parseInfoLine(message);
    if (evaluation && evaluation.depth >= 5) {
      const slot = evaluation.multipv || 1;
      // Store best result for this slot (overwrite with each new depth line)
      multiPvResults[slot] = evaluation;

      // Only broadcast on slot 1 (primary evaluation)
      if (slot !== 1) return;

      // Include the FEN so content script knows which position this eval is for
      evaluation.fen = analysisFen;
      const fenParts = analysisFen ? analysisFen.split(' ') : [];
      evaluation.turn = fenParts[1] || 'w';

      // Attach first moves from each MultiPV slot as multiPvMoves array
      evaluation.multiPvMoves = [1, 2, 3]
        .map(i => multiPvResults[i]?.pv?.[0])
        .filter(Boolean);

      chrome.runtime.sendMessage({
        type: 'EVAL_UPDATE',
        evaluation: evaluation
      }).catch(() => {});
    }
  }

  // Best move found
  if (message.startsWith('bestmove')) {
    analysisRunning = false;
    const parts = message.split(' ');
    const bestMove = parts[1];

    chrome.runtime.sendMessage({
      type: 'BEST_MOVE',
      bestMove: bestMove,
      fen: analysisFen
    }).catch(() => {});
  }
}

// Parse info line from Stockfish
function parseInfoLine(line) {
  const evaluation = {};

  // Extract depth
  const depthMatch = line.match(/depth (\d+)/);
  if (depthMatch) {
    evaluation.depth = parseInt(depthMatch[1]);
  }

  // Extract MultiPV slot index
  const multipvMatch = line.match(/\bmultipv (\d+)/);
  if (multipvMatch) {
    evaluation.multipv = parseInt(multipvMatch[1]);
  }

  // Extract score
  const cpMatch = line.match(/score cp (-?\d+)/);
  const mateMatch = line.match(/score mate (-?\d+)/);

  if (mateMatch) {
    evaluation.mate = parseInt(mateMatch[1]);
  } else if (cpMatch) {
    evaluation.cp = parseInt(cpMatch[1]);
  }

  // Extract nodes per second
  const npsMatch = line.match(/nps (\d+)/);
  if (npsMatch) {
    evaluation.nps = parseInt(npsMatch[1]);
  }

  // Extract PV (principal variation)
  const pvMatch = line.match(/ pv (.+)$/);
  if (pvMatch) {
    evaluation.pv = pvMatch[1].split(' ');
    if (evaluation.pv.length > 0) {
      evaluation.bestMove = evaluation.pv[0];
    }
  }

  return (evaluation.cp !== undefined || evaluation.mate !== undefined) ? evaluation : null;
}

// Evaluate a chess position
function evaluatePosition(fen) {
  if (!stockfish) {
    console.log('Chessist: Engine not initialized, queuing position');
    pendingEval = fen;
    return;
  }

  if (!isReady) {
    console.log('Chessist: Engine not ready, queuing position');
    pendingEval = fen;
    return;
  }

  // If analyzing the same position, don't restart
  if (fen === currentFen && analysisRunning) {
    console.log('Chessist: Already analyzing this position');
    return;
  }

  console.log('Chessist: Evaluating position:', fen);
  currentFen = fen;
  analysisRunning = true;

  // Cancel any pending timeouts from previous requests
  if (pendingTimeoutOuter) {
    clearTimeout(pendingTimeoutOuter);
    pendingTimeoutOuter = null;
  }
  if (pendingTimeoutInner) {
    clearTimeout(pendingTimeoutInner);
    pendingTimeoutInner = null;
  }

  // IMPORTANT: Always stop any current analysis first
  stockfish.postMessage('stop');

  // Wait a moment for stop to process before starting new analysis
  // NOTE: We intentionally DO NOT send ucinewgame here to preserve the hash table
  // This allows Stockfish to reuse transposition entries from previous analysis
  // ucinewgame is only sent on explicit RESET (e.g., when new game detected)
  pendingTimeoutOuter = setTimeout(() => {
    pendingTimeoutOuter = null;
    // Set analysisFen now - this is the FEN we're actually analyzing
    analysisFen = fen;
    // Clear MultiPV results for previous position
    multiPvResults = {};
    // Set position and analyze (hash table is preserved for faster convergence)
    stockfish.postMessage('position fen ' + fen);
    stockfish.postMessage('go depth ' + currentDepth);
  }, 50);
}

// Listen for messages from service worker
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Chessist: Offscreen received message:', message.type);

  if (message.type === 'EVALUATE_POSITION') {
    if (message.depth) currentDepth = message.depth;
    evaluatePosition(message.fen);
    sendResponse({ status: 'evaluating' });
  } else if (message.type === 'SET_MULTIPV') {
    const v = message.value || 1;
    if (stockfish) stockfish.postMessage(`setoption name MultiPV value ${v}`);
    sendResponse({ status: 'ok' });
  } else if (message.type === 'SET_DEPTH') {
    currentDepth = message.depth;
    sendResponse({ status: 'ok' });
  } else if (message.type === 'STOP') {
    if (pendingTimeoutOuter) clearTimeout(pendingTimeoutOuter);
    if (pendingTimeoutInner) clearTimeout(pendingTimeoutInner);
    pendingTimeoutOuter = null;
    pendingTimeoutInner = null;
    if (stockfish) {
      stockfish.postMessage('stop');
      analysisRunning = false;
      currentFen = null;
      analysisFen = null;
    }
    sendResponse({ status: 'stopped' });
  } else if (message.type === 'RESET') {
    // Reset engine state
    if (pendingTimeoutOuter) clearTimeout(pendingTimeoutOuter);
    if (pendingTimeoutInner) clearTimeout(pendingTimeoutInner);
    pendingTimeoutOuter = null;
    pendingTimeoutInner = null;
    if (stockfish) {
      stockfish.postMessage('stop');
      stockfish.postMessage('ucinewgame');
      analysisRunning = false;
      currentFen = null;
      analysisFen = null;
    }
    sendResponse({ status: 'reset' });
  } else if (message.type === 'SET_ELO') {
    if (stockfish) {
      if (message.elo) {
        stockfish.postMessage('setoption name UCI_LimitStrength value true');
        stockfish.postMessage(`setoption name UCI_Elo value ${message.elo}`);
        console.log('Chessist Offscreen: ELO set to', message.elo);
      } else {
        stockfish.postMessage('setoption name UCI_LimitStrength value false');
      }
    }
    sendResponse({ status: 'ok' });
  }
  return true;
});

// Initialize on load
console.log('Chessist: Offscreen document loaded');

// Signal to service worker that we're ready to receive messages
chrome.runtime.sendMessage({ type: 'OFFSCREEN_READY' }).catch(() => {});

initEngine();
