// Chessist - Service Worker
// Coordinates communication between content script and Stockfish engine

let offscreenDocumentCreated = false;
let lastEvaluation = null;
let lastBestMove = null;
let pendingRequests = new Map();
let requestId = 0;
let currentEvalFen = null; // Track which FEN is being evaluated
let moveCounter = 0; // Track number of moves to adjust depth
let lastMoveTime = Date.now(); // Track time between moves for game speed detection

// === ANALYSIS CACHING ===
// PV (Principal Variation) cache for instant response when opponent plays expected move
let pvCache = {
  fen: null,           // Position that was analyzed
  pv: [],              // Principal variation [move1, move2, move3...]
  depth: 0,            // Depth achieved
  score: 0,            // Evaluation score (cp or mate)
  isMate: false,       // Whether score is mate score
  timestamp: 0         // When this was cached
};

// Position cache for revisited positions
const positionCache = new Map();  // FEN key → evaluation
const MAX_CACHE_SIZE = 100;
const CACHE_TTL_MS = 5 * 60 * 1000;  // 5 minutes

// === CACHE HELPER FUNCTIONS ===

// Get cache key from FEN (pieces + turn only for matching)
function getFenCacheKey(fen) {
  if (!fen) return null;
  return fen.split(' ').slice(0, 2).join(' ');
}

// Expand FEN board string to 8x8 array
function expandFenBoard(ranks) {
  const board = [];
  for (const rank of ranks) {
    const row = [];
    for (const char of rank) {
      if (/\d/.test(char)) {
        // Number = empty squares
        for (let i = 0; i < parseInt(char); i++) {
          row.push(null);
        }
      } else {
        row.push(char);
      }
    }
    board.push(row);
  }
  return board;
}

// Compress 8x8 array back to FEN board string
function compressFenBoard(board) {
  const ranks = [];
  for (const row of board) {
    let rank = '';
    let emptyCount = 0;
    for (const cell of row) {
      if (cell === null) {
        emptyCount++;
      } else {
        if (emptyCount > 0) {
          rank += emptyCount;
          emptyCount = 0;
        }
        rank += cell;
      }
    }
    if (emptyCount > 0) {
      rank += emptyCount;
    }
    ranks.push(rank);
  }
  return ranks.join('/');
}

// Apply a move to a FEN and return the resulting FEN
function applyMove(fen, move) {
  if (!fen || !move || move.length < 4) return null;

  try {
    const [board, turn, castling, enPassant] = fen.split(' ');
    const ranks = board.split('/');

    // Parse move (e.g., "e2e4", "e7e8q" for promotion)
    const fromFile = move.charCodeAt(0) - 97;  // 'a' = 0
    const fromRank = parseInt(move[1]) - 1;     // '1' = 0
    const toFile = move.charCodeAt(2) - 97;
    const toRank = parseInt(move[3]) - 1;
    const promotion = move[4] || null;

    // Expand board to 8x8 array (ranks[0] = rank 8, ranks[7] = rank 1)
    const boardArray = expandFenBoard(ranks);

    // Get the moving piece
    const piece = boardArray[7 - fromRank][fromFile];
    if (!piece) return null;

    // Clear the from square
    boardArray[7 - fromRank][fromFile] = null;

    // Place piece on target (with promotion if applicable)
    if (promotion) {
      boardArray[7 - toRank][toFile] = turn === 'w' ? promotion.toUpperCase() : promotion.toLowerCase();
    } else {
      boardArray[7 - toRank][toFile] = piece;
    }

    // Handle castling (king moves 2 squares)
    if (piece.toLowerCase() === 'k' && Math.abs(toFile - fromFile) === 2) {
      const rookFromFile = toFile > fromFile ? 7 : 0;
      const rookToFile = toFile > fromFile ? 5 : 3;
      const rook = boardArray[7 - fromRank][rookFromFile];
      boardArray[7 - fromRank][rookToFile] = rook;
      boardArray[7 - fromRank][rookFromFile] = null;
    }

    // Handle en passant capture
    if (piece.toLowerCase() === 'p' && toFile !== fromFile) {
      // Pawn captures diagonally
      const capturedPawnRank = 7 - fromRank;  // Same rank as capturing pawn was on
      if (boardArray[7 - toRank][toFile] === null) {
        // Target square was empty, so this is en passant
        boardArray[capturedPawnRank][toFile] = null;
      }
    }

    // Compress back to FEN board string
    const newBoard = compressFenBoard(boardArray);

    // Update turn
    const newTurn = turn === 'w' ? 'b' : 'w';

    // Update castling rights based on the move
    let newCastling = castling;

    // If king moves, remove that side's castling rights
    if (piece.toLowerCase() === 'k') {
      if (turn === 'w') {
        newCastling = newCastling.replace(/[KQ]/g, '');
      } else {
        newCastling = newCastling.replace(/[kq]/g, '');
      }
    }

    // If rook moves from corner, remove that castling right
    if (piece.toLowerCase() === 'r') {
      // White rooks: a1 (file 0, rank 0) = Q, h1 (file 7, rank 0) = K
      if (fromFile === 0 && fromRank === 0) newCastling = newCastling.replace('Q', '');
      if (fromFile === 7 && fromRank === 0) newCastling = newCastling.replace('K', '');
      // Black rooks: a8 (file 0, rank 7) = q, h8 (file 7, rank 7) = k
      if (fromFile === 0 && fromRank === 7) newCastling = newCastling.replace('q', '');
      if (fromFile === 7 && fromRank === 7) newCastling = newCastling.replace('k', '');
    }

    // If rook is captured on corner, remove that castling right
    if (toFile === 0 && toRank === 0) newCastling = newCastling.replace('Q', '');
    if (toFile === 7 && toRank === 0) newCastling = newCastling.replace('K', '');
    if (toFile === 0 && toRank === 7) newCastling = newCastling.replace('q', '');
    if (toFile === 7 && toRank === 7) newCastling = newCastling.replace('k', '');

    if (!newCastling) newCastling = '-';

    return `${newBoard} ${newTurn} ${newCastling} - 0 1`;
  } catch (e) {
    console.error('Chessist SW: applyMove error:', e);
    return null;
  }
}

// Store evaluation in cache
function cacheEvaluation(fen, evaluation) {
  if (!fen || !evaluation) return;

  const key = getFenCacheKey(fen);
  if (!key) return;

  // Store in position cache
  positionCache.set(key, {
    bestMove: evaluation.bestMove,
    cp: evaluation.cp,
    mate: evaluation.mate,
    pv: evaluation.pv || [],
    depth: evaluation.depth || 0,
    fen: fen,
    turn: evaluation.turn || fen.split(' ')[1] || 'w',
    timestamp: Date.now()
  });

  // Update PV cache if this is a complete evaluation with PV
  if (evaluation.pv && evaluation.pv.length >= 2 && evaluation.bestMove) {
    pvCache = {
      fen: fen,
      pv: evaluation.pv,
      depth: evaluation.depth || 0,
      score: evaluation.mate !== undefined ? evaluation.mate : (evaluation.cp || 0),
      isMate: evaluation.mate !== undefined,
      timestamp: Date.now()
    };
    console.log('Chessist SW: PV cache updated, line:', evaluation.pv.slice(0, 3).join(' '));
  }

  // Clean up old cache entries if over limit
  if (positionCache.size > MAX_CACHE_SIZE) {
    const now = Date.now();
    for (const [k, v] of positionCache) {
      if (now - v.timestamp > CACHE_TTL_MS) {
        positionCache.delete(k);
      }
    }
    // If still over limit, remove oldest entries
    if (positionCache.size > MAX_CACHE_SIZE) {
      const entries = [...positionCache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp);
      const toDelete = entries.slice(0, positionCache.size - MAX_CACHE_SIZE + 10);
      toDelete.forEach(([k]) => positionCache.delete(k));
    }
  }
}

// Get cached evaluation for a position
function getCachedEvaluation(fen, minDepth = 0) {
  const key = getFenCacheKey(fen);
  if (!key) return null;

  const cached = positionCache.get(key);
  if (!cached) return null;

  // Check TTL
  if (Date.now() - cached.timestamp > CACHE_TTL_MS) {
    positionCache.delete(key);
    return null;
  }

  // Check depth requirement
  if (cached.depth < minDepth) return null;

  return cached;
}

// Check if new position matches PV continuation (opponent played expected move)
function checkPVContinuation(newFen) {
  if (!pvCache.fen || !pvCache.pv || pvCache.pv.length < 2) {
    return null;
  }

  // Check if cache is too old (30 seconds)
  if (Date.now() - pvCache.timestamp > 30000) {
    return null;
  }

  // Apply the first move of the PV to the cached position
  const expectedFen = applyMove(pvCache.fen, pvCache.pv[0]);
  if (!expectedFen) return null;

  // Compare positions (pieces + turn only)
  const expectedKey = getFenCacheKey(expectedFen);
  const newKey = getFenCacheKey(newFen);

  if (expectedKey === newKey) {
    // Opponent played the expected move! Return pre-calculated response
    console.log('Chessist SW: PV cache HIT! Opponent played:', pvCache.pv[0], '→ instant response:', pvCache.pv[1]);
    return {
      bestMove: pvCache.pv[1],
      // Flip the score (was from opponent's perspective after their move)
      cp: pvCache.isMate ? undefined : -pvCache.score,
      mate: pvCache.isMate ? -pvCache.score : undefined,
      pv: pvCache.pv.slice(1),
      depth: pvCache.depth,
      fen: newFen,
      turn: newFen.split(' ')[1] || 'w',
      fromPVCache: true
    };
  }

  return null;
}

// === NATIVE LAUNCHER (launches ChessistEngine.exe via Python native host) ===
let nativePort = null;

function connectNative() {
  if (nativePort) return;
  try {
    nativePort = chrome.runtime.connectNative('com.chess.live.eval');
    nativePort.onDisconnect.addListener(() => { nativePort = null; });
  } catch (e) {
    console.log('Chessist SW: native host not available:', e.message);
  }
}

// In-memory settings cache — avoids storage.sync round-trip on every eval
let cachedEngineDepth = 18;

// Tab ID cache — avoids chrome.tabs.query on every depth update
let cachedContentTabIds = null;
let tabCacheTimer = null;
function invalidateTabCache() {
  cachedContentTabIds = null;
  if (tabCacheTimer) { clearTimeout(tabCacheTimer); tabCacheTimer = null; }
}
chrome.tabs.onCreated.addListener(invalidateTabCache);
chrome.tabs.onRemoved.addListener(invalidateTabCache);
chrome.tabs.onUpdated.addListener((id, info) => { if (info.url) invalidateTabCache(); });

// Load initial settings
chrome.storage.sync.get(['engineDepth']).then(result => {
  cachedEngineDepth = result.engineDepth || 18;
});

// Content scripts open a persistent port to keep the service worker alive.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'content-alive') return;
  // Keep service worker alive while content script is connected
});


// Offscreen document readiness tracking
let offscreenReady = false;
let offscreenReadyResolve = null;
let offscreenReadyPromise = null;

function waitForOffscreenReady() {
  if (offscreenReady) return Promise.resolve();
  if (!offscreenReadyPromise) {
    offscreenReadyPromise = new Promise(resolve => {
      offscreenReadyResolve = resolve;
      // Timeout fallback - don't wait forever
      setTimeout(() => {
        if (!offscreenReady) {
          console.log('Chessist SW: Offscreen ready timeout, proceeding anyway');
          offscreenReady = true;
          resolve();
        }
      }, 5000);
    });
  }
  return offscreenReadyPromise;
}

// Create offscreen document for running Stockfish WASM
async function ensureOffscreenDocument() {
  if (offscreenDocumentCreated) return;

  try {
    if (chrome.runtime.getContexts) {
      const existingContexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT']
      });

      if (existingContexts.length > 0) {
        offscreenDocumentCreated = true;
        offscreenReady = true;
        return;
      }
    }

    await chrome.offscreen.createDocument({
      url: 'src/offscreen/offscreen.html',
      reasons: ['WORKERS'],
      justification: 'Running Stockfish chess engine in Web Worker'
    });

    offscreenDocumentCreated = true;
    console.log('Chessist SW: Offscreen document created, waiting for ready signal...');
  } catch (e) {
    if (e.message?.includes('single offscreen document')) {
      offscreenDocumentCreated = true;
      offscreenReady = true;
    } else {
      console.error('Failed to create offscreen document:', e);
    }
  }
}

// Handle messages from content script and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Chessist SW: Received message:', message.type);

  if (message.type === 'OFFSCREEN_READY') {
    console.log('Chessist SW: Offscreen document ready');
    offscreenReady = true;
    if (offscreenReadyResolve) {
      offscreenReadyResolve();
      offscreenReadyResolve = null;
    }
    return;
  }

  if (message.type === 'EVALUATE') {
    handleEvaluateRequest(message.fen, message.isMouseRelease, sender.tab?.id, sendResponse);
    return true;
  }

  if (message.type === 'EXECUTE_MOVE') {
    const tabId = sender.tab?.id;
    if (!tabId) { sendResponse({ success: false, error: 'No tabId' }); return true; }

    chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: (from, to, promo) => {
        const files = 'abcdefgh';

        // Detect site and find the appropriate board element
        const cgWrap = document.querySelector('cg-wrap') || document.querySelector('.cg-wrap');
        const chessComBoard = document.querySelector('wc-chess-board') || document.querySelector('chess-board');

        const isLichess = !!cgWrap;

        let isFlipped, surface;

        if (isLichess) {
          isFlipped = cgWrap.classList.contains('orientation-black');
          surface = cgWrap.querySelector('cg-board') || cgWrap;
        } else {
          if (!chessComBoard) return false;
          isFlipped = chessComBoard.classList.contains('flipped') || chessComBoard.getAttribute('board-orientation') === 'black';
          surface = chessComBoard.querySelector('.board')
                 || chessComBoard.shadowRoot?.querySelector('.board')
                 || chessComBoard;
        }

        const rect = surface.getBoundingClientRect();
        const sz = rect.width / 8;

        function sqPx(sq) {
          const f = files.indexOf(sq[0]), r = parseInt(sq[1]) - 1;
          const x = isFlipped ? rect.left + (7 - f + 0.5) * sz : rect.left + (f + 0.5) * sz;
          const y = isFlipped ? rect.top + (r + 0.5) * sz      : rect.top + (7 - r + 0.5) * sz;
          return { x, y };
        }

        const fp = sqPx(from), tp = sqPx(to);

        if (isLichess) {
          // Lichess/chessground: drag interaction (pointerdown on piece → pointermove → pointerup at dest)
          function fire(el, type, x, y, btns) {
            el.dispatchEvent(new PointerEvent(type, {
              bubbles: true, cancelable: true, composed: true,
              clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse',
              isPrimary: true, button: 0, buttons: btns != null ? btns : 1
            }));
          }

          // Find piece at from-square by transform
          let pieceEl = null;
          const pieces = surface.querySelectorAll('piece');
          let bestDist = sz;
          for (const p of pieces) {
            const m = p.style.transform.match(/translate\((\d+(?:\.\d+)?)px,\s*(\d+(?:\.\d+)?)px\)/);
            if (!m) continue;
            const px = parseFloat(m[1]), py = parseFloat(m[2]);
            const ef = files.indexOf(from[0]), er = parseInt(from[1]) - 1;
            const ex = isFlipped ? (7 - ef) * sz : ef * sz;
            const ey = isFlipped ? er * sz : (7 - er) * sz;
            const d = Math.hypot(px - ex, py - ey);
            if (d < bestDist) { bestDist = d; pieceEl = p; }
          }

          const fromEl = pieceEl || document.elementFromPoint(fp.x, fp.y) || surface;
          fire(fromEl, 'pointerdown', fp.x, fp.y, 1);
          fromEl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: fp.x, clientY: fp.y, button: 0, buttons: 1 }));

          setTimeout(() => {
            document.dispatchEvent(new PointerEvent('pointermove', {
              bubbles: true, cancelable: true, composed: true,
              clientX: tp.x, clientY: tp.y, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1
            }));
            setTimeout(() => {
              const toEl = document.elementFromPoint(tp.x, tp.y) || surface;
              fire(toEl, 'pointerup', tp.x, tp.y, 0);
              toEl.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: tp.x, clientY: tp.y, button: 0 }));
            }, 50);
          }, 50);
        } else {
          // Chess.com: click FROM then click TO
          function fireClick(x, y) {
            const el = document.elementFromPoint(x, y) || chessComBoard;
            el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1 }));
            el.dispatchEvent(new MouseEvent('mousedown',     { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: 1 }));
            el.dispatchEvent(new PointerEvent('pointerup',   { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 0 }));
            el.dispatchEvent(new MouseEvent('mouseup',       { bubbles: true, clientX: x, clientY: y, button: 0, buttons: 0 }));
            el.dispatchEvent(new MouseEvent('click',         { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }));
          }

          fireClick(fp.x, fp.y);
          setTimeout(() => fireClick(tp.x, tp.y), 100);
        }

        return true;
      },
      args: [message.from, message.to, message.promotion || null]
    }).then(() => sendResponse({ success: true }))
      .catch(e => {
        console.error('Chessist SW: executeScript failed:', e.message);
        sendResponse({ success: false, error: e.message });
      });
    return true;
  }

  // WS engine eval arrived in content script — update SW state + push to popup only (no content re-broadcast)
  if (message.type === 'WS_EVAL_UPDATE') {
    lastEvaluation = message.evaluation;
    chrome.runtime.sendMessage({ type: 'EVAL_RESULT', evaluation: message.evaluation }).catch(() => {});
    return;
  }

  if (message.type === 'EVAL_UPDATE') {
    // Check if this evaluation is for the current position
    if (message.evaluation.fen && currentEvalFen) {
      const evalKey = message.evaluation.fen.split(' ').slice(0, 2).join(' ');
      const currentKey = currentEvalFen.split(' ').slice(0, 2).join(' ');
      if (evalKey !== currentKey) {
        console.log('Chessist SW: Ignoring stale WASM eval (position changed)');
        return;
      }
    }
    lastEvaluation = message.evaluation;
    broadcastToContentScripts({
      type: 'EVAL_RESULT',
      evaluation: message.evaluation
    });
  }

  if (message.type === 'BEST_MOVE') {
    // Check if this best move is for the current position
    if (lastEvaluation?.fen && currentEvalFen) {
      const evalKey = lastEvaluation.fen.split(' ').slice(0, 2).join(' ');
      const currentKey = currentEvalFen.split(' ').slice(0, 2).join(' ');
      if (evalKey !== currentKey) {
        console.log('Chessist SW: Ignoring stale WASM bestmove (position changed)');
        return;
      }
    }
    lastBestMove = message.bestMove;
    if (lastEvaluation) {
      lastEvaluation.bestMove = message.bestMove;
      // Cache the completed evaluation (with bestMove and PV)
      if (lastEvaluation.fen) {
        cacheEvaluation(lastEvaluation.fen, lastEvaluation);
      }
      broadcastToContentScripts({
        type: 'EVAL_RESULT',
        evaluation: lastEvaluation
      });
    }
  }

  if (message.type === 'LAUNCH_ENGINE') {
    connectNative();
    nativePort?.postMessage({ type: 'launch', debug: message.debug || false });
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'RESTART_OVERLAY') {
    connectNative();
    nativePort?.postMessage({ type: 'restart', debug: message.debug || false });
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'KILL_ENGINE') {
    connectNative();
    nativePort?.postMessage({ type: 'kill' });
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'SET_MULTIPV') {
    const multiPv = message.value || 1;
    chrome.runtime.sendMessage({ type: 'SET_MULTIPV', value: multiPv }).catch(() => {});
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'GET_LAST_EVAL') {
    sendResponse({ evaluation: lastEvaluation });
    return true;
  }

  if (message.type === 'SET_DEPTH') {
    cachedEngineDepth = message.depth || 18;
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'SET_SKILL_LEVEL') {
    chrome.runtime.sendMessage({ type: 'SET_SKILL_LEVEL', level: message.level }).catch(() => {});
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'SET_ELO') {
    chrome.runtime.sendMessage({ type: 'SET_ELO', elo: message.elo }).catch(() => {});
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'STOP_ANALYSIS') {
    chrome.runtime.sendMessage({ type: 'STOP' }).catch(() => {});
    console.log('Chessist SW: Analysis stopped');
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'RESET_ENGINE') {
    chrome.runtime.sendMessage({ type: 'RESET' }).catch(() => {});
    lastEvaluation = null;
    lastBestMove = null;
    currentEvalFen = null;
    positionCache.clear();
    pvCache = { fen: null, pv: [], depth: 0, score: 0, isMate: false, timestamp: 0 };
    console.log('Chessist SW: Engine and caches reset');
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'FORCE_RESTART_ENGINE') {
    console.log('Chessist SW: Force restarting WASM engine...');
    lastEvaluation = null;
    lastBestMove = null;
    currentEvalFen = null;
    positionCache.clear();
    pvCache = { fen: null, pv: [], depth: 0, score: 0, isMate: false, timestamp: 0 };
    offscreenDocumentCreated = false;
    try { chrome.offscreen.closeDocument().catch(() => {}); } catch (e) {}
    setTimeout(async () => {
      await ensureOffscreenDocument();
      sendResponse({ success: true, message: 'WASM engine restarting...' });
    }, 500);
    return true;
  }

  return false;
});

// Handle evaluation request (WASM fallback — Chessist Engine handles via WS when connected)
async function handleEvaluateRequest(fen, isMouseRelease, tabId, sendResponse) {
  const depth = cachedEngineDepth;
  currentEvalFen = fen;

  // === CACHE CHECKS ===

  // Check 1: PV continuation - did opponent play the expected move?
  const pvHit = checkPVContinuation(fen);
  if (pvHit) {
    // Instant response from PV cache!
    broadcastToContentScripts({
      type: 'EVAL_RESULT',
      evaluation: pvHit
    });
    sendResponse({ evaluation: pvHit });
    // Continue with fresh analysis to refine/verify (don't return)
    console.log('Chessist SW: PV hit sent, continuing with verification analysis');
  }

  // Check 2: Position cache - have we analyzed this exact position before?
  const cached = getCachedEvaluation(fen, depth);
  if (cached && cached.depth >= depth) {
    console.log('Chessist SW: Position cache HIT, depth', cached.depth);
    cached.fromCache = true;
    broadcastToContentScripts({
      type: 'EVAL_RESULT',
      evaluation: cached
    });
    sendResponse({ evaluation: cached });
    return; // Full cache hit at required depth, no need to re-analyze
  }

  // Use WASM Stockfish (Chessist Engine handles eval directly via WS when running)
  await handleWasmEvaluation(fen, depth, sendResponse);
}

// Separate WASM evaluation handler
async function handleWasmEvaluation(fen, depth, sendResponse) {
  try {
    await ensureOffscreenDocument();
    await waitForOffscreenReady();

    chrome.runtime.sendMessage({
      type: 'EVALUATE_POSITION',
      fen: fen,
      depth: depth
    }).catch(e => {
      console.log('Chessist SW: Offscreen message error:', e.message);
    });

    const id = ++requestId;
    pendingRequests.set(id, { sendResponse });

    setTimeout(() => {
      if (lastEvaluation) {
        sendResponse({ evaluation: lastEvaluation });
      } else {
        sendResponse({ evaluation: { cp: 0 } });
      }
      pendingRequests.delete(id);
    }, 5000);

  } catch (e) {
    console.error('Chessist SW: Evaluation error:', e);
    sendResponse({ error: e.message });
  }
}

// Broadcast message to all Chess.com and Lichess tabs
async function broadcastToContentScripts(message) {
  try {
    // Resolve tab IDs — use cache to avoid repeated chrome.tabs.query on every depth line
    if (!cachedContentTabIds) {
      const [chessTabs, lichessTabs] = await Promise.all([
        chrome.tabs.query({ url: 'https://www.chess.com/*' }),
        chrome.tabs.query({ url: 'https://lichess.org/*' })
      ]);
      cachedContentTabIds = [...chessTabs, ...lichessTabs].map(t => t.id);
      // Auto-expire cache after 10 s in case tab events are missed
      tabCacheTimer = setTimeout(invalidateTabCache, 10000);
    }

    // Send to all content-script tabs in parallel
    await Promise.all(
      cachedContentTabIds.map(id =>
        chrome.tabs.sendMessage(id, message).catch(() => {
          // Tab gone — drop it from the cache so next broadcast re-queries
          cachedContentTabIds = cachedContentTabIds?.filter(t => t !== id) ?? null;
        })
      )
    );

    // Also push to extension pages (popup) for live eval display
    chrome.runtime.sendMessage(message).catch(() => {});
  } catch (e) {
    console.error('Broadcast error:', e);
  }
}

// Initialize on install
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('Chessist installed, reason:', details.reason);

  const existing = await chrome.storage.sync.get(['enabled', 'showBestMove', 'engineDepth']);
  await chrome.storage.sync.set({
    enabled: existing.enabled ?? true,
    showBestMove: existing.showBestMove ?? false,
    engineDepth: existing.engineDepth ?? 18,
  });
});
