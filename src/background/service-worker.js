// Chessist - Service Worker
// Coordinates communication between content script and Stockfish engine

let offscreenDocumentCreated = false;
let lastEvaluation = null;
let lastBestMove = null;
let pendingRequests = new Map();
let requestId = 0;
let currentEvalFen = null; // Track which FEN is being evaluated
let analysisEvalFen = null; // The FEN actually being analyzed by native engine
let nativeEvalTimeout = null; // Debounce timer for native engine requests
let pendingNativeFen = null; // FEN waiting to be evaluated after debounce
let moveCounter = 0; // Track number of moves to adjust depth
let lastMoveTime = Date.now(); // Track time between moves for game speed detection
let analysisStartTime = 0; // When current analysis started (for stuck detection)
const STUCK_ANALYSIS_TIMEOUT_MS = 15000; // 15 seconds before considering analysis stuck

// Native messaging
let nativePort = null;
let nativeConnected = false;
let nativePath = null;
let nativeLastError = null;
let engineSource = 'wasm'; // 'wasm' or 'native'

// Watchdog for native engine health
let lastNativeResponseTime = Date.now();
let nativeWatchdogTimer = null;

// Reconnection handling
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 3;
let reconnectTimer = null;

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

// Load engine source preference
chrome.storage.sync.get(['engineSource']).then(result => {
  engineSource = result.engineSource || 'wasm';
  if (engineSource === 'native') {
    connectNative();
  }
});

// Content scripts open a persistent port to keep the service worker alive.
// When a tab connects, ensure the native engine is running immediately.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'content-alive') return;
  if (engineSource === 'native' && !nativePort) {
    connectNative();
  }
});

// Connect to native Stockfish host
function connectNative() {
  if (nativePort) {
    return; // Already connected
  }

  try {
    console.log('Chessist SW: Connecting to native host...');
    nativeLastError = null;
    nativePort = chrome.runtime.connectNative('com.chess.live.eval');

    nativePort.onMessage.addListener((message) => {
      console.log('Chessist SW: Native message:', message);
      handleNativeMessage(message);
    });

    nativePort.onDisconnect.addListener(() => {
      const error = chrome.runtime.lastError?.message || 'Unknown error';
      console.log('Chessist SW: Native disconnected:', error);
      nativePort = null;
      nativeConnected = false;
      nativePath = null;
      nativeLastError = error;
      analysisEvalFen = null; // Clear analysis state on disconnect

      // Stop watchdog when disconnected
      if (nativeWatchdogTimer) {
        clearInterval(nativeWatchdogTimer);
        nativeWatchdogTimer = null;
      }

      // Auto-fallback to WASM only if the browser forbids native messaging (e.g., Opera)
      // "not found" means the host isn't registered yet — a setup issue, not a browser limitation.
      // Don't permanently switch to WASM for setup errors; let the user fix and retry.
      if (error.includes('forbidden')) {
        console.log('Chessist SW: Native messaging not supported by this browser, falling back to WASM');
        engineSource = 'wasm';
        chrome.storage.sync.set({ engineSource: 'wasm' });
        reconnectAttempts = 0;
        chrome.runtime.sendMessage({ type: 'ENGINE_SOURCE_CHANGED', source: 'wasm' }).catch(() => {});
      } else if (error.includes('not found')) {
        // Host not registered — setup issue. Stay in native mode so the user sees the error.
        console.log('Chessist SW: Native host not found — install.bat may not have been run correctly');
        reconnectAttempts = 0; // No point retrying; won't succeed until setup is fixed
      } else if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        // Attempt to reconnect for temporary failures
        reconnectAttempts++;
        console.log(`Chessist SW: Reconnection attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}`);
        reconnectTimer = setTimeout(() => {
          connectNative();
        }, 1000 * reconnectAttempts); // Exponential backoff
      } else {
        console.log('Chessist SW: Max reconnection attempts reached, falling back to WASM');
        engineSource = 'wasm';
        chrome.storage.sync.set({ engineSource: 'wasm' });
        reconnectAttempts = 0;
        chrome.runtime.sendMessage({ type: 'ENGINE_SOURCE_CHANGED', source: 'wasm' }).catch(() => {});
      }
    });

    // Start watchdog timer to detect unresponsive engine
    // Use longer timeout for deep analysis (depth 24+ can take time)
    lastNativeResponseTime = Date.now();
    if (!nativeWatchdogTimer) {
      nativeWatchdogTimer = setInterval(() => {
        if (nativeConnected && Date.now() - lastNativeResponseTime > 30000) {
          console.log('Chessist SW: Native engine unresponsive, reconnecting...');
          disconnectNative();
          setTimeout(connectNative, 1000);
        }
      }, 10000);
    }

  } catch (e) {
    console.error('Chessist SW: Failed to connect native:', e);
    nativePort = null;
    nativeConnected = false;
  }
}

// Disconnect native host
function disconnectNative() {
  if (nativePort) {
    try {
      nativePort.disconnect();
    } catch (e) {
      console.log('Chessist SW: Error disconnecting native port:', e);
    }
    nativePort = null;
    nativeConnected = false;
    nativePath = null;
    analysisEvalFen = null;
  }
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

// Safe postMessage wrapper with null check
function sendToNativePort(message) {
  if (!nativePort) {
    console.warn('Chessist SW: Native port is null, dropping message (reconnection handled by onDisconnect)');
    return false;
  }
  
  try {
    nativePort.postMessage(message);
    return true;
  } catch (e) {
    console.error('Chessist SW: Failed to send message to native port:', e);
    // Port might be in invalid state, disconnect and reconnect
    disconnectNative();
    if (engineSource === 'native') {
      setTimeout(connectNative, 1000);
    }
    return false;
  }
}

// Handle messages from native host
function handleNativeMessage(message) {
  // Reset watchdog timer on any response
  lastNativeResponseTime = Date.now();

  if (message.type === 'started') {
    nativeConnected = true;
    nativePath = message.path;
    reconnectAttempts = 0; // Reset on successful connection
    console.log('Chessist SW: Native Stockfish started:', message.path);
    chrome.storage.sync.get(['overlayMode']).then(s => {
      if (s.overlayMode) sendToNativePort({ type: 'start_overlay' });
    });
  }
  else if (message.type === 'ready') {
    console.log('Chessist SW: Native Stockfish ready');
    // Apply saved skill level on engine ready
    chrome.storage.sync.get(['skillLevel']).then(settings => {
      const level = settings.skillLevel ?? 20;
      if (level < 20) {
        sendToNativePort({ type: 'set_option', name: 'Skill Level', value: level });
      }
    });
  }
  else if (message.type === 'analyzing') {
    console.log('Chessist SW: Analyzing position:', message.fen, 'depth:', message.depth);
  }
  else if (message.type === 'eval') {
    // IMPORTANT: Ignore stale results if analysisEvalFen was cleared (position changed)
    if (!analysisEvalFen) {
      console.log('Chessist SW: Ignoring stale eval result (position changed)');
      return;
    }

    lastEvaluation = message.data;
    // Reset stuck detection on any eval result (engine is still working)
    analysisStartTime = Date.now();
    // Add turn info from the FEN being evaluated (use analysisEvalFen to avoid race conditions)
    const fenParts = analysisEvalFen.split(' ');
    lastEvaluation.turn = fenParts[1] || 'w';
    lastEvaluation.fen = analysisEvalFen;
    // multiPvMoves is already set by the Python host (slot-1 only messages)

    broadcastToContentScripts({
      type: 'EVAL_RESULT',
      evaluation: lastEvaluation
    });
  }
  else if (message.type === 'bestmove') {
    // IMPORTANT: Ignore stale bestmove if analysisEvalFen was cleared (position changed)
    if (!analysisEvalFen) {
      console.log('Chessist SW: Ignoring stale bestmove (position changed)');
      return;
    }

    lastBestMove = message.move;
    analysisStartTime = 0;  // Analysis completed, reset stuck detection timer
    if (lastEvaluation) {
      lastEvaluation.bestMove = message.move;
      // Cache the completed evaluation (with bestMove and PV)
      cacheEvaluation(analysisEvalFen, lastEvaluation);
      broadcastToContentScripts({
        type: 'EVAL_RESULT',
        evaluation: lastEvaluation
      });
    }
  }
  else if (message.type === 'error') {
    console.error('Chessist SW: Native error:', message.message);
  }
  else if (message.type === 'debug') {
    console.log('Chessist SW: [Python]', message.message);
  }
}

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

  if (message.type === 'SET_OVERLAY_MODE') {
    if (nativePort && nativeConnected) {
      sendToNativePort({ type: message.enabled ? 'start_overlay' : 'stop_overlay' });
    }
    return;
  }

  if (message.type === 'RESTART_OVERLAY') {
    if (nativePort && nativeConnected) {
      sendToNativePort({ type: 'stop_overlay' });
      setTimeout(() => sendToNativePort({ type: 'start_overlay', debug: message.debug === true }), 500);
    }
    return;
  }

  if (message.type === 'SET_ENGINE_SOURCE') {
    engineSource = message.source;
    reconnectAttempts = 0; // Reset attempts on manual source change
    if (engineSource === 'native') {
      connectNative();
    } else {
      disconnectNative();
    }
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'CHECK_NATIVE_STATUS') {
    if (engineSource !== 'native') {
      sendResponse({ connected: false, error: 'Native engine not selected' });
    } else if (nativeConnected) {
      sendResponse({ connected: true, path: nativePath });
    } else {
      connectNative(); // Try to connect
      setTimeout(() => {
        sendResponse({
          connected: nativeConnected,
          path: nativePath,
          error: nativeConnected ? null : (nativeLastError || 'Failed to connect - run install.bat')
        });
      }, 1000);
      return true;
    }
    return true;
  }

  if (message.type === 'GET_LAST_EVAL') {
    // Return the last evaluation for popup display
    sendResponse({ evaluation: lastEvaluation });
    return true;
  }

  if (message.type === 'SET_DEPTH') {
    // Forward to native or WASM
    if (engineSource === 'native' && nativePort) {
      sendToNativePort({ type: 'set_option', name: 'Depth', value: message.depth });
    }
    // WASM will read from storage
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'SET_SKILL_LEVEL') {
    // Forward skill level to native Stockfish (UCI option)
    if (engineSource === 'native' && nativePort) {
      sendToNativePort({ type: 'set_option', name: 'Skill Level', value: message.level });
    }
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'SET_ELO') {
    const elo = message.elo; // null = disable ELO limiting
    if (engineSource === 'native' && nativePort) {
      if (elo) {
        sendToNativePort({ type: 'set_option', name: 'UCI_LimitStrength', value: 'true' });
        sendToNativePort({ type: 'set_option', name: 'UCI_Elo', value: elo });
        console.log('Chessist SW: Set native ELO to', elo);
      } else {
        sendToNativePort({ type: 'set_option', name: 'UCI_LimitStrength', value: 'false' });
      }
    } else {
      // WASM engine via offscreen document
      chrome.runtime.sendMessage({ type: 'SET_ELO', elo }).catch(() => {});
    }
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'STOP_ANALYSIS') {
    // Stop current analysis (but don't reset caches)
    if (engineSource === 'native' && nativePort) {
      sendToNativePort({ type: 'stop' });
    } else {
      // Send stop to offscreen document
      chrome.runtime.sendMessage({ type: 'STOP' }).catch(() => {});
    }
    // Clear the current analysis FEN to ignore incoming results
    analysisEvalFen = null;
    console.log('Chessist SW: Analysis stopped');
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'RESET_ENGINE') {
    // Reset the engine (clear hash tables, stop analysis)
    if (engineSource === 'native' && nativePort) {
      sendToNativePort({ type: 'reset' });
    } else {
      // Send reset to offscreen document
      chrome.runtime.sendMessage({ type: 'RESET' }).catch(() => {});
    }
    // Clear all cached evaluations
    lastEvaluation = null;
    lastBestMove = null;
    analysisEvalFen = null;
    positionCache.clear();
    pvCache = { fen: null, pv: [], depth: 0, score: 0, isMate: false, timestamp: 0 };
    console.log('Chessist SW: Engine and caches reset');
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'FORCE_RESTART_ENGINE') {
    // Force restart - completely disconnect and reconnect native, or recreate WASM offscreen doc
    console.log('Chessist SW: Force restarting engine...');

    // Clear all state
    lastEvaluation = null;
    lastBestMove = null;
    analysisEvalFen = null;
    analysisStartTime = 0;
    currentEvalFen = null;
    pendingNativeFen = null;
    positionCache.clear();
    pvCache = { fen: null, pv: [], depth: 0, score: 0, isMate: false, timestamp: 0 };

    if (nativeEvalTimeout) {
      clearTimeout(nativeEvalTimeout);
      nativeEvalTimeout = null;
    }

    if (engineSource === 'native') {
      // Force disconnect and reconnect native
      disconnectNative();
      reconnectAttempts = 0;
      setTimeout(() => {
        connectNative();
        sendResponse({ success: true, message: 'Native engine restarting...' });
      }, 500);
    } else {
      // Force recreate WASM offscreen document
      offscreenDocumentCreated = false;
      try {
        chrome.offscreen.closeDocument().catch(() => {});
      } catch (e) {}
      setTimeout(async () => {
        await ensureOffscreenDocument();
        sendResponse({ success: true, message: 'WASM engine restarting...' });
      }, 500);
    }
    return true;
  }

  return false;
});

// Handle evaluation request
async function handleEvaluateRequest(fen, isMouseRelease, tabId, sendResponse) {
  const settings = await chrome.storage.sync.get(['engineDepth', 'engineSource']);
  const depth = settings.engineDepth || 18;
  const source = settings.engineSource || 'wasm';

  // Track current FEN being evaluated (for turn info in results)
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

  // If we had a PV hit but need deeper analysis, or no cache at all, continue...

  if (source === 'native' && nativePort && nativeConnected) {
    // Check if already analyzing this exact position
    if (fen === analysisEvalFen && !nativeEvalTimeout) {
      // Check if analysis has been stuck for too long
      const analysisDuration = Date.now() - analysisStartTime;
      if (analysisDuration > STUCK_ANALYSIS_TIMEOUT_MS) {
        console.log('Chessist SW: Analysis appears stuck for', Math.round(analysisDuration / 1000), 's, forcing restart');
        // Force restart the analysis
        sendToNativePort({ type: 'stop' });
        analysisEvalFen = null;
        analysisStartTime = 0;
        // Continue to re-evaluate below
      } else {
        console.log('Chessist SW: Already analyzing this position');
        sendResponse({ evaluation: lastEvaluation || { cp: 0 } });
        return;
      }
    }

    // IMPORTANT: Set analysisEvalFen to the NEW fen immediately
    // This ensures:
    // 1. Old results (for old FEN) are filtered out by content script (FEN mismatch)
    // 2. New results (for new FEN) are accepted immediately
    // Don't set to null - that causes valid new results to be ignored during race conditions
    const previousFen = analysisEvalFen;
    analysisEvalFen = fen;  // Track what we're actually analyzing - set BEFORE stop
    analysisStartTime = Date.now();

    // Stop previous analysis if there was one
    if (previousFen && previousFen !== fen) {
      sendToNativePort({ type: 'stop' });
      console.log('Chessist SW: Position changed, stopping previous analysis');
    }

    // Cancel any pending debounce (in case there was one)
    if (nativeEvalTimeout) {
      clearTimeout(nativeEvalTimeout);
      nativeEvalTimeout = null;
    }

    // NO DEBOUNCE - Send immediately to native engine
    console.log('Chessist SW: Evaluating with native Stockfish:', fen.substring(0, 40));
    lastNativeResponseTime = Date.now();  // Reset watchdog when sending command

    // Use safe wrapper to send message
    const sent = sendToNativePort({ type: 'evaluate', fen: fen, depth: depth });

    if (!sent) {
      // If sending failed, fall back to WASM for this request
      console.log('Chessist SW: Native send failed, using WASM for this evaluation');
      analysisEvalFen = null;
      handleWasmEvaluation(fen, depth, sendResponse);
    }

    // Wait for evaluation with timeout
    const id = ++requestId;
    pendingRequests.set(id, { tabId, sendResponse });

    setTimeout(() => {
      if (lastEvaluation) {
        sendResponse({ evaluation: lastEvaluation });
      } else {
        sendResponse({ evaluation: { cp: 0 } });
      }
      pendingRequests.delete(id);
    }, 3000);

  } else {
    // Use WASM Stockfish
    await handleWasmEvaluation(fen, depth, sendResponse);
  }
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
    // Send to content scripts in Chess.com and Lichess tabs
    const [chessTabs, lichessTabs] = await Promise.all([
      chrome.tabs.query({ url: 'https://www.chess.com/*' }),
      chrome.tabs.query({ url: 'https://lichess.org/*' })
    ]);
    const tabs = [...chessTabs, ...lichessTabs];
    for (const tab of tabs) {
      try {
        await chrome.tabs.sendMessage(tab.id, message);
      } catch (e) {
        // Tab might not have content script loaded
      }
    }
    // Also broadcast to extension pages (popup) for live updates
    try {
      chrome.runtime.sendMessage(message);
    } catch (e) {
      // Popup might not be open
    }
  } catch (e) {
    console.error('Broadcast error:', e);
  }
}

// Initialize on install
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('Chessist installed, reason:', details.reason);

  // Get existing settings to preserve user preferences
  const existing = await chrome.storage.sync.get(['enabled', 'showBestMove', 'engineDepth', 'engineSource']);

  // Only set defaults for missing values (preserves user preferences on updates)
  await chrome.storage.sync.set({
    enabled: existing.enabled ?? true,
    showBestMove: existing.showBestMove ?? false,
    engineDepth: existing.engineDepth ?? 18,
    engineSource: existing.engineSource ?? 'wasm'
  });
});
