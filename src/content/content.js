// Chessist - Content Script
// Detects Chess.com board, extracts FEN, and displays evaluation bar

(function() {
  'use strict';

  let evalBar = null;
  let evalBarContainer = null; // #board-layout-evaluation (chess.com native wrapper)
  let evalBarFill = null;
  let evalScore = null;
  let bestMoveEl = null;
  let countdownEl = null;  // Countdown timer for auto-move
  let countdownInterval = null;  // Interval ID for countdown updates
  let depthEl = null;
  let turnIndicatorEl = null;  // Debug indicator for turn/player detection
  let currentFen = null;
  let currentTurn = 'w';  // Track whose turn it is
  let playerColor = null; // Track player's color (for perspective)
  let isEnabled = true;
  let showBestMove = false;
  let showOpponentBestMove = false;
  let showAltArrows = true;
  let showMoveIcon = false;
  let autoMove = false;
  let lastAutoMovePosition = null;  // Track position+turn where we last auto-moved to avoid duplicate moves
  let manualPlayerColor = 'auto';  // 'auto', 'w', or 'b' - manual override for player color
  let boardObserver = null;
  let arrowOverlay = null;  // SVG overlay for best move arrow
  let currentBestMove = null;  // Track current best move to avoid redrawing

  // W/L balance & throw mode
  let wlBalance = false;
  let maxConsecutiveWins = 2;
  let maxConsecutiveLosses = 3;
  let throwRandom = false;   // Randomise the win threshold each cycle
  let lossRandom = false;    // Randomise the loss threshold each cycle
  let targetAccuracy = 100;        // 100 = off (best move), lower = intentional errors
  let shouldThrowThisGame = false; // Set at game start: play badly to lose
  let shouldWinThisGame = false;   // Set at game start: play at full strength to win
  let gameOverHandled = false;     // Prevent double-recording per game

  // ELO matching
  let matchElo = false;
  let manualElo = null;  // null = auto-detect from page

  // Accuracy tracking
  let accuracyEl = null;
  let prevCpWhite = null;      // White-perspective eval before player's last move
  let prevBestMove = null;     // Best move recommended before player's last move
  let lastMoveToSquare = null; // Destination square of the last move played (for icon placement)
  let moveAccuracies = [];     // Per-move accuracy history for this game
  let accuracyEvalPending = false;  // Waiting for post-move eval to calculate accuracy
  const ACCURACY_EVAL_DEPTH = 10;   // Minimum depth for accuracy calculation

  let overlayMode = false; // Send eval data to native overlay window
  let manualMap = false;
  let manualOffsetX = 0;
  let manualOffsetY = 0;
  let targetDepth = 18; // Default depth
  let stealthMode = false; // Disable console logging when true
  let instantMove = false; // Make moves instantly without delay
  let smartTiming = true; // Adjust delay based on move complexity
  let autoRematch = false; // Auto click rematch
  let autoNewGame = false; // Auto click new game
  let autoMoveDelayMin = 0.5; // Minimum delay in seconds before auto-move
  let autoMoveDelayMax = 2; // Maximum delay in seconds before auto-move
  let skillLevel = 20; // Stockfish skill level (1-20, 20 = best)
  let lastGameUrl = null; // Track game URL for new game detection (Chess.com SPA)

  // Conditional logging - respects stealth mode
  function log(...args) {
    if (!stealthMode) {
      console.log(...args);
    }
  }

  // Extension context validity tracking
  let extensionContextValid = true;

  function checkExtensionContext() {
    try {
      // This will throw if context is invalid
      return chrome.runtime?.id != null;
    } catch (e) {
      return false;
    }
  }

  // Initialize settings from storage
  async function loadSettings() {
    try {
      const result = await chrome.storage.sync.get([
        'enabled', 'showBestMove', 'showOpponentBestMove', 'showAltArrows', 'showMoveIcon', 'autoMove', 'instantMove', 'smartTiming', 'autoRematch', 'autoNewGame',
        'stealthMode', 'engineDepth', 'playerColor', 'autoMoveDelayMin', 'autoMoveDelayMax', 'skillLevel',
        'targetAccuracy', 'wlBalance', 'maxConsecutiveWins', 'maxConsecutiveLosses', 'throwRandom',
        'lossRandom', 'matchElo', 'manualElo', 'overlayMode'
      ]);
      isEnabled = result.enabled !== false; // Default true
      showBestMove = result.showBestMove === true; // Default false
      showOpponentBestMove = result.showOpponentBestMove === true; // Default false
      showAltArrows = result.showAltArrows !== false; // Default true
      showMoveIcon = result.showMoveIcon === true; // Default false
      autoMove = result.autoMove === true; // Default false
      instantMove = result.instantMove === true; // Default false
      smartTiming = result.smartTiming !== false; // Default true
      autoRematch = result.autoRematch === true; // Default false
      autoNewGame = result.autoNewGame === true; // Default false
      stealthMode = result.stealthMode === true; // Default false
      targetDepth = result.engineDepth || 18;
      manualPlayerColor = result.playerColor || 'auto';
      autoMoveDelayMin = result.autoMoveDelayMin ?? 0.5;
      autoMoveDelayMax = result.autoMoveDelayMax ?? 2;
      skillLevel = result.skillLevel ?? 20;
      targetAccuracy = result.targetAccuracy ?? 100;
      wlBalance = result.wlBalance === true;
      maxConsecutiveWins = result.maxConsecutiveWins ?? 2;
      maxConsecutiveLosses = result.maxConsecutiveLosses ?? 3;
      throwRandom = result.throwRandom === true;
      lossRandom = result.lossRandom === true;
      matchElo = result.matchElo === true;
      manualElo = result.manualElo ?? null;
      overlayMode = result.overlayMode === true;
      const localData = await chrome.storage.local.get(['manualMap', 'manualOffsetX', 'manualOffsetY']);
      manualMap     = localData.manualMap     === true;
      manualOffsetX = localData.manualOffsetX ?? 0;
      manualOffsetY = localData.manualOffsetY ?? 0;
      if (overlayMode) {
        _connectOverlayWs();
        if (evalBar) evalBar.style.display = 'none';
        if (evalBarContainer) evalBarContainer.style.display = 'none';
        clearArrow();
        clearMoveIcon();
      }

      // Load throw/win state from local storage
      const local = await chrome.storage.local.get(['shouldThrowNextGame', 'shouldWinNextGame']);
      shouldThrowThisGame = false; // reset for this page load; will be set on new game
      if (local.shouldThrowNextGame) {
        log('Chessist: Throw flag pending from previous game');
      }
      if (local.shouldWinNextGame) {
        log('Chessist: Win flag pending from previous game');
      }
    } catch (e) {
      // Using default settings - don't log in case stealth mode is on
    }
  }

  // Piece mapping for FEN construction
  const pieceMap = {
    'wp': 'P', 'wn': 'N', 'wb': 'B', 'wr': 'R', 'wq': 'Q', 'wk': 'K',
    'bp': 'p', 'bn': 'n', 'bb': 'b', 'br': 'r', 'bq': 'q', 'bk': 'k'
  };

  // Convert square notation (e.g., "e2") to file/rank indices (0-7)
  function squareToIndices(square) {
    const file = square.charCodeAt(0) - 'a'.charCodeAt(0); // a=0, h=7
    const rank = parseInt(square[1]) - 1; // 1=0, 8=7
    return { file, rank };
  }

  // Get coordinates for a square center in viewBox units (0-100)
  // Chess.com uses viewBox="0 0 100 100", so each square is 12.5 units
  function getSquareCenter(square, isFlipped) {
    const { file, rank } = squareToIndices(square);
    const squareSize = 12.5; // 100 / 8

    let x, y;
    if (isFlipped) {
      // Black's perspective: a1 is top-right, h8 is bottom-left
      x = (7 - file + 0.5) * squareSize;
      y = (rank + 0.5) * squareSize;
    } else {
      // White's perspective: a1 is bottom-left, h8 is top-right
      x = (file + 0.5) * squareSize;
      y = (7 - rank + 0.5) * squareSize;
    }

    return { x, y };
  }

  // Create SVG arrow overlay on the board
  // Uses viewBox="0 0 100 100" to match Chess.com's coordinate system
  function createArrowOverlay(board) {
    if (overlayMode) return null;
    // Check if existing overlay is still valid (inside the board)
    if (arrowOverlay && arrowOverlay.parentElement === board) {
      return arrowOverlay;
    }

    // Remove any stale arrow overlays
    if (arrowOverlay) {
      arrowOverlay.remove();
      arrowOverlay = null;
    }

    // Also remove any old overlays that might be lingering
    document.querySelectorAll('.chess-live-eval-arrow-overlay').forEach(el => el.remove());

    // Create SVG element with viewBox matching Chess.com's system
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('class', 'chess-live-eval-arrow-overlay');
    svg.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 100;
    `;

    // Ensure board has position: relative so absolute children are positioned correctly
    const boardComputedStyle = window.getComputedStyle(board);
    if (boardComputedStyle.position === 'static') {
      board.style.position = 'relative';
    }

    // Insert SVG directly into the wc-chess-board element
    board.appendChild(svg);
    arrowOverlay = svg;

    return svg;
  }

  // Draw a single arrow on an SVG group. color/opacity/strokeWidth are visual params.
  function drawArrow(group, fromSquare, toSquare, isFlipped, color, opacity, strokeWidth) {
    const from = getSquareCenter(fromSquare, isFlipped);
    const to   = getSquareCenter(toSquare,   isFlipped);

    if (isNaN(from.x) || isNaN(from.y) || isNaN(to.x) || isNaN(to.y)) return;

    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const angle = Math.atan2(dy, dx);
    if (isNaN(angle)) return;

    const arrowHeadLength = 3.8;
    const arrowHeadWidth  = 3.8;

    const lineEndX = to.x - Math.cos(angle) * arrowHeadLength * 0.6;
    const lineEndY = to.y - Math.sin(angle) * arrowHeadLength * 0.6;

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', from.x.toFixed(2));
    line.setAttribute('y1', from.y.toFixed(2));
    line.setAttribute('x2', lineEndX.toFixed(2));
    line.setAttribute('y2', lineEndY.toFixed(2));
    line.setAttribute('stroke', color);
    line.setAttribute('stroke-width', strokeWidth);
    line.setAttribute('stroke-linecap', 'round');
    line.setAttribute('opacity', opacity);

    const headBaseX = to.x - Math.cos(angle) * arrowHeadLength;
    const headBaseY = to.y - Math.sin(angle) * arrowHeadLength;
    const perpX = Math.sin(angle) * arrowHeadWidth / 2;
    const perpY = -Math.cos(angle) * arrowHeadWidth / 2;

    const head = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    head.setAttribute('points', `
      ${to.x.toFixed(2)},${to.y.toFixed(2)}
      ${(headBaseX + perpX).toFixed(2)},${(headBaseY + perpY).toFixed(2)}
      ${(headBaseX - perpX).toFixed(2)},${(headBaseY - perpY).toFixed(2)}
    `);
    head.setAttribute('fill', color);
    head.setAttribute('opacity', opacity);

    group.appendChild(line);
    group.appendChild(head);
  }

  // Draw best move arrow(s).
  // multiPvMoves is an array of up to 3 independent best moves from MultiPV analysis:
  //   [0] = best move  → purple, full opacity
  //   [1] = 2nd best   → yellow, medium opacity
  //   [2] = 3rd best   → red,    low opacity
  function drawBestMoveArrow(move, multiPvMoves) {
    if (!move || move.length < 4) {
      clearArrow();
      return;
    }

    const board = findBoard();
    if (!board) return;

    const isFlipped = board.classList?.contains('flipped') ||
                      board.getAttribute('data-flipped') === 'true' ||
                      playerColor === 'b';

    const svg = createArrowOverlay(board);
    if (!svg) return;

    const existingGroup = svg.querySelector('.best-move-arrow-group');
    if (existingGroup) existingGroup.remove();

    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    group.setAttribute('class', 'best-move-arrow-group');

    const alts = (multiPvMoves || []).filter(m => m && m.length >= 4);

    // Draw alternatives first (behind best move)
    if (showAltArrows) {
      if (alts[2]) {
        drawArrow(group, alts[2].substring(0, 2), alts[2].substring(2, 4),
                  isFlipped, '#e05050', '0.45', 1.6);
      }
      if (alts[1]) {
        drawArrow(group, alts[1].substring(0, 2), alts[1].substring(2, 4),
                  isFlipped, '#e0b840', '0.55', 1.8);
      }
    }
    // Best move on top
    drawArrow(group, move.substring(0, 2), move.substring(2, 4),
              isFlipped, '#792A9E', '0.9', 2.2);

    svg.appendChild(group);
    currentBestMove = move;
  }

  // Clear the best move arrow
  function clearArrow() {
    if (arrowOverlay) {
      const existingGroup = arrowOverlay.querySelector('.best-move-arrow-group');
      if (existingGroup) existingGroup.remove();
    }
    currentBestMove = null;
  }

  // Draw move classification icon on the board SVG at the top-right of the destination square
  function drawMoveIconOnBoard(toSquare, classification) {
    const board = findBoard();
    if (!board) return;

    const isFlipped = board.classList?.contains('flipped') ||
                      board.getAttribute('data-flipped') === 'true' ||
                      playerColor === 'b';

    const svg = createArrowOverlay(board);
    if (!svg) return;

    // Remove any existing icon
    const existing = svg.querySelector('.move-icon-group');
    if (existing) existing.remove();

    if (!showMoveIcon || overlayMode) return;

    const { file, rank } = squareToIndices(toSquare);
    const squareSize = 12.5;
    let squareX, squareY;
    if (isFlipped) {
      squareX = (7 - file) * squareSize;
      squareY = rank * squareSize;
    } else {
      squareX = file * squareSize;
      squareY = (7 - rank) * squareSize;
    }

    // Icon is placed at the top-right corner of the destination square, scaled to ~3.5 units
    const iconSize = 3.8;
    const iconX = squareX + squareSize - iconSize + 0.2;
    const iconY = squareY - 0.2;

    const { bg, inner } = getMoveIconParts(classification);

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', 'move-icon-group');
    g.setAttribute('transform', `translate(${iconX}, ${iconY}) scale(${iconSize / 18})`);
    g.innerHTML =
      `<path opacity="0.3" d="M9,.5a9,9,0,1,0,9,9A9,9,0,0,0,9,.5Z"/>` +
      `<path fill="${bg}" d="M9,0a9,9,0,1,0,9,9A9,9,0,0,0,9,0Z"/>` +
      inner;

    svg.appendChild(g);
  }

  // Return bg color and inner SVG paths for a classification (split from getMoveIconSvg)
  function getMoveIconParts(classification) {
    const icons = {
      best:       { bg: '#81B64C', inner: `<path fill="#fff" d="M9,2.93A.5.5,0,0,0,8.73,3a.46.46,0,0,0-.17.22L7.24,6.67l-3.68.19A.52.52,0,0,0,3.3,7a.53.53,0,0,0-.16.23.45.45,0,0,0,0,.28.44.44,0,0,0,.15.23L6.15,10l-1,3.56a.45.45,0,0,0,0,.28.46.46,0,0,0,.17.22.41.41,0,0,0,.26.09.43.43,0,0,0,.27-.08l3.09-2,3.09,2a.46.46,0,0,0,.53,0,.46.46,0,0,0,.17-.22.53.53,0,0,0,0-.28l-1-3.56L14.71,7.7a.44.44,0,0,0,.15-.23.45.45,0,0,0,0-.28A.53.53,0,0,0,14.7,7a.52.52,0,0,0-.26-.1l-3.68-.2L9.44,3.23A.46.46,0,0,0,9.27,3,.5.5,0,0,0,9,2.93Z"/>` },
      excellent:  { bg: '#81B64C', inner: `<path fill="#fff" d="M13.79,10.84c0-.2.4-.53.4-.94S14,9.22,14,9.08a2.06,2.06,0,0,0,.18-.83,1,1,0,0,0-.3-.69,1.13,1.13,0,0,0-.55-.2,10.29,10.29,0,0,1-2.07,0c-.37-.23,0-1.18.18-1.7s.51-2.12-.77-2.43c-.69-.17-.66.37-.78.9-.05.21-.09.43-.13.57A5,5,0,0,1,7.05,7.73a1.57,1.57,0,0,1-.42.18v4.94A7.23,7.23,0,0,1,8,13c.52.12.91.25,1.44.33a11.11,11.11,0,0,0,1.62.16,6.65,6.65,0,0,0,1.18,0,1.09,1.09,0,0,0,1-.59.66.66,0,0,0,.06-.2,1.63,1.63,0,0,1,.07-.3c.13-.28.37-.3.5-.68S13.74,11,13.79,10.84Z"/><path fill="#fff" d="M5.49,7.59H4.31a.5.5,0,0,0-.5.5v4.56a.5.5,0,0,0,.5.5H5.49a.5.5,0,0,0,.5-.5V8.09A.5.5,0,0,0,5.49,7.59Z"/>` },
      good:       { bg: '#95b776', inner: `<path fill="#fff" d="M15.11,6.31,9.45,12,7.79,13.63a.39.39,0,0,1-.28.11.39.39,0,0,1-.27-.11L2.89,9.28A.39.39,0,0,1,2.78,9a.39.39,0,0,1,.11-.27L4.28,7.35a.34.34,0,0,1,.12-.09l.15,0a.37.37,0,0,1,.15,0,.38.38,0,0,1,.13.09L7.52,10l5.65-5.65a.38.38,0,0,1,.13-.09.37.37,0,0,1,.15,0,.4.4,0,0,1,.15,0,.34.34,0,0,1,.12.09l1.39,1.38a.41.41,0,0,1,.08.13.33.33,0,0,1,0,.15.4.4,0,0,1,0,.15A.5.5,0,0,1,15.11,6.31Z"/>` },
      inaccuracy: { bg: '#F7C631', inner: `<path fill="#fff" d="M10.32,14.1a.27.27,0,0,1,0,.13.44.44,0,0,1-.08.11l-.11.08-.13,0H8l-.13,0-.11-.08a.41.41,0,0,1-.08-.24V12.2a.27.27,0,0,1,0-.13.36.36,0,0,1,.07-.1.39.39,0,0,1,.1-.08l.13,0h2a.31.31,0,0,1,.24.1.39.39,0,0,1,.08.1.51.51,0,0,1,0,.13Zm-.12-3.93a.17.17,0,0,1,0,.12.41.41,0,0,1-.07.11.4.4,0,0,1-.23.08H8.1a.31.31,0,0,1-.34-.31L7.61,3.4a.36.36,0,0,1,.09-.24.23.23,0,0,1,.11-.08.27.27,0,0,1,.13,0h2.11a.32.32,0,0,1,.25.1.36.36,0,0,1,.09.24Z"/>` },
      mistake:    { bg: '#FFA459', inner: `<path fill="#fff" d="M9.92,14.52a.27.27,0,0,1,0,.12.41.41,0,0,1-.07.11.32.32,0,0,1-.23.09H7.7a.25.25,0,0,1-.12,0,.27.27,0,0,1-.1-.08.31.31,0,0,1-.09-.22V12.69a.32.32,0,0,1,.09-.23l.1-.07.12,0H9.59a.32.32,0,0,1,.23.09.61.61,0,0,1,.07.1.28.28,0,0,1,0,.13Zm2.2-7.17a3.1,3.1,0,0,1-.36.73,5.58,5.58,0,0,1-.49.6,6,6,0,0,1-.52.49,8,8,0,0,0-.65.63,1,1,0,0,0-.27.7v.22a.24.24,0,0,1,0,.12.17.17,0,0,1-.06.1.3.3,0,0,1-.1.07l-.12,0H7.79l-.12,0a.3.3,0,0,1-.1-.07.26.26,0,0,1-.07-.1.37.37,0,0,1,0-.12v-.35a2.42,2.42,0,0,1,.13-.84,2.55,2.55,0,0,1,.33-.66,3.38,3.38,0,0,1,.45-.55c.16-.15.33-.29.49-.42a7.73,7.73,0,0,0,.64-.64,1,1,0,0,0,.26-.67.77.77,0,0,0-.07-.34A.75.75,0,0,0,9.48,6a1.16,1.16,0,0,0-.72-.24,1.61,1.61,0,0,0-.49.07A3,3,0,0,0,7.86,6a1.41,1.41,0,0,0-.29.18l-.11.09a.5.5,0,0,1-.24.06A.31.31,0,0,1,7,6.19L6,5a.29.29,0,0,1,0-.4,1.36,1.36,0,0,1,.21-.2A3.07,3.07,0,0,1,6.81,4a5.38,5.38,0,0,1,.89-.37,3.75,3.75,0,0,1,1.2-.17,4.07,4.07,0,0,1,1.2.19,4,4,0,0,1,1.09.56,2.76,2.76,0,0,1,.78.92,2.82,2.82,0,0,1,.28,1.28A3,3,0,0,1,12.12,7.35Z"/>` },
      blunder:    { bg: '#FA412D', inner: `<path fill="#fff" d="M14.74,5A2.58,2.58,0,0,0,14,4a3.76,3.76,0,0,0-1.09-.56,4.07,4.07,0,0,0-1.2-.19,3.92,3.92,0,0,0-1.18.17,5.87,5.87,0,0,0-.9.37,3,3,0,0,0-.32.2,3.46,3.46,0,0,1,.42.63,3.29,3.29,0,0,1,.36,1.47.31.31,0,0,0,.19-.06L10.37,6a2.9,2.9,0,0,1,.29-.19,3.89,3.89,0,0,1,.41-.17,1.55,1.55,0,0,1,.48-.07,1.1,1.1,0,0,1,.72.24.72.72,0,0,1,.23.26.8.8,0,0,1,.07.34,1,1,0,0,1-.25.67,7.71,7.71,0,0,1-.65.63,6.2,6.2,0,0,0-.48.43,2.93,2.93,0,0,0-.45.54,2.55,2.55,0,0,0-.33.66,2.62,2.62,0,0,0-.13.83v.35a.24.24,0,0,0,0,.12.35.35,0,0,0,.17.17l.12,0h1.71l.12,0a.23.23,0,0,0,.1-.07.21.21,0,0,0,.06-.1.27.27,0,0,0,0-.12V10.3a1,1,0,0,1,.26-.7q.27-.28.66-.63a5.79,5.79,0,0,0,.51-.48,4.51,4.51,0,0,0,.48-.6,2.56,2.56,0,0,0,.36-.72,2.81,2.81,0,0,0,.14-1A2.66,2.66,0,0,0,14.74,5Z"/><path fill="#fff" d="M12.38,12.15H10.5l-.12,0a.34.34,0,0,0-.18.29v1.82a.36.36,0,0,0,.08.23.23.23,0,0,0,.1.07l.12,0h1.88a.24.24,0,0,0,.12,0,.26.26,0,0,0,.11-.07.36.36,0,0,0,.07-.1.28.28,0,0,0,0-.13V12.46a.27.27,0,0,0,0-.12.61.61,0,0,0-.07-.1A.32.32,0,0,0,12.38,12.15Z"/><path fill="#fff" d="M6.79,12.15H4.91l-.12,0a.34.34,0,0,0-.18.29v1.82a.36.36,0,0,0,.08.23.23.23,0,0,0,.1.07l.12,0H6.79a.24.24,0,0,0,.12,0A.26.26,0,0,0,7,14.51a.36.36,0,0,0,.07-.1.28.28,0,0,0,0-.13V12.46a.27.27,0,0,0,0-.12.61.61,0,0,0-.07-.1A.32.32,0,0,0,6.79,12.15Z"/><path fill="#fff" d="M8.39,4A3.76,3.76,0,0,0,7.3,3.48a4.07,4.07,0,0,0-1.2-.19,3.92,3.92,0,0,0-1.18.17,5.87,5.87,0,0,0-.9.37,3.37,3.37,0,0,0-.55.38l-.21.19a.32.32,0,0,0,0,.41l1,1.2a.26.26,0,0,0,.2.12.48.48,0,0,0,.24-.06L4.78,6a2.9,2.9,0,0,1,.29-.19l.4-.17A1.66,1.66,0,0,1,6,5.56a1.1,1.1,0,0,1,.72.24.72.72,0,0,1,.23.26A.77.77,0,0,1,7,6.4a1,1,0,0,1-.26.67,7.6,7.6,0,0,1-.64.63,6.28,6.28,0,0,0-.49.43,2.93,2.93,0,0,0-.45.54,2.72,2.72,0,0,0-.33.66,2.62,2.62,0,0,0-.13.83v.35a.43.43,0,0,0,0,.12.39.39,0,0,0,.08.1.18.18,0,0,0,.1.07.21.21,0,0,0,.12,0H6.72l.12,0a.23.23,0,0,0,.1-.07.36.36,0,0,0,.07-.1.5.5,0,0,0,0-.12V10.3a1,1,0,0,1,.27-.7A8,8,0,0,1,8,9c.18-.15.35-.31.52-.48A7,7,0,0,0,9,7.89a3.23,3.23,0,0,0,.36-.72,3.07,3.07,0,0,0,.13-1A2.66,2.66,0,0,0,9.15,5,2.58,2.58,0,0,0,8.39,4Z"/>` },
    };
    return icons[classification] || icons.good;
  }

  function clearMoveIcon() {
    if (arrowOverlay) {
      const existing = arrowOverlay.querySelector('.move-icon-group');
      if (existing) existing.remove();
    }
  }

  // Attempt to execute a move by injecting a <script> into the page context.
  // Page-context JS can call Chess.com's internal APIs directly and dispatch trusted events.
  // Returns true if an injection attempt was made (not guaranteed to succeed).
  function tryPageContextMove(from, to, promotion) {
    try {
      const promoStr = promotion ? JSON.stringify(promotion) : 'null';
      const script = document.createElement('script');
      script.textContent = `
(function() {
  var from = ${JSON.stringify(from)}, to = ${JSON.stringify(to)}, promo = ${promoStr};
  // Try wc-chess-board game API
  var board = document.querySelector('wc-chess-board') || document.querySelector('chess-board');
  if (!board) return;

  // Attempt 1: .game.move()
  try {
    if (board.game && typeof board.game.move === 'function') {
      board.game.move(from, to, promo);
      return;
    }
  } catch(e) {}

  // Attempt 2: Vue component controller
  try {
    var vc = board.__vue_app__
      || board._vei
      || board.__vueParentComponent
      || (board.__vue__ && board.__vue__.$parent);
    // Walk up to find a component with a makeMove / submitMove method
    var comp = board.__vue_app__?.config?.globalProperties;
    if (!comp) {
      var el = board;
      while (el) {
        var vnode = el._vei || el.__vueParentComponent;
        if (vnode) { comp = vnode.ctx || vnode.proxy; break; }
        el = el.parentElement;
      }
    }
    if (comp) {
      var fn = comp.makeMove || comp.submitMove || comp.playMove || comp.move;
      if (typeof fn === 'function') { fn.call(comp, from, to, promo); return; }
    }
  } catch(e) {}

  // Attempt 3: Trusted pointer events via page context (bypasses isTrusted check)
  try {
    function squareToXY(sq, rect, flipped) {
      var files = 'abcdefgh', f = files.indexOf(sq[0]), r = parseInt(sq[1]) - 1;
      var sz = rect.width / 8;
      var x, y;
      if (flipped) { x = rect.left + (7 - f + 0.5) * sz; y = rect.top + (r + 0.5) * sz; }
      else         { x = rect.left + (f + 0.5) * sz;     y = rect.top + (7 - r + 0.5) * sz; }
      return { x: x, y: y };
    }
    var flipped = board.classList.contains('flipped') || board.getAttribute('board-orientation') === 'black';
    var rect = board.getBoundingClientRect();
    var fp = squareToXY(from, rect, flipped);
    var tp = squareToXY(to, rect, flipped);
    function fire(el, type, x, y, btns) {
      el.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, composed: true,
        clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse',
        isPrimary: true, button: 0, buttons: btns != null ? btns : 1
      }));
    }
    var fromEl = document.elementFromPoint(fp.x, fp.y) || board;
    fire(fromEl, 'pointerdown', fp.x, fp.y, 1);
    fire(fromEl, 'pointerup',   fp.x, fp.y, 0);
    fromEl.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true, clientX: fp.x, clientY: fp.y }));
    setTimeout(function() {
      var toEl = document.elementFromPoint(tp.x, tp.y) || board;
      fire(toEl, 'pointerdown', tp.x, tp.y, 1);
      fire(toEl, 'pointerup',   tp.x, tp.y, 0);
      toEl.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true, clientX: tp.x, clientY: tp.y }));
    }, 30);
  } catch(e) {}
})();
      `;
      document.head.appendChild(script);
      script.remove();
      console.log('[Chessist AutoMove] page-context script injected');
      return true;
    } catch (e) {
      console.log('[Chessist AutoMove] page-context injection failed:', e);
      return false;
    }
  }

  // Execute a move on the board (auto-move feature)
  function executeMove(move) {
    if (!move || move.length < 4) return false;

    const board = findBoard();
    if (!board) return false;

    const fromSquare = move.substring(0, 2);
    const toSquare = move.substring(2, 4);
    const promotion = move.length > 4 ? move[4] : null;

    log(`Chessist: Auto-moving ${fromSquare} to ${toSquare}${promotion ? ' promoting to ' + promotion : ''}`);

    // Method 1: Try Chess.com's game API directly
    try {
      if (board.game && typeof board.game.move === 'function') {
        board.game.move(fromSquare, toSquare, promotion);
        return true;
      }
    } catch (e) {
      log('Chessist: Game API move failed:', e);
    }

    // Method 2: Simulate drag via pointer events
    const isFlipped = board.classList?.contains('flipped') ||
                      board.getAttribute('data-flipped') === 'true' ||
                      board.hasAttribute('flipped') ||
                      board.flipped === true;
    return simulateMove(board, fromSquare, toSquare, isFlipped, promotion);
  }

  // Get the actual board surface element (inner .board inside wc-chess-board)
  function getBoardSurface(board) {
    return board.querySelector('.board') ||
           board.shadowRoot?.querySelector('.board') ||
           board;
  }

  // Fire a full click sequence (pointerdown + mousedown + pointerup + mouseup + click) at a point
  function fireClickAt(target, x, y) {
    const opts = (extra) => Object.assign({
      bubbles: true, cancelable: true, view: window,
      clientX: x, clientY: y, button: 0, buttons: 1
    }, extra);

    target.dispatchEvent(new PointerEvent('pointerdown', opts({ pointerId: 1, pointerType: 'mouse', isPrimary: true })));
    target.dispatchEvent(new MouseEvent('mousedown', opts({})));
    target.dispatchEvent(new PointerEvent('pointerup', opts({ pointerId: 1, pointerType: 'mouse', isPrimary: true, buttons: 0 })));
    target.dispatchEvent(new MouseEvent('mouseup', opts({ buttons: 0 })));
    target.dispatchEvent(new MouseEvent('click', opts({ buttons: 0 })));
  }

  // Get pixel coordinates for a square center, using the actual board surface rect
  function getSquarePixel(surface, square, isFlipped) {
    const rect = surface.getBoundingClientRect();
    const squareSize = rect.width / 8;
    const { file, rank } = squareToIndices(square);

    let x, y;
    if (isFlipped) {
      x = rect.left + (7 - file + 0.5) * squareSize;
      y = rect.top + (rank + 0.5) * squareSize;
    } else {
      x = rect.left + (file + 0.5) * squareSize;
      y = rect.top + (7 - rank + 0.5) * squareSize;
    }
    return { x, y };
  }

  // Simulate a move using drag (pointerdown on piece → pointermove → pointerup at destination).
  function simulateMove(board, from, to, isFlipped, promotion) {
    const pieceEl = findPieceOnSquare(board, from);
    if (!pieceEl) {
      log('Chessist: Could not find piece on', from);
      return false;
    }

    const boardRect = board.getBoundingClientRect();
    const squareSize = boardRect.width / 8;

    const pieceRect = pieceEl.getBoundingClientRect();
    const fromX = pieceRect.left + pieceRect.width / 2;
    const fromY = pieceRect.top + pieceRect.height / 2;

    const { file: toFile, rank: toRank } = squareToIndices(to);
    let toX, toY;
    if (isFlipped) {
      toX = boardRect.left + (7 - toFile + 0.5) * squareSize;
      toY = boardRect.top + (toRank + 0.5) * squareSize;
    } else {
      toX = boardRect.left + (toFile + 0.5) * squareSize;
      toY = boardRect.top + (7 - toRank + 0.5) * squareSize;
    }

    log(`Chessist: Simulating drag from (${fromX.toFixed(0)},${fromY.toFixed(0)}) to (${toX.toFixed(0)},${toY.toFixed(0)})`);

    pieceEl.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, view: window, clientX: fromX, clientY: fromY, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1 }));
    pieceEl.dispatchEvent(new MouseEvent('mousedown',     { bubbles: true, cancelable: true, view: window, clientX: fromX, clientY: fromY, button: 0, buttons: 1 }));

    setTimeout(() => {
      document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, view: window, clientX: toX, clientY: toY, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1 }));
      document.dispatchEvent(new MouseEvent('mousemove',     { bubbles: true, cancelable: true, view: window, clientX: toX, clientY: toY, button: 0, buttons: 1 }));

      setTimeout(() => {
        document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, view: window, clientX: toX, clientY: toY, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0 }));
        document.dispatchEvent(new MouseEvent('mouseup',     { bubbles: true, cancelable: true, view: window, clientX: toX, clientY: toY, button: 0 }));

        if (promotion) {
          setTimeout(() => handlePromotion(promotion), 200);
        }
      }, 50);
    }, 50);

    return true;
  }

  // Find a piece element on a specific square
  function findPieceOnSquare(board, square) {
    const { file, rank } = squareToIndices(square);
    const squareNum = (file + 1) * 10 + (rank + 1);
    const squareClass = `square-${squareNum}`;

    // Look for piece with this square class
    let el = board.querySelector(`.piece.${squareClass}`);
    if (!el && board.shadowRoot) {
      el = board.shadowRoot.querySelector(`.piece.${squareClass}`);
    }

    return el;
  }

  // Handle pawn promotion selection
  function handlePromotion(piece) {
    // Chess.com shows a promotion dialog - try to click the right piece
    const promotionMap = {
      'q': 'queen',
      'r': 'rook',
      'b': 'bishop',
      'n': 'knight'
    };

    const pieceName = promotionMap[piece.toLowerCase()] || 'queen';

    // Try to find and click the promotion piece
    const promotionEl = document.querySelector(`.promotion-piece.${pieceName}, [data-piece="${pieceName}"], .promotion-${pieceName}`);
    if (promotionEl) {
      promotionEl.click();
    }
  }

  // Find the chess board element
  function findBoard() {
    // Try different selectors used by Chess.com
    const selectors = [
      'wc-chess-board',           // Web component board
      'chess-board',              // Older board
      '.board',                   // Generic board class
      '[class*="board-"]'         // Board with variant classes
    ];

    for (const selector of selectors) {
      const board = document.querySelector(selector);
      if (board) return board;
    }
    return null;
  }

  // Extract FEN from Chess.com board
  function extractFEN(board) {
    // Method 1: Try to get FEN from Chess.com's game controller
    try {
      // Chess.com stores game data in various places
      const gameTag = document.querySelector('chess-board, wc-chess-board');
      if (gameTag) {
        // Try game property
        if (gameTag.game?.getFEN) {
          return gameTag.game.getFEN();
        }
        if (gameTag.game?.fen) {
          return typeof gameTag.game.fen === 'function' ? gameTag.game.fen() : gameTag.game.fen;
        }
      }
    } catch (e) {}

    // Method 2: Check for data-fen attribute
    const gameElement = document.querySelector('[data-fen]');
    if (gameElement) {
      return gameElement.getAttribute('data-fen');
    }

    // Method 3: Try to find FEN in window objects (Chess.com exposes game state)
    try {
      // Look for game controller in common locations
      const gameController = window.chessboard?.game ||
                             document.querySelector('wc-chess-board')?.__vue__?.game ||
                             document.querySelector('.board')?.closest('[class*="game"]')?.__game;
      if (gameController?.getFEN) {
        return gameController.getFEN();
      }
    } catch (e) {}

    // Method 4: Parse pieces from DOM (fallback)
    return parsePiecesFromDOM(board);
  }

  // Determine castling rights based on king and rook positions
  function determineCastlingRights(boardArray) {
    let rights = '';

    // White kingside: King on e1 (rank 1 = index 7, file e = index 4), Rook on h1 (file h = index 7)
    const whiteKingOnE1 = boardArray[7][4] === 'K';
    const whiteRookOnH1 = boardArray[7][7] === 'R';
    const whiteRookOnA1 = boardArray[7][0] === 'R';

    // Black kingside: King on e8 (rank 8 = index 0, file e = index 4), Rook on h8 (file h = index 7)
    const blackKingOnE8 = boardArray[0][4] === 'k';
    const blackRookOnH8 = boardArray[0][7] === 'r';
    const blackRookOnA8 = boardArray[0][0] === 'r';

    // If king is on starting square and rook is on starting square, castling MAY be possible
    // Note: We can't know for certain if they've moved and returned, but this is better than hardcoding
    if (whiteKingOnE1 && whiteRookOnH1) rights += 'K';
    if (whiteKingOnE1 && whiteRookOnA1) rights += 'Q';
    if (blackKingOnE8 && blackRookOnH8) rights += 'k';
    if (blackKingOnE8 && blackRookOnA8) rights += 'q';

    return rights || '-';
  }

  // Parse piece positions from DOM elements
  function parsePiecesFromDOM(board) {
    // Try multiple selectors for pieces
    let pieces = board.querySelectorAll('.piece');

    // If using shadow DOM (wc-chess-board)
    if (!pieces.length && board.shadowRoot) {
      pieces = board.shadowRoot.querySelectorAll('.piece');
    }

    // Try getting pieces from the entire document if board query fails
    if (!pieces.length) {
      pieces = document.querySelectorAll('wc-chess-board .piece, chess-board .piece, .board .piece');
    }

    if (!pieces.length) return null;

    // Initialize empty board
    const boardArray = Array(8).fill(null).map(() => Array(8).fill(null));

    pieces.forEach(piece => {
      // Get piece type from class (e.g., 'piece wk square-51' or 'piece bb square-36')
      const classes = piece.className.split(' ');
      let pieceType = null;
      let square = null;

      for (const cls of classes) {
        // Check for piece type (2 chars: color + piece)
        if (cls.length === 2 && pieceMap[cls]) {
          pieceType = pieceMap[cls];
        }
        // Check for square position
        if (cls.startsWith('square-')) {
          square = cls.replace('square-', '');
        }
      }

      // Chess.com uses square-XY where X is file (1-8) and Y is rank (1-8)
      if (pieceType && square) {
        let file, rank;

        if (square.length === 2) {
          // Format: "51" means file 5, rank 1
          file = parseInt(square[0]) - 1; // 1-8 to 0-7
          rank = parseInt(square[1]) - 1; // 1-8 to 0-7
        } else if (square.length === 3) {
          // Format might be different, try parsing
          file = parseInt(square.substring(0, 1)) - 1;
          rank = parseInt(square.substring(1)) - 1;
        }

        if (file >= 0 && file < 8 && rank >= 0 && rank < 8) {
          // Board array: index 0 = rank 8, index 7 = rank 1
          boardArray[7 - rank][file] = pieceType;
        }
      }
    });

    // Convert to FEN
    let fen = '';
    for (let rank = 0; rank < 8; rank++) {
      let empty = 0;
      for (let file = 0; file < 8; file++) {
        const piece = boardArray[rank][file];
        if (piece) {
          if (empty > 0) {
            fen += empty;
            empty = 0;
          }
          fen += piece;
        } else {
          empty++;
        }
      }
      if (empty > 0) fen += empty;
      if (rank < 7) fen += '/';
    }

    // Determine whose turn from move indicators
    const turn = detectTurn();

    // Determine castling rights based on king/rook positions
    const castlingRights = determineCastlingRights(boardArray);

    // Basic FEN with minimal info (position + turn + castling)
    fen += ` ${turn} ${castlingRights} - 0 1`;

    return fen;
  }

  // Detect if we're in puzzle mode
  function isPuzzleMode() {
    // Check URL for puzzle indicators
    if (window.location.pathname.includes('/puzzles') ||
        window.location.pathname.includes('/puzzle')) {
      return true;
    }
    // Check for puzzle-specific elements
    if (document.querySelector('.puzzle-component, .puzzle-board, [class*="puzzle"]')) {
      return true;
    }
    // Check for puzzle header/title
    if (document.querySelector('.puzzle-title, .daily-puzzle, [class*="DailyPuzzle"]')) {
      return true;
    }
    return false;
  }

  // Detect player's color (which side they're playing)
  function detectPlayerColor() {
    // Manual override takes priority
    if (manualPlayerColor === 'w') {
      log('Chessist: Using manual player color: white');
      return 'w';
    }
    if (manualPlayerColor === 'b') {
      log('Chessist: Using manual player color: black');
      return 'b';
    }

    // Puzzle detection: Check coach speech for "X to move" (Daily puzzles)
    // Class-based detection (most reliable)
    const puzzleColorIcon = document.querySelector('.cc-coach-feedback-detail-icon.cc-coach-feedback-detail-colorToMove');
    if (puzzleColorIcon) {
      if (puzzleColorIcon.classList.contains('cc-coach-feedback-detail-black-to-move')) {
        log('Chessist: Detected black via puzzle coach (class)');
        return 'b';
      }
      if (puzzleColorIcon.classList.contains('cc-coach-feedback-detail-white-to-move')) {
        log('Chessist: Detected white via puzzle coach (class)');
        return 'w';
      }
    }

    // Text-based detection (fallback for daily puzzles)
    const puzzleColorText = document.querySelector('.cc-coach-feedback-detail-text');
    if (puzzleColorText) {
      const text = puzzleColorText.textContent?.toLowerCase() || '';
      if (text.includes('black to move')) {
        log('Chessist: Detected black via puzzle coach (text)');
        return 'b';
      }
      if (text.includes('white to move')) {
        log('Chessist: Detected white via puzzle coach (text)');
        return 'w';
      }
    }

    // Puzzle Rush detection: Check sidebar status square
    const puzzleRushSquare = document.querySelector('.sidebar-status-square-sidebar-square');
    if (puzzleRushSquare) {
      if (puzzleRushSquare.classList.contains('sidebar-status-square-black')) {
        log('Chessist: Detected black via puzzle rush sidebar (class)');
        return 'b';
      }
      if (puzzleRushSquare.classList.contains('sidebar-status-square-white')) {
        log('Chessist: Detected white via puzzle rush sidebar (class)');
        return 'w';
      }
    }

    // Puzzle Rush text detection (fallback)
    const puzzleRushHeading = document.querySelector('.section-heading-title');
    if (puzzleRushHeading) {
      const text = puzzleRushHeading.textContent?.toLowerCase() || '';
      if (text.includes('black to move')) {
        log('Chessist: Detected black via puzzle rush heading (text)');
        return 'b';
      }
      if (text.includes('white to move')) {
        log('Chessist: Detected white via puzzle rush heading (text)');
        return 'w';
      }
    }

    // Check board orientation FIRST - this is the most reliable for puzzles
    const board = document.querySelector('wc-chess-board');

    // Method 1: Check if board is flipped - if flipped, player is black
    if (board?.classList.contains('flipped')) {
      log('Chessist: Detected black via flipped class');
      return 'b';
    }

    // Method 1b: Check board's flipped attribute or property
    if (board?.hasAttribute('flipped') || board?.flipped === true) {
      log('Chessist: Detected black via flipped attribute');
      return 'b';
    }

    // Method 1b2: Check Chess.com's coordinate SVG
    // In the SVG, if rank "1" has small y (near top) or file "a" has large x (near right), board is flipped
    if (board) {
      const coordSvg = board.querySelector('svg.coordinates') || board.shadowRoot?.querySelector('svg.coordinates');
      if (coordSvg) {
        const textElements = coordSvg.querySelectorAll('text');
        for (const text of textElements) {
          const content = text.textContent?.trim();
          const y = parseFloat(text.getAttribute('y'));
          const x = parseFloat(text.getAttribute('x'));

          // If rank "1" is near the top (y < 50 in viewBox 0-100), board is flipped
          if (content === '1' && y < 50) {
            log('Chessist: Detected black via SVG rank 1 at top (y=' + y + ')');
            return 'b';
          }
          // If rank "8" is near the top, board is normal (white's view)
          if (content === '8' && y < 50) {
            log('Chessist: Detected white via SVG rank 8 at top (y=' + y + ')');
            return 'w';
          }
          // If file "a" is on the right (x > 50), board is flipped
          if (content === 'a' && x > 50) {
            log('Chessist: Detected black via SVG file a on right (x=' + x + ')');
            return 'b';
          }
          // If file "a" is on the left, board is normal
          if (content === 'a' && x < 50) {
            log('Chessist: Detected white via SVG file a on left (x=' + x + ')');
            return 'w';
          }
        }
      }
    }

    // Method 1b3: Check for piece visual position - if white pieces are visually at top, board is flipped
    if (board) {
      const whiteKing = board.querySelector('.piece.wk') || board.shadowRoot?.querySelector('.piece.wk');
      if (whiteKing) {
        const kingRect = whiteKing.getBoundingClientRect();
        const boardRect = board.getBoundingClientRect();
        // If white king is in the top half of the board visually, player is black
        if (kingRect.top < boardRect.top + boardRect.height / 2) {
          log('Chessist: Detected black via white king position');
          return 'b';
        } else {
          log('Chessist: Detected white via white king position');
          return 'w';
        }
      }
    }

    // Method 1c: Check coordinate labels to detect orientation
    // If 'a' file is on the right side, board is flipped (black's view)
    if (board) {
      const boardRect = board.getBoundingClientRect();
      const boardCenterX = boardRect.left + boardRect.width / 2;
      const coords = document.querySelectorAll('.coords-files text, .coordinates-file, [class*="coordinate"]');
      for (const coord of coords) {
        const text = coord.textContent?.trim().toLowerCase();
        const rect = coord.getBoundingClientRect();
        if (text === 'a' && rect.left > boardCenterX) {
          // 'a' file is on the right = flipped board = black
          return 'b';
        }
        if (text === 'h' && rect.left < boardCenterX) {
          // 'h' file is on the left = flipped board = black
          return 'b';
        }
      }
    }

    // Method 1d: Check SVG coordinate elements inside board (including shadow DOM)
    if (board) {
      // Try regular DOM first
      let svgCoords = board.querySelectorAll('text, [class*="coord"]');

      // Also try shadow DOM
      if (board.shadowRoot) {
        const shadowCoords = board.shadowRoot.querySelectorAll('text, [class*="coord"], .coordinates text');
        svgCoords = [...svgCoords, ...shadowCoords];
      }

      for (const coord of svgCoords) {
        const text = coord.textContent?.trim().toLowerCase();
        if (text === '1') {
          const rect = coord.getBoundingClientRect();
          const boardRect = board.getBoundingClientRect();
          // If rank 1 is at the top of the board, it's flipped (black's view)
          if (rect.top < boardRect.top + boardRect.height / 2) {
            return 'b';
          }
        }
        // Also check file 'a' position
        if (text === 'a') {
          const rect = coord.getBoundingClientRect();
          const boardRect = board.getBoundingClientRect();
          // If file 'a' is on the right side, it's flipped (black's view)
          if (rect.left > boardRect.left + boardRect.width / 2) {
            return 'b';
          }
        }
      }
    }

    // Method 1e: Try to access board's internal orientation property
    if (board) {
      try {
        // Chess.com might expose orientation on the element
        if (board.orientation === 'black' || board.getAttribute('orientation') === 'black') {
          log('Chessist: Detected black via orientation property');
          return 'b';
        }
        // Or via a game property
        if (board.game?.getOrientation?.() === 'black' || board.game?.orientation === 'black') {
          log('Chessist: Detected black via game orientation');
          return 'b';
        }
        // Check for board.isFlipped property
        if (board.isFlipped === true) {
          log('Chessist: Detected black via isFlipped property');
          return 'b';
        }
      } catch (e) {
        // Ignore errors accessing properties
      }
    }

    // In puzzle mode, if board orientation checks didn't determine color,
    // use the current turn as player color (you solve for whoever's turn it is)
    if (isPuzzleMode()) {
      log('Chessist: Puzzle mode - using current turn as player color:', currentTurn);
      return currentTurn;
    }

    // Method 2: Check for bottom player indicators
    const bottomPlayer = document.querySelector('.player-component.bottom-player, .player-component.player-bottom, [class*="playerBottom"], [class*="player-bottom"]');
    if (bottomPlayer) {
      // Look for color indicators in the player component
      const pieceImg = bottomPlayer.querySelector('img[class*="piece"]');
      if (pieceImg?.src) {
        return pieceImg.src.includes('/w') ? 'w' : 'b';
      }
    }

    // Method 3: Check for user-tagline (logged in user's position)
    const userTaglines = document.querySelectorAll('.user-tagline-component, [class*="user-tagline"]');
    for (const tagline of userTaglines) {
      const parent = tagline.closest('.player-component, [class*="player"]');
      if (parent) {
        const isBottom = parent.classList.contains('player-bottom') ||
                         parent.classList.contains('bottom-player') ||
                         parent.matches('[class*="bottom"]');
        if (isBottom) {
          // Bottom player with user tagline = we're playing this color
          // If board not flipped, bottom is white
          return 'w';
        }
        const isTop = parent.classList.contains('player-top') ||
                      parent.classList.contains('top-player') ||
                      parent.matches('[class*="top"]');
        if (isTop) {
          // Top player with user tagline = we're playing this color (black)
          return 'b';
        }
      }
    }

    // Method 4: Check for "Your Turn" indicator
    const yourTurnEl = document.querySelector('[class*="your-turn"], [class*="yourTurn"], .clock-player-turn');
    if (yourTurnEl) {
      // If we can see "your turn" indicator, we're playing - use current turn
      return currentTurn;
    }

    // Method 5: Check URL for game context
    const path = window.location.pathname;
    if (path.includes('/play') || path.includes('/game/live') || path.includes('/game/daily')) {
      // We're in a game - if board isn't flipped, assume white
      // (Chess.com shows your pieces at the bottom by default)
      if (board && !board.classList.contains('flipped')) {
        return 'w';
      }
    }

    // Method 6: Analysis mode - treat as "always player's turn" for arrow
    if (path.includes('/analysis') || path.includes('/explorer')) {
      return currentTurn;
    }

    return null; // Unknown (probably spectating)
  }

  // Try to detect whose turn it is
  function detectTurn() {
    // Method 1: Try to get turn from Chess.com's game object directly
    try {
      const gameTag = document.querySelector('chess-board, wc-chess-board');
      if (gameTag?.game?.getTurn) {
        const turn = gameTag.game.getTurn();
        if (turn === 1 || turn === 'white' || turn === 'w') return 'w';
        if (turn === 2 || turn === 'black' || turn === 'b') return 'b';
      }
      if (gameTag?.game?.turn) {
        const turn = typeof gameTag.game.turn === 'function' ? gameTag.game.turn() : gameTag.game.turn;
        if (turn === 1 || turn === 'white' || turn === 'w') return 'w';
        if (turn === 2 || turn === 'black' || turn === 'b') return 'b';
      }
    } catch (e) {}

    // Method 2: Count moves in the vertical move list (vs computer and live games)
    // Each white-black pair is in a div, count all move spans/nodes
    const allMoves = document.querySelectorAll('.main-line-row .node-highlight-content, .move-text-component, .move-node .node-highlight-content');
    if (allMoves.length > 0) {
      return allMoves.length % 2 === 0 ? 'w' : 'b';
    }

    // Method 3: Count white and black move columns separately
    const whiteMoves = document.querySelectorAll('.main-line-row .white-move, .white.node, [class*="white-move"]');
    const blackMoves = document.querySelectorAll('.main-line-row .black-move, .black.node, [class*="black-move"]');
    if (whiteMoves.length > 0 || blackMoves.length > 0) {
      // If equal moves, it's white's turn. If white has one more, it's black's turn.
      return whiteMoves.length === blackMoves.length ? 'w' : 'b';
    }

    // Method 4: Look for active clock indicator
    const activeClocks = document.querySelectorAll('.clock-component.clock-player-turn, [class*="clock"][class*="turn"]');
    if (activeClocks.length > 0) {
      const activeClock = activeClocks[0];
      const playerComp = activeClock.closest('.player-component, [class*="player"]');
      if (playerComp) {
        const isBottom = playerComp.classList.contains('player-bottom') ||
                         playerComp.classList.contains('bottom-player');
        const board = document.querySelector('wc-chess-board');
        const boardFlipped = board?.classList.contains('flipped');
        const bottomIsWhite = !boardFlipped;
        return (isBottom === bottomIsWhite) ? 'w' : 'b';
      }
    }

    // Method 5: Check for data-ply attribute on selected/last move
    const lastMove = document.querySelector('[data-ply]:last-of-type, .node.selected, .move-node.selected');
    if (lastMove) {
      const ply = lastMove.getAttribute('data-ply');
      if (ply) {
        // ply 1 = after white's first move, so next is black. ply 2 = after black, next is white
        return parseInt(ply) % 2 === 1 ? 'b' : 'w';
      }
    }

    // Default to white's turn
    return 'w';
  }

  // Count consecutive identical results at the tail of history
  function countConsecutive(history, result) {
    let n = 0;
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i] === result) n++;
      else break;
    }
    return n;
  }

  // Effective threshold — optionally randomised between 1 and the base value
  function effectiveThreshold(base, isRandom) {
    if (!isRandom || base <= 1) return base;
    return 1 + Math.floor(Math.random() * base); // 1 … base
  }

  // Detect the current player's ELO from Chess.com DOM
  function detectPlayerElo() {
    if (manualElo) return manualElo;
    // Chess.com renders ratings near the board clocks; bottom player = current user
    const selectors = [
      '.board-player-default .user-tagline-rating',
      '.board-player-default [class*="rating"]',
      '[class*="board-player-default"] [class*="tagline-rating"]',
      '.player-component [class*="rating"]',
      '[class*="user-tagline"] [class*="rating"]',
    ];
    const isFlipped = !!document.querySelector('wc-chess-board.flipped, .board.flipped');
    for (const sel of selectors) {
      const els = [...document.querySelectorAll(sel)];
      if (!els.length) continue;
      // Bottom player is last element in normal orientation, first when flipped
      const el = isFlipped ? els[0] : els[els.length - 1];
      const m = el.textContent.trim().match(/\d{3,4}/);
      if (m) return parseInt(m[0]);
    }
    return null;
  }

  // Record game result and update throw/win flags for next game
  async function recordGameResult(result) {
    if (gameOverHandled) return;
    gameOverHandled = true;
    log(`Chessist: Game over - result: ${result}`);

    try {
      const local = await chrome.storage.local.get(['gameHistory']);
      const history = local.gameHistory || [];
      history.push(result);
      if (history.length > 30) history.shift();

      let throwNext = false;
      let winNext = false;
      if (wlBalance) {
        const consecWins = countConsecutive(history, 'w');
        const consecLosses = countConsecutive(history, 'l');
        const winThreshold = effectiveThreshold(maxConsecutiveWins, throwRandom);
        const lossThreshold = effectiveThreshold(maxConsecutiveLosses, lossRandom);
        throwNext = consecWins >= winThreshold;
        winNext = consecLosses >= lossThreshold;
        log(`Chessist: W${consecWins}/${winThreshold} L${consecLosses}/${lossThreshold} → throw:${throwNext} win:${winNext}`);
      }

      await chrome.storage.local.set({ gameHistory: history, shouldThrowNextGame: throwNext, shouldWinNextGame: winNext });
    } catch (e) {
      // Storage error - not critical
    }
  }

  // Watch for Chess.com game-over modal and record result
  function watchForGameOver() {
    let checkInterval = null;

    function checkResult() {
      if (gameOverHandled) {
        clearInterval(checkInterval);
        return;
      }
      // Chess.com uses various class names across versions - try a broad set
      const candidates = [
        document.querySelector('.result-message'),
        document.querySelector('.game-result-component'),
        document.querySelector('.game-over-message-component'),
        document.querySelector('[class*="game-over-message"]'),
        document.querySelector('[class*="result-message"]'),
        document.querySelector('[class*="game-result"]'),
      ];
      for (const el of candidates) {
        if (!el) continue;
        const text = el.textContent.toLowerCase();
        if (text.includes('you won') || text.includes('victory')) {
          recordGameResult('w');
          clearInterval(checkInterval);
          return;
        }
        if (text.includes('you lost') || text.includes('defeat') || text.includes('you lose')) {
          recordGameResult('l');
          clearInterval(checkInterval);
          return;
        }
        if (text.includes('draw') || text.includes('stalemate') || text.includes('repetition') || text.includes('agreement')) {
          recordGameResult('d');
          clearInterval(checkInterval);
          return;
        }
      }
    }

    // Poll every second — game-over modal appears after the final move
    checkInterval = setInterval(checkResult, 1000);

    // Watch DOM for the modal — throttled so rapid Chess.com DOM churn doesn't run checkResult constantly
    let _gorPending = false;
    const observer = new MutationObserver(() => {
      if (_gorPending) return;
      _gorPending = true;
      setTimeout(() => { _gorPending = false; checkResult(); }, 500);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // Win probability from centipawns (Lichess formula)
  function winPercent(cp) {
    return 100 / (1 + Math.exp(-0.00368208 * cp));
  }

  // Accuracy of a single move (Chess.com formula)
  // prevCp and newCp are both from the player's perspective
  function calculateMoveAccuracy(prevCp, newCp) {
    const winBefore = winPercent(prevCp);
    const winAfter = winPercent(newCp);
    const winLoss = Math.max(0, winBefore - winAfter);
    return Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * winLoss) - 3.1669));
  }

  // Classify a move by accuracy into Chess.com categories
  function classifyMove(accuracy, playedBestMove) {
    if (playedBestMove || accuracy >= 99) return 'best';
    if (accuracy >= 90) return 'excellent';
    if (accuracy >= 75) return 'good';
    if (accuracy >= 60) return 'inaccuracy';
    if (accuracy >= 40) return 'mistake';
    return 'blunder';
  }

  function accuracyColorClass(pct) {
    if (pct >= 90) return 'accuracy-great';
    if (pct >= 70) return 'accuracy-good';
    if (pct >= 50) return 'accuracy-ok';
    return 'accuracy-poor';
  }

  let accuracyIconSvg = null;
  async function getAccuracyIcon() {
    if (accuracyIconSvg) return accuracyIconSvg;
    try {
      const url = chrome.runtime.getURL('icons/accuracy.svg');
      const resp = await fetch(url);
      const text = await resp.text();
      // Strip width/height/style from svg tag so it sizes via CSS
      accuracyIconSvg = text.replace(/style="[^"]*"/, '').replace(/<svg /, '<svg ');
    } catch (e) {
      accuracyIconSvg = '';
    }
    return accuracyIconSvg;
  }

  function updateAccuracyDisplay(accuracy, playedBestMove) {
    if (accuracyEl && moveAccuracies.length > 0) {
      const avg = moveAccuracies.reduce((a, b) => a + b, 0) / moveAccuracies.length;
      const avgPct = avg.toFixed(1);
      const colorClass = accuracyColorClass(avg);
      getAccuracyIcon().then(svgHtml => {
        if (!accuracyEl) return;
        const wrappedIcon = svgHtml
          ? `<span class="acc-icon ${colorClass}">${svgHtml}</span>`
          : '';
        accuracyEl.innerHTML = wrappedIcon + `<span class="acc-last ${colorClass}">${avgPct}%</span>`;
        accuracyEl.className = 'chess-live-eval-accuracy';
        accuracyEl.style.display = 'flex';
      });
    }
  }

  function getGameId() {
    return location.href.match(/\/(?:live|daily)\/(\d+)/)?.[1] || null;
  }

  function saveAccuracyState() {
    const gameId = getGameId();
    if (!gameId || moveAccuracies.length === 0) return;
    chrome.storage.local.set({ [`accuracy_${gameId}`]: { accuracies: moveAccuracies, prevCpWhite } }).catch(() => {});
  }

  async function restoreAccuracyState() {
    const gameId = getGameId();
    if (!gameId) return;
    const key = `accuracy_${gameId}`;
    const result = await chrome.storage.local.get(key).catch(() => ({}));
    if (result[key]) {
      moveAccuracies = result[key].accuracies || [];
      prevCpWhite = result[key].prevCpWhite ?? null;
      if (moveAccuracies.length > 0) updateAccuracyDisplay(moveAccuracies[moveAccuracies.length - 1]);
      log('Chessist: Restored accuracy state', moveAccuracies.length, 'moves');
    }
  }


  // Create evaluation bar element
  function _teardownDomElements() {
    if (evalBar) {
      if (evalBar === document.getElementById('evaluation')) {
        if (_nativeEvalOriginalClass !== null) {
          evalBar.className = _nativeEvalOriginalClass;
          _nativeEvalOriginalClass = null;
        }
        evalBar.innerHTML = '';
      } else {
        evalBar.remove();
      }
      evalBar = null; evalBarFill = null; evalScore = null;
      depthEl = null; bestMoveEl = null; countdownEl = null;
      turnIndicatorEl = null; accuracyEl = null;
    }
    if (evalBarContainer) { evalBarContainer.style.display = ''; evalBarContainer = null; }
    if (arrowOverlay) { arrowOverlay.remove(); arrowOverlay = null; }
    document.querySelectorAll('.chess-live-eval-arrow-overlay').forEach(el => el.remove());
  }

  let _nativeEvalOriginalClass = null;

  function createEvalBar(board) {
    // Check if already created
    if (evalBar) return;
    if (overlayMode) return;

    // Try to use Chess.com's native evaluation container first
    const nativeEvalContainer = document.getElementById('board-layout-evaluation');
    const nativeEvalInner = document.getElementById('evaluation');

    if (nativeEvalContainer && nativeEvalInner) {
      log('Chessist: Using native Chess.com eval container');

      evalBarContainer = nativeEvalContainer;
      nativeEvalContainer.style.display = 'block';

      // Clear any existing content and use as our eval bar
      _nativeEvalOriginalClass = nativeEvalInner.className;
      nativeEvalInner.innerHTML = '';
      nativeEvalInner.className = 'chess-live-eval-bar';

      evalBar = nativeEvalInner;

      // Create fill (white portion)
      evalBarFill = document.createElement('div');
      evalBarFill.className = 'chess-live-eval-bar-fill';
      evalBarFill.style.setProperty('height', '50%', 'important');

      // Create score display
      evalScore = document.createElement('div');
      evalScore.className = 'chess-live-eval-score equal';
      evalScore.textContent = '0.0';

      // Create best move display (hidden by default)
      bestMoveEl = document.createElement('div');
      bestMoveEl.className = 'chess-live-eval-best-move';
      bestMoveEl.style.display = 'none';

      // Create countdown display for auto-move (hidden by default)
      countdownEl = document.createElement('div');
      countdownEl.className = 'chess-live-eval-countdown';
      countdownEl.style.display = 'none';

      // Create depth indicator
      depthEl = document.createElement('div');
      depthEl.className = 'chess-live-eval-depth';
      depthEl.textContent = '';

      // Create turn indicator (debug)
      turnIndicatorEl = document.createElement('div');
      turnIndicatorEl.className = 'chess-live-eval-turn';
      turnIndicatorEl.textContent = '';

      // Create accuracy display
      accuracyEl = document.createElement('div');
      accuracyEl.className = 'chess-live-eval-accuracy';
      accuracyEl.style.display = 'none';

      evalBar.appendChild(evalBarFill);
      evalBar.appendChild(evalScore);
      evalBar.appendChild(depthEl);
      evalBar.appendChild(bestMoveEl);
      evalBar.appendChild(countdownEl);
      evalBar.appendChild(turnIndicatorEl);
      evalBar.appendChild(accuracyEl);

      if (overlayMode) {
        evalBar.style.display = 'none';
        nativeEvalContainer.style.display = 'none';
      }
      return;
    }

    // Fallback: Create our own eval bar
    log('Chessist: Creating custom eval bar');

    // Find the actual board element with dimensions
    let boardElement = board;
    const possibleBoards = [
      board.querySelector('.board'),
      board.shadowRoot?.querySelector('.board'),
      board
    ];

    for (const b of possibleBoards) {
      if (b) {
        const rect = b.getBoundingClientRect();
        if (rect.height > 100) {
          boardElement = b;
          break;
        }
      }
    }

    // Get board dimensions
    const boardRect = boardElement.getBoundingClientRect();
    const boardHeight = boardRect.height || 400;

    // Create eval bar
    evalBar = document.createElement('div');
    evalBar.className = 'chess-live-eval-bar loading';
    evalBar.style.height = `${boardHeight}px`;
    evalBar.style.position = 'absolute';
    evalBar.style.left = '-32px';
    evalBar.style.top = '0';

    // Create fill (white portion)
    evalBarFill = document.createElement('div');
    evalBarFill.className = 'chess-live-eval-bar-fill';
    evalBarFill.style.setProperty('height', '50%', 'important');

    // Create score display
    evalScore = document.createElement('div');
    evalScore.className = 'chess-live-eval-score equal';
    evalScore.textContent = '0.0';

    // Create best move display (hidden by default)
    bestMoveEl = document.createElement('div');
    bestMoveEl.className = 'chess-live-eval-best-move';
    bestMoveEl.style.display = 'none';

    // Create countdown display for auto-move (hidden by default)
    countdownEl = document.createElement('div');
    countdownEl.className = 'chess-live-eval-countdown';
    countdownEl.style.display = 'none';

    // Create depth indicator
    depthEl = document.createElement('div');
    depthEl.className = 'chess-live-eval-depth';
    depthEl.textContent = '';

    // Create turn indicator (debug)
    turnIndicatorEl = document.createElement('div');
    turnIndicatorEl.className = 'chess-live-eval-turn';
    turnIndicatorEl.textContent = '';

    // Create accuracy display
    accuracyEl = document.createElement('div');
    accuracyEl.className = 'chess-live-eval-accuracy';
    accuracyEl.style.display = 'none';

    evalBar.appendChild(evalBarFill);
    evalBar.appendChild(evalScore);
    evalBar.appendChild(depthEl);
    evalBar.appendChild(bestMoveEl);
    evalBar.appendChild(countdownEl);
    evalBar.appendChild(turnIndicatorEl);
    evalBar.appendChild(accuracyEl);

    // Insert eval bar
    let insertParent = board.parentElement;
    const parentStyle = window.getComputedStyle(insertParent);
    if (parentStyle.position === 'static') {
      insertParent.style.position = 'relative';
    }
    insertParent.insertBefore(evalBar, board);

    if (overlayMode) {
      evalBar.style.display = 'none';
    }

    // Observe board size changes
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const newHeight = entry.contentRect.height;
        if (newHeight > 100) {
          evalBar.style.height = `${newHeight}px`;
        }
      }
    });
    resizeObserver.observe(boardElement);
  }

  // ── Service worker keepalive (prevents SW sleep → native port drop) ─────────
  (function _keepSwAlive() {
    let _swPort = null;
    function connect() {
      try {
        _swPort = chrome.runtime.connect({ name: 'content-alive' });
        _swPort.onDisconnect.addListener(() => { void chrome.runtime.lastError; _swPort = null; setTimeout(connect, 1000); });
      } catch (e) {}
    }
    connect();
  })();

  // ── Overlay WebSocket (direct, low-latency) ─────────────────────────────────
  let _overlayWs = null;
  let _overlayReconnectTimer = null;
  let _boardObserver = null;
  let _observedBoard = null;
  let _lastEvaluation = null; // cached for immediate redraw on WS reconnect

  function _connectOverlayWs() {
    if (_overlayWs && _overlayWs.readyState <= WebSocket.OPEN) return;
    try {
      _overlayWs = new WebSocket('ws://127.0.0.1:27301');
      _overlayWs.onopen  = () => {
        clearTimeout(_overlayReconnectTimer); _overlayReconnectTimer = null;
        sendPositionUpdate();
        if (_lastEvaluation) updateEval(_lastEvaluation); // immediate redraw with cached data
        else if (currentFen) requestEval(currentFen);
      };
      _overlayWs.onclose = () => {
        _overlayWs = null;
        if (overlayMode) _overlayReconnectTimer = setTimeout(_connectOverlayWs, 3000);
      };
      _overlayWs.onerror = () => {}; // onclose fires next
    } catch (e) {}
  }

  function _disconnectOverlayWs() {
    clearTimeout(_overlayReconnectTimer);
    _overlayReconnectTimer = null;
    if (_overlayWs) { try { _overlayWs.close(); } catch (e) {} _overlayWs = null; }
  }

  function sendPositionUpdate() {
    if (!overlayMode || !_overlayWs || _overlayWs.readyState !== WebSocket.OPEN) return;
    const board = findBoard();
    if (!board) return;
    if (board !== _observedBoard) {
      if (_boardObserver) _boardObserver.disconnect();
      _boardObserver = new ResizeObserver(sendPositionUpdate);
      _boardObserver.observe(board);
      _observedBoard = board;
    }
    const rect = board.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    try {
      _overlayWs.send(JSON.stringify({
        positionOnly: true,
        visible: true,
        viewX: rect.left, viewY: rect.top,
        width: rect.width, height: rect.height,
        dpr,
      }));
    } catch (e) {}
  }

  // Re-register zoom watcher so it fires once per zoom change and re-arms itself
  function _watchZoom() {
    const mq = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    mq.addEventListener('change', () => { sendPositionUpdate(); _watchZoom(); }, { once: true });
  }

  // Track browser window position (no native event — poll screenX/Y)
  let _lastScreenX = window.screenX;
  let _lastScreenY = window.screenY;
  setInterval(() => {
    if (window.screenX !== _lastScreenX || window.screenY !== _lastScreenY) {
      _lastScreenX = window.screenX;
      _lastScreenY = window.screenY;
      sendPositionUpdate();
    }
  }, 250);

  // Fallback: re-show overlay every 1s when focused, in case the focus event was missed
  setInterval(() => {
    if (!overlayMode || !isEnabled || !_overlayWs || _overlayWs.readyState !== WebSocket.OPEN) return;
    if (document.hasFocus()) sendPositionUpdate();
  }, 1000);
  window.addEventListener('resize', sendPositionUpdate);
  window.addEventListener('scroll', sendPositionUpdate, { passive: true });
  document.addEventListener('fullscreenchange', sendPositionUpdate);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', sendPositionUpdate);
    window.visualViewport.addEventListener('scroll', sendPositionUpdate);
  }
  _watchZoom();

  // Tab hide/show (tab switch, minimize) — popup opening does NOT trigger visibilitychange.
  // Alt-tab is handled by the C# foreground check so no blur→visible:false needed.
  document.addEventListener('visibilitychange', () => {
    if (!overlayMode) return;
    if (document.hidden) {
      if (_overlayWs?.readyState === WebSocket.OPEN)
        try { _overlayWs.send(JSON.stringify({ positionOnly: true, visible: false })); } catch (e) {}
    } else {
      if (_overlayWs && _overlayWs.readyState === WebSocket.OPEN) sendPositionUpdate();
      else _connectOverlayWs();
    }
  });
  // Reconnect WS if closed while away (popup, alt-tab, etc.)
  window.addEventListener('focus', () => {
    if (!overlayMode) return;
    if (!(_overlayWs && _overlayWs.readyState <= WebSocket.OPEN)) _connectOverlayWs();
  });

  function sendOverlayUpdate(fillPercent, displayScore, isFlipped, evaluation) {
    if (!overlayMode) return;
    if (!_overlayWs || _overlayWs.readyState !== WebSocket.OPEN) {
      _connectOverlayWs();
      return;
    }
    const board = findBoard();
    if (!board) return;
    const rect = board.getBoundingClientRect();

    // Mirror the same show/hide rules as the HTML overlay.
    // Arrow[0] = purple (best move). Arrow[1,2] = yellow/red (alternatives).
    // Alternatives are only sent when the best move is also shown, so C# index→color stays correct.
    const isPlayerTurn = !playerColor || currentTurn === playerColor;
    const showBest = isPlayerTurn ? showBestMove : showOpponentBestMove;
    const atDepth  = evaluation.depth >= targetDepth;
    const arrows   = [];
    if (showBest && atDepth) {
      const alts = (evaluation.multiPvMoves || []).filter(m => m && m.length >= 4);
      if (alts.length > 0)
        arrows.push({ from: alts[0].substring(0, 2), to: alts[0].substring(2, 4) });
      if (showAltArrows) {
        for (let i = 1; i < Math.min(3, alts.length); i++)
          arrows.push({ from: alts[i].substring(0, 2), to: alts[i].substring(2, 4) });
      }
    }

    const dpr = window.devicePixelRatio || 1;
    try {
      _overlayWs.send(JSON.stringify({
        visible: true,
        flipped: isFlipped,
        viewX: rect.left, viewY: rect.top,
        width: rect.width, height: rect.height,
        dpr,
        evalBar: { fillPercent, isFlipped, score: displayScore },
        arrows,
        manualMap,
        offsetX: manualOffsetX,
        offsetY: manualOffsetY,
      }));
    } catch (e) {}
  }

  // Update evaluation display
  function updateEval(evaluation) {
    if (!evalBar && !overlayMode) return;
    _lastEvaluation = evaluation;

    // Only remove loading state when we reach target depth
    if (evalBar && evaluation.depth >= targetDepth) {
      evalBar.classList.remove('loading');
    }

    // In puzzle mode, always re-detect player color (it changes as you solve)
    // In regular games, only detect if not set
    if (isPuzzleMode() || !playerColor) {
      playerColor = detectPlayerColor();
    }

    let displayScore;
    let fillPercent;
    let scoreClass;

    // IMPORTANT: Stockfish evaluates from the CURRENT TURN's perspective
    // The score is positive when the side to move is winning
    // We need to flip it to show from WHITE's perspective first

    let rawMate = evaluation.mate;
    let rawCp = evaluation.cp || 0;

    // Use the turn from the evaluation (which FEN was being analyzed)
    // This avoids race conditions where currentFen has already changed
    const evalTurn = evaluation.turn || 'w';

    // If it was black's turn when this position was evaluated,
    // Stockfish gave score from black's perspective - flip to white's perspective
    const isBlackToMove = evalTurn === 'b';
    if (isBlackToMove) {
      if (rawMate !== undefined) {
        rawMate = -rawMate;
      }
      rawCp = -rawCp;
    }


    // Now rawCp and rawMate are from WHITE's perspective
    // Positive = white winning, Negative = black winning

    // Store eval for accuracy calculation: update on every player eval so a force-move
    // mid-calculation still has a valid prevCpWhite to compare against.
    const isPlayerTurnForEval = playerColor && evalTurn === playerColor;
    if (isPlayerTurnForEval) {
      prevCpWhite = rawMate !== undefined
        ? (rawMate > 0 ? 10000 : -10000)
        : rawCp;
      if (evaluation.depth >= targetDepth) prevBestMove = evaluation.bestMove || null;
    }

    // Flip everything if player is black (bar and score)
    const viewFromBlack = playerColor === 'b';
    let displayMate = rawMate;
    let displayCp = rawCp;
    
    if (viewFromBlack) {
      // Flip the evaluation for display from black's perspective
      if (displayMate !== undefined) {
        displayMate = -displayMate;
      }
      displayCp = -displayCp;
    }

    if (displayMate !== undefined) {
      // Mate score
      const mateIn = displayMate;
      displayScore = mateIn > 0 ? `M${mateIn}` : `M${Math.abs(mateIn)}`;
      
      // For the bar fill:
      // If player is white: positive rawMate = white winning = 100% fill (white at top)
      // If player is black: positive displayMate = black winning = 100% fill (player's color at top)
      if (viewFromBlack) {
        fillPercent = displayMate > 0 ? 100 : 0;
        scoreClass = displayMate > 0 ? 'black-winning mate' : 'white-winning mate';
      } else {
        fillPercent = rawMate > 0 ? 100 : 0;
        scoreClass = rawMate > 0 ? 'white-winning mate' : 'black-winning mate';
      }
    } else {
      // Centipawn score (convert to pawns)
      const pawns = displayCp / 100;

      // Format score - positive means player is winning
      if (pawns > 0) {
        displayScore = `+${pawns.toFixed(1)}`;
        scoreClass = viewFromBlack ? 'black-winning' : 'white-winning';
      } else if (pawns < 0) {
        displayScore = pawns.toFixed(1);
        scoreClass = viewFromBlack ? 'white-winning' : 'black-winning';
      } else {
        displayScore = '0.0';
        scoreClass = 'equal';
      }

      // Calculate fill percentage
      // For white player: use rawCp (positive = more white fill at top)
      // For black player: use displayCp (positive = more black fill at top)
      const evalForFill = viewFromBlack ? displayCp : rawCp;
      const clampedPawns = Math.max(-10, Math.min(10, evalForFill / 100));
      fillPercent = 50 + (clampedPawns / 10) * 50;
    }

    sendOverlayUpdate(fillPercent, displayScore, viewFromBlack, evaluation);

    if (!overlayMode) {
      // Update bar fill (use setProperty for higher priority over CSS)
      evalBarFill.style.setProperty('height', `${fillPercent}%`, 'important');

      // Flip bar colors when playing as black (so player's color is at bottom)
      if (evalBar) {
        evalBar.classList.toggle('flipped', viewFromBlack);
      }

      // Update score display
      evalScore.textContent = displayScore;
      evalScore.className = `chess-live-eval-score ${scoreClass}`;

      // Update best move if enabled
      if (evaluation.bestMove) {
        // Format UCI move (e.g., "e2e4" -> "e2→e4", "e7e8q" -> "e7→e8=Q")
        const move = evaluation.bestMove;
        let formattedMove = move;
        if (move.length >= 4) {
          const from = move.substring(0, 2);
          const to = move.substring(2, 4);
          const promotion = move.length > 4 ? '=' + move[4].toUpperCase() : '';
          formattedMove = `${from}→${to}${promotion}`;
        }

        // Log best move to console only at target depth
        if (evaluation.depth >= targetDepth) {
          log(`Best move: ${formattedMove} (depth ${evaluation.depth}, eval: ${displayScore})`);
        }

        if (showBestMove && bestMoveEl) {
          bestMoveEl.textContent = formattedMove;
          bestMoveEl.style.display = 'block';

          const isPlayerTurn = !playerColor || currentTurn === playerColor;
          const shouldDrawArrow = isPlayerTurn || showOpponentBestMove;
          if (evaluation.depth >= targetDepth && shouldDrawArrow) {
            drawBestMoveArrow(move, evaluation.multiPvMoves);
          } else if (!shouldDrawArrow) {
            clearArrow();
          }
        }
      }
      if (!showBestMove) {
        if (bestMoveEl) {
          bestMoveEl.style.display = 'none';
        }
        clearArrow();
      }

      // Update depth indicator (always show current depth)
      if (depthEl && evaluation.depth) {
        depthEl.textContent = `D${evaluation.depth}`;
      }
    }

    // Auto-move feature: execute the best move automatically
    if (autoMove && evaluation.bestMove && evaluation.depth >= targetDepth) {
      const isPlayerTurn = playerColor && currentTurn === playerColor;

      // CRITICAL: Verify the evaluation is for the CURRENT position AND turn
      // This prevents stale evaluations from triggering moves on the wrong position/turn
      let evalMatchesCurrent = true;
      if (evaluation.fen && currentFen) {
        const evalPosition = evaluation.fen.split(' ').slice(0, 2).join(' ');
        const currentPosition = currentFen.split(' ').slice(0, 2).join(' ');
        evalMatchesCurrent = evalPosition === currentPosition;
      }

      const positionKey = currentFen ? currentFen.split(' ').slice(0, 2).join(' ') : null;

      // Only auto-move on player's turn, if eval matches current position,
      // and if we haven't already triggered a move for this position+turn
      if (isPlayerTurn && evalMatchesCurrent && positionKey && positionKey !== lastAutoMovePosition) {
        lastAutoMovePosition = positionKey;  // Mark this position+turn as processed

        // Move selection: win mode > throw mode > targetAccuracy > skillLevel
        let moveToPlay = evaluation.bestMove;
        const pv = evaluation.pv || [];

        if (shouldWinThisGame) {
          // Win mode: always play the best move, no degradation
          // moveToPlay is already bestMove — nothing to do
          log('Chessist: Win mode - playing best move');
        } else if (shouldThrowThisGame && pv.length >= 3) {
          // Throw mode: pick one of our own moves from deep in the PV.
          // Our moves are at even PV indices (0, 2, 4, ...); skip index 0 (best).
          const ourPvMoves = pv.filter((_, i) => i % 2 === 0);
          if (ourPvMoves.length >= 2) {
            const throwIdx = Math.min(ourPvMoves.length - 1,
              1 + Math.floor(Math.random() * Math.max(1, ourPvMoves.length - 1)));
            moveToPlay = ourPvMoves[throwIdx];
            log('Chessist: Throw mode - playing PV even-index', throwIdx * 2, ':', moveToPlay);
          }
        } else if (targetAccuracy < 100 && pv.length > 1) {
          // Accuracy-based deviation: (100 - accuracy)% chance to pick a worse move
          const deviationChance = (100 - targetAccuracy) / 100;
          if (Math.random() < deviationChance) {
            const maxIdx = Math.min(pv.length - 1, Math.ceil((100 - targetAccuracy) / 15));
            // Only pick our moves (even indices), skip index 0
            const ourMoves = pv.filter((_, i) => i % 2 === 0);
            const pick = Math.min(ourMoves.length - 1, 1 + Math.floor(Math.random() * maxIdx));
            if (pick > 0 && ourMoves[pick]) {
              moveToPlay = ourMoves[pick];
              log('Chessist: Target accuracy', targetAccuracy, '% - deviating to PV move', pick);
            }
          }
        } else if (skillLevel < 20 && pv.length > 1) {
          // Skill-based move selection (existing behaviour, only when accuracy target is off)
          const blunderChance = (20 - skillLevel) / 25;
          if (Math.random() < blunderChance) {
            const pvMoves = pv;
            const maxIndex = Math.min(pvMoves.length - 1, Math.ceil((20 - skillLevel) / 4));
            const pickIndex = Math.floor(Math.random() * (maxIndex + 1));
            if (pickIndex > 0 && pvMoves[pickIndex]) {
              moveToPlay = pvMoves[pickIndex];
              log('Chessist: Skill level', skillLevel, '- picking move', pickIndex + 1, 'from PV:', moveToPlay);
            }
          }
        }

        // Calculate delay based on settings
        const minDelayMs = autoMoveDelayMin * 1000;
        const maxDelayMs = autoMoveDelayMax * 1000;
        const delayRange = maxDelayMs - minDelayMs;
        let finalDelay;

        if (smartTiming) {
          // Smart timing: adjust delay based on move complexity
          const complexity = calculateMoveComplexity(moveToPlay, evaluation, currentFen);
          // complexity 0.0 = delay near min, complexity 1.0 = delay near max
          const baseDelay = minDelayMs + (delayRange * complexity);
          // Add ±20% randomness to feel more human
          const randomFactor = 0.8 + (Math.random() * 0.4);
          finalDelay = Math.floor(baseDelay * randomFactor);
          log('Chessist: Move complexity:', complexity.toFixed(2), '-> delay:', finalDelay, 'ms');
        } else {
          // Simple random delay within range
          finalDelay = Math.floor(Math.random() * (delayRange + 1)) + minDelayMs;
          log('Chessist: Random delay:', finalDelay, 'ms');
        }

        // Execute move with or without delay based on instantMove setting
        if (instantMove) {
          log('Chessist: Instant auto-move for', moveToPlay);
          hideCountdown();
          executeMove(moveToPlay);
        } else {
          log('Chessist: Auto-move triggered for', moveToPlay, 'with delay', finalDelay, 'ms');

          // Show countdown timer
          const expectedPosition = positionKey;
          startCountdown(finalDelay, expectedPosition, moveToPlay);
        }
      } else if (!evalMatchesCurrent) {
        log('Chessist: Skipping auto-move - stale evaluation for different position');
      }
    }
  }

  // Calculate move complexity (0.0 = simple/obvious, 1.0 = complex/hard to find)
  function calculateMoveComplexity(move, evaluation, fen) {
    let complexity = 0.5; // Default: medium complexity

    // Factor 1: Is it a capture? Captures are often more obvious (especially recaptures)
    // Check if target square has a piece by parsing FEN
    if (fen && move.length >= 4) {
      const toSquare = move.substring(2, 4);
      const toFile = toSquare.charCodeAt(0) - 97; // a=0, h=7
      const toRank = parseInt(toSquare[1]) - 1;   // 1=0, 8=7

      // Parse FEN to check if target square has a piece
      const fenBoard = fen.split(' ')[0];
      const rows = fenBoard.split('/');
      if (rows.length === 8) {
        const row = rows[7 - toRank]; // FEN rows are from rank 8 to 1
        let fileIndex = 0;
        for (const char of row) {
          if (fileIndex === toFile) {
            // If it's a piece (not a number), it's a capture
            if (isNaN(parseInt(char))) {
              complexity -= 0.2; // Captures are more obvious
            }
            break;
          }
          if (isNaN(parseInt(char))) {
            fileIndex++;
          } else {
            fileIndex += parseInt(char);
          }
        }
      }
    }

    // Factor 2: Evaluation magnitude - very winning/losing positions have obvious moves
    const evalCp = Math.abs(evaluation.cp || 0);
    const evalMate = evaluation.mate;

    if (evalMate !== undefined) {
      // Mate in X - usually forced/obvious
      complexity -= 0.3;
    } else if (evalCp > 500) {
      // Winning by 5+ pawns - position is usually decided, moves are simpler
      complexity -= 0.2;
    } else if (evalCp > 200) {
      // Winning by 2+ pawns - still fairly clear
      complexity -= 0.1;
    } else if (evalCp < 50) {
      // Equal position - most complex, many viable options
      complexity += 0.2;
    }

    // Factor 3: Check if it's a promotion (often obvious in endgames)
    if (move.length > 4) {
      complexity -= 0.15;
    }

    // Factor 4: PV length - longer PV might indicate more forcing sequence
    if (evaluation.pv && evaluation.pv.length > 0) {
      // If first few moves of PV are forced (captures, checks), position is sharper
      const pvLength = evaluation.pv.length;
      if (pvLength >= 6) {
        // Deep forcing line found - position is tactical but move is clear
        complexity -= 0.1;
      }
    }

    // Clamp to 0.0 - 1.0 range
    return Math.max(0.0, Math.min(1.0, complexity));
  }

  // Start countdown timer for auto-move
  function startCountdown(delayMs, expectedPosition, moveToPlay) {
    // Clear any existing countdown
    hideCountdown();

    const startTime = Date.now();
    const endTime = startTime + delayMs;

    // Show countdown element
    if (countdownEl) {
      countdownEl.style.display = 'block';
    }

    // Update countdown every 100ms
    countdownInterval = setInterval(() => {
      const remaining = Math.max(0, endTime - Date.now());
      const seconds = (remaining / 1000).toFixed(1);

      if (countdownEl) {
        countdownEl.textContent = `${seconds}s`;
      }

      // Check if position changed (abort countdown)
      const board = findBoard();
      const currentFenNow = board ? extractFEN(board) : null;
      if (currentFenNow) {
        const nowPosition = currentFenNow.split(' ').slice(0, 2).join(' ');
        if (nowPosition !== expectedPosition) {
          log('Chessist: Position changed, cancelling countdown');
          hideCountdown();
          return;
        }
      }

      // Time's up - execute the move
      if (remaining <= 0) {
        hideCountdown();
        log('Chessist: Countdown complete, executing move:', moveToPlay);
        executeMove(moveToPlay);
      }
    }, 100);
  }

  // Hide countdown timer
  function hideCountdown() {
    if (countdownInterval) {
      clearInterval(countdownInterval);
      countdownInterval = null;
    }
    if (countdownEl) {
      countdownEl.style.display = 'none';
      countdownEl.textContent = '';
    }
  }

  // Show refresh message when extension context is invalidated
  function showRefreshMessage() {
    if (evalBar) {
      if (evalScore) {
        evalScore.textContent = 'Refresh';
        evalScore.title = 'Extension needs page refresh';
        evalScore.style.cursor = 'pointer';
        evalScore.onclick = () => window.location.reload();
      }
      if (bestMoveEl) {
        bestMoveEl.textContent = 'Click to reload page';
      }
      evalBar.classList.remove('loading');
    }
  }

  // Request evaluation from background script
  async function requestEval(fen, isMouseRelease = false) {
    if (!isEnabled || !fen) return;

    // Check if extension context is still valid
    if (!extensionContextValid || !checkExtensionContext()) {
      log('Chessist: Extension context invalid, showing refresh message');
      showRefreshMessage();
      return;
    }

    log('Chessist: Requesting eval for FEN:', fen, isMouseRelease ? '(mouse release)' : '');

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'EVALUATE',
        fen: fen,
        isMouseRelease: isMouseRelease
      });

      if (response && response.evaluation) {
        updateEval(response.evaluation);
      }
    } catch (e) {
      const errorMsg = e.message || e.toString();
      if (errorMsg.includes('Extension context invalidated') ||
          errorMsg.includes('message channel closed')) {
        extensionContextValid = false;
        showRefreshMessage();
      } else {
        console.error('Chessist: Error requesting evaluation', e);
      }
    }
  }

  // Listen for eval updates from background
  try {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (!extensionContextValid) return;

      try {
        if (message.type === 'EVAL_RESULT' && message.evaluation) {
          // Compare piece positions AND turn to detect stale evals
          // This prevents evaluations for "white to move" triggering on "black to move" with same pieces
          if (message.evaluation.fen && currentFen) {
            const evalPosition = message.evaluation.fen.split(' ').slice(0, 2).join(' ');
            const currentPosition = currentFen.split(' ').slice(0, 2).join(' ');
            if (evalPosition !== currentPosition) {
              // Stale evaluation for a different position or turn - skip silently
              return;
            }
          }

          // Calculate move accuracy from ongoing eval on opponent's turn
          if (accuracyEvalPending) {
            const ev = message.evaluation;
            if (ev.depth >= ACCURACY_EVAL_DEPTH) {
              // Normalize to white's perspective
              const et = ev.turn || 'w';
              let newCpWhite;
              if (ev.mate !== undefined) {
                const mateSigned = et === 'b' ? -ev.mate : ev.mate;
                newCpWhite = mateSigned > 0 ? 10000 : -10000;
              } else {
                newCpWhite = et === 'b' ? -(ev.cp || 0) : (ev.cp || 0);
              }

              if (prevCpWhite !== null) {
                const playerBefore = playerColor === 'b' ? -prevCpWhite : prevCpWhite;
                const playerAfter  = playerColor === 'b' ? -newCpWhite  : newCpWhite;
                const accuracy = calculateMoveAccuracy(playerBefore, playerAfter);
                moveAccuracies.push(accuracy);
                updateAccuracyDisplay(accuracy, accuracy >= 99);
                saveAccuracyState();
                // Draw move icon on the board at the destination square
                if (lastMoveToSquare) {
                  const cls = classifyMove(accuracy, accuracy >= 99);
                  drawMoveIconOnBoard(lastMoveToSquare, cls);
                }
                log(`Chessist: Move accuracy ${accuracy.toFixed(1)}% (before cp ${prevCpWhite}, after cp ${newCpWhite})`);
              }

              accuracyEvalPending = false;
              // Don't stop analysis — let the eval session continue normally
            }
            // Fall through to updateEval so the bar stays current
          }

          updateEval(message.evaluation);
        }
      } catch (e) {
        if (e.message?.includes('Extension context invalidated')) {
          extensionContextValid = false;
          showRefreshMessage();
        }
      }
    });
  } catch (e) {
    log('Chessist: Could not add message listener - context invalid');
  }

  // Start observing board for changes
  function observeBoard(board) {
    if (boardObserver) {
      boardObserver.disconnect();
    }

    // Initial FEN extraction and eval
    const rawFen = extractFEN(board);
    if (rawFen && rawFen !== currentFen) {
      const previousFen = currentFen;

      // Normalize starting position FEN: detectTurn() may read the previous game's
      // stale move list from the DOM, producing the wrong turn ('b') for a new game.
      const isStartPos = rawFen.startsWith('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR');
      const fen = isStartPos
        ? 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
        : rawFen;

      // Skip if normalized FEN still matches currentFen (prevents redundant eval)
      if (fen === currentFen) return;

      currentFen = fen;
      lastAutoMovePosition = null;  // New position — allow auto-move to trigger fresh

      // Always detect player color from board orientation (reliable, doesn't depend on shadow DOM)
      const isFlipped = board.classList?.contains('flipped') ||
                        board.getAttribute('data-flipped') === 'true' ||
                        board.hasAttribute('flipped') || board.flipped === true;
      playerColor = isFlipped ? 'b' : 'w';

      // Update current turn from FEN
      const fenParts = fen.split(' ');
      if (fenParts.length > 1) {
        currentTurn = fenParts[1];
      }

      // If there was a previous game (previousFen is non-null), treat this as a new game:
      // reset the engine and apply a short delay so the engine is ready before evaluating.
      const isNewGameLoad = previousFen !== null;
      if (isNewGameLoad) {
        lastAutoMovePosition = null;
        hideCountdown();
        prevCpWhite = null;
        moveAccuracies = [];
        accuracyEvalPending = false;
        if (accuracyEl) { accuracyEl.style.display = 'none'; accuracyEl.innerHTML = ''; }
        clearMoveIcon();
        if (extensionContextValid && checkExtensionContext()) {
          chrome.runtime.sendMessage({ type: 'RESET_ENGINE' }).catch(() => {});
        }
        evalBar?.classList.add('loading');
        setTimeout(() => requestEval(fen), 500);
      } else {
        evalBar?.classList.add('loading');
        requestEval(fen);
      }
    }

    // Method 1: MutationObserver for DOM changes
    boardObserver = new MutationObserver(() => {
      checkForPositionChange(false); // Not from mouse release
    });

    boardObserver.observe(board, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'transform']
    });

    // Fallback poll — safety net only; MutationObserver + events handle the common cases
    setInterval(() => checkForPositionChange(false), 2000);

    // Method 3: Listen for mouse release on board (PRIMARY - most accurate)
    board.addEventListener('mouseup', () => {
      log('Chessist: Mouse released on board');
      setTimeout(() => checkForPositionChange(true), 100); // Mark as mouse release
    });

    // Method 4: Listen for click/move events on board (fallback)
    board.addEventListener('click', () => {
      setTimeout(() => checkForPositionChange(false), 300);
    });

    // Method 5: Listen for keyboard moves
    document.addEventListener('keydown', (e) => {
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        setTimeout(() => checkForPositionChange(false), 200);
      }
    });

    // Method 6: Watch for move list changes
    const moveList = document.querySelector('.move-list-wrapper, .vertical-move-list');
    if (moveList) {
      const moveObserver = new MutationObserver(() => {
        setTimeout(() => checkForPositionChange(false), 100);
      });
      moveObserver.observe(moveList, { childList: true, subtree: true });
    }
  }

  // Check if position has changed and request eval
  function checkForPositionChange(isMouseRelease = false) {
    clearTimeout(window.evalDebounce);
    window.evalDebounce = setTimeout(() => {
      const board = findBoard();
      if (!board) {
        log('Chessist: No board found');
        return;
      }

      // Detect premoves - Chess.com marks premoved pieces/squares
      // Skip eval when a premove is visually shown (position isn't real yet)
      const hasPremove = board.querySelector('.premove, [class*="premove"]') ||
                         board.shadowRoot?.querySelector('.premove, [class*="premove"]');
      if (hasPremove) {
        log('Chessist: Premove detected, skipping eval');
        return;
      }

      const newFen = extractFEN(board);

      if (newFen && newFen !== currentFen) {

        // Clear the best move arrow when position changes
        clearArrow();

        // Check if this is a completely new game (starting position)
        const isStartingPosition = newFen.startsWith('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR');
        const wasStartingPosition = currentFen && currentFen.startsWith('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR');

        // Detect new game via FEN (starting position appeared) or URL change (Chess.com SPA)
        let isNewGame = isStartingPosition && !wasStartingPosition && currentFen !== null;

        const currentUrl = location.href;
        const currentGameId = currentUrl.match(/\/(?:live|daily)\/(\d+)/)?.[1];
        const lastGameId = lastGameUrl?.match(/\/(?:live|daily)\/(\d+)/)?.[1];
        if (currentGameId && lastGameId && currentGameId !== lastGameId) {
          isNewGame = true;
        }
        lastGameUrl = currentUrl;

        // Reset state on new game
        if (isNewGame) {
          log('Chessist: New game detected, resetting engine');
          lastAutoMovePosition = null;
          hideCountdown();
          currentBestMove = null;

          // Reset accuracy state
          const oldGameId = getGameId();
          if (oldGameId) chrome.storage.local.remove(`accuracy_${oldGameId}`).catch(() => {});
          prevCpWhite = null;
          moveAccuracies = [];
          accuracyEvalPending = false;
          if (accuracyEl) { accuracyEl.style.display = 'none'; accuracyEl.innerHTML = ''; }
          clearMoveIcon();

          // Set throw/win mode for this game based on flags from previous game
          gameOverHandled = false;
          chrome.storage.local.get(['shouldThrowNextGame', 'shouldWinNextGame']).then(local => {
            shouldThrowThisGame = wlBalance && local.shouldThrowNextGame === true;
            shouldWinThisGame   = wlBalance && local.shouldWinNextGame  === true;
            // Consume flags
            chrome.storage.local.set({ shouldThrowNextGame: false, shouldWinNextGame: false });
            if (shouldThrowThisGame) log('Chessist: THROW MODE active for this game');
            if (shouldWinThisGame)   log('Chessist: WIN MODE active for this game');

            // Apply ELO matching for this game
            if (matchElo) {
              const elo = detectPlayerElo();
              if (elo) {
                log('Chessist: Sending ELO', elo, 'to engine');
                chrome.storage.local.set({ detectedElo: elo });
                if (extensionContextValid && checkExtensionContext()) {
                  chrome.runtime.sendMessage({ type: 'SET_ELO', elo }).catch(() => {});
                }
              }
            }
          }).catch(() => {});

          // Reset eval bar visual state
          if (evalBarFill) evalBarFill.style.setProperty('height', '50%', 'important');
          if (evalScore) { evalScore.textContent = '0.0'; evalScore.className = 'chess-live-eval-score equal'; }
          if (depthEl) depthEl.textContent = '';
          if (bestMoveEl) { bestMoveEl.style.display = 'none'; bestMoveEl.textContent = ''; }

          if (extensionContextValid && checkExtensionContext()) {
            chrome.runtime.sendMessage({ type: 'RESET_ENGINE' }).catch((e) => {
              if (e.message?.includes('Extension context invalidated')) {
                extensionContextValid = false;
                showRefreshMessage();
              }
            });
          }

          // Early player color detection for first move:
          // Chess.com puts the player at the bottom. If board isn't flipped, player is white.
          const isFlipped = board.classList?.contains('flipped') ||
                            board.getAttribute('data-flipped') === 'true' ||
                            board.hasAttribute('flipped') || board.flipped === true;
          playerColor = isFlipped ? 'b' : 'w';
          log('Chessist: New game - detected player color from board orientation:', playerColor);
        }

        // For the starting position, detectTurn() can read the PREVIOUS game's stale
        // move list from the DOM (if the game API isn't ready yet), returning the wrong turn.
        // The starting position always has white to move — normalize it.
        const fenForEval = isStartingPosition
          ? 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
          : newFen;

        currentFen = fenForEval;

        // Update current turn from FEN
        const fenParts = fenForEval.split(' ');
        if (fenParts.length > 1) {
          currentTurn = fenParts[1];
        }

        // Re-detect player color (unless we just set it from new game detection above)
        if (!isNewGame) {
          playerColor = detectPlayerColor();
        }
        log('Chessist: Turn:', currentTurn, 'Player:', playerColor || 'spectating');

        // Update turn indicator for debugging
        if (turnIndicatorEl) {
          const turnText = currentTurn === 'w' ? 'W' : 'B';
          const playerText = playerColor ? (playerColor === 'w' ? 'W' : 'B') : '?';
          const isMyTurn = playerColor && currentTurn === playerColor;
          turnIndicatorEl.textContent = `${turnText}/${playerText}`;
          turnIndicatorEl.title = `Turn: ${currentTurn === 'w' ? 'White' : 'Black'} | You: ${playerColor ? (playerColor === 'w' ? 'White' : 'Black') : 'Spectating'}${isMyTurn ? ' (YOUR TURN)' : ''}`;
          turnIndicatorEl.className = `chess-live-eval-turn ${isMyTurn ? 'my-turn' : ''}`;
        }

        // Check if it's the player's turn (or spectating mode)
        const isMyTurn = !playerColor || currentTurn === playerColor;

        if (isMyTurn) {
          // Player's turn - cancel any pending accuracy eval, request regular eval
          accuracyEvalPending = false;
          clearMoveIcon();
          const evalDelay = isNewGame ? 500 : 0;
          evalBar?.classList.add('loading');
          setTimeout(() => requestEval(fenForEval, isMouseRelease), evalDelay);
        } else {
          // Opponent's turn — request eval for accuracy calculation and bar update
          hideCountdown();
          evalBar?.classList.add('loading');
          if (prevCpWhite !== null) {
            accuracyEvalPending = true;
            // Find the destination square: the highlighted square that currently has a piece on it
            lastMoveToSquare = null;
            const board = findBoard();
            if (board) {
              const root = board.shadowRoot || board;
              const highlights = root.querySelectorAll('[class*="highlight"][class*="square-"]');
              for (const hl of highlights) {
                const m = hl.className.match(/square-(\d+)/);
                if (!m) continue;
                const sq = parseInt(m[1]);
                const sqClass = `square-${sq}`;
                // The TO square has a piece on it; the FROM square is empty
                const hasPiece = root.querySelector(`.piece.${sqClass}`);
                if (hasPiece) {
                  const file = Math.floor(sq / 10) - 1;
                  const rank = (sq % 10) - 1;
                  lastMoveToSquare = String.fromCharCode(97 + file) + (rank + 1);
                  break;
                }
              }
            }
            log('Chessist: Opponent turn - accuracy pending, to square:', lastMoveToSquare);
          }
          // Request eval for opponent's position (used by accuracy calc and bar)
          requestEval(fenForEval, isMouseRelease);
        }
      }
    }, isMouseRelease ? 50 : 200); // Shorter debounce for mouse release
  }

  // Main initialization
  async function init() {
    await loadSettings();

    if (!isEnabled) return;

    await restoreAccuracyState();

    // Reset engine state on page load to clear any stale data
    if (extensionContextValid && checkExtensionContext()) {
      try {
        await chrome.runtime.sendMessage({ type: 'RESET_ENGINE' });
        log('Chessist: Engine reset on page load');
      } catch (e) {
        if (e.message?.includes('Extension context invalidated')) {
          extensionContextValid = false;
        }
        // Service worker might not be ready yet
      }
    }

    // Wait for board to appear
    const checkForBoard = () => {
      const board = findBoard();
      if (board) {
        createEvalBar(board);
        observeBoard(board);
      } else {
        // Retry after a short delay
        setTimeout(checkForBoard, 500);
      }
    };

    checkForBoard();
    watchForGameOver();

    // Try to detect and publish ELO immediately (player may already be in a game)
    if (matchElo) {
      setTimeout(() => {
        const elo = detectPlayerElo();
        if (elo && extensionContextValid && checkExtensionContext()) {
          chrome.storage.local.set({ detectedElo: elo });
          chrome.runtime.sendMessage({ type: 'SET_ELO', elo }).catch(() => {});
        }
      }, 2000); // wait for Chess.com DOM to settle
    }

    // Also observe for navigation (Chess.com is a SPA)
    const pageObserver = new MutationObserver(() => {
      const board = findBoard();
      if (board) {
        // Check if evalBar is orphaned (removed from DOM after SPA navigation)
        if (evalBar && !evalBar.isConnected) {
          log('Chessist: Eval bar orphaned, re-creating');
          evalBar = null;
          evalBarFill = null;
          evalScore = null;
          bestMoveEl = null;
          countdownEl = null;
          depthEl = null;
          turnIndicatorEl = null;
          arrowOverlay = null;
          currentBestMove = null;
        }

        if (!evalBar) {
          createEvalBar(board);
          observeBoard(board);
        }
      }

      // Auto rematch/new game: detect game-over buttons
      if (autoRematch || autoNewGame) {
        checkAutoRematch();
      }
    });

    pageObserver.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  // Simulate a realistic button click (Chess.com uses Vue which needs proper events)
  function simulateButtonClick(btn) {
    const rect = btn.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const eventOpts = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0 };

    btn.dispatchEvent(new PointerEvent('pointerdown', { ...eventOpts, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
    btn.dispatchEvent(new MouseEvent('mousedown', eventOpts));
    btn.dispatchEvent(new PointerEvent('pointerup', { ...eventOpts, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
    btn.dispatchEvent(new MouseEvent('mouseup', eventOpts));
    btn.dispatchEvent(new MouseEvent('click', eventOpts));
  }

  // Auto rematch / auto new game: click buttons when game ends
  let autoRematchPending = false;
  function checkAutoRematch() {
    if (autoRematchPending) return;

    // Look for game-over buttons (visible and clickable)
    const gameOverContainer = document.querySelector('.game-over-buttons-component');
    if (!gameOverContainer) return;

    const rematchBtn = gameOverContainer.querySelector('[data-cy="game-over-modal-rematch-button"]');
    const newGameBtn = gameOverContainer.querySelector('[data-cy="game-over-modal-new-game-button"]');

    // Determine which button to click based on settings
    let targetBtn = null;
    let btnName = '';
    if (autoRematch && rematchBtn) {
      targetBtn = rematchBtn;
      btnName = 'Rematch';
    } else if (autoNewGame && newGameBtn) {
      targetBtn = newGameBtn;
      btnName = 'New Game';
    }

    if (targetBtn) {
      autoRematchPending = true;

      // Random delay 1-3s to look human
      const delay = 1000 + Math.floor(Math.random() * 2000);
      log('Chessist: Game over detected, clicking', btnName, 'in', delay, 'ms');

      setTimeout(() => {
        // Re-check button still exists (modal might have closed)
        const container = document.querySelector('.game-over-buttons-component');
        if (!container) { autoRematchPending = false; return; }

        let btn = null;
        if (autoRematch) btn = container.querySelector('[data-cy="game-over-modal-rematch-button"]');
        if (!btn && autoNewGame) btn = container.querySelector('[data-cy="game-over-modal-new-game-button"]');
        if (btn) {
          simulateButtonClick(btn);
          log('Chessist: Clicked', btnName);

          // Schedule position checks after click to detect new game board
          setTimeout(() => checkForPositionChange(false), 1000);
          setTimeout(() => checkForPositionChange(false), 2000);
        }
        autoRematchPending = false;
      }, delay);
    }
  }

  // Listen for messages from popup/background
  try {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (!extensionContextValid) return;

      try {
        if (message.type === 'TOGGLE_ENABLED') {
          isEnabled = message.enabled;
          if (overlayMode) {
            if (!isEnabled) {
              if (_overlayWs && _overlayWs.readyState === WebSocket.OPEN)
                try { _overlayWs.send(JSON.stringify({ positionOnly: true, visible: false })); } catch (e) {}
            } else {
              sendPositionUpdate();
            }
          } else {
            if (evalBar) evalBar.style.display = isEnabled ? 'block' : 'none';
            if (evalBarContainer) evalBarContainer.style.display = isEnabled ? 'block' : 'none';
          }
        } else if (message.type === 'SETTINGS_UPDATED') {
          // Update showBestMove if provided
          if (message.showBestMove !== undefined) {
            showBestMove = message.showBestMove;
            if (bestMoveEl) {
              bestMoveEl.style.display = showBestMove ? 'block' : 'none';
            }
            if (!showBestMove) clearArrow();
          }
          if (message.showOpponentBestMove !== undefined) {
            showOpponentBestMove = message.showOpponentBestMove;
            if (!showOpponentBestMove) clearArrow();
          }
          if (message.showAltArrows !== undefined) {
            showAltArrows = message.showAltArrows;
            clearArrow();
          }
          if (message.showMoveIcon !== undefined) {
            showMoveIcon = message.showMoveIcon;
            if (!showMoveIcon) clearMoveIcon();
          }
          // Update autoMove if provided
          if (message.autoMove !== undefined) {
            autoMove = message.autoMove;
            // Reset last auto-move position when toggled to allow fresh auto-move
            if (autoMove) {
              lastAutoMovePosition = null;
            }
            log('Chessist: Auto-move', autoMove ? 'enabled' : 'disabled');
          }
          // Update playerColor if provided
          if (message.playerColor !== undefined) {
            manualPlayerColor = message.playerColor;
            playerColor = detectPlayerColor();  // Re-detect with new manual setting
            log('Chessist: Player color set to', manualPlayerColor, '-> detected as', playerColor);
            // Update turn indicator
            if (turnIndicatorEl) {
              const isMyTurn = playerColor && currentTurn === playerColor;
              turnIndicatorEl.textContent = `${currentTurn === 'w' ? 'W' : 'B'}/${playerColor || '?'}`;
              turnIndicatorEl.classList.toggle('my-turn', isMyTurn);
            }
          }
          // Update targetDepth if provided
          if (message.engineDepth !== undefined) {
            targetDepth = message.engineDepth;
            log('Chessist: Target depth updated to', targetDepth);
            // Trigger re-evaluation with new depth if we have a position
            if (currentFen && isEnabled) {
              evalBar?.classList.add('loading');
              requestEval(currentFen);
            }
          }
          // Update stealthMode if provided
          if (message.stealthMode !== undefined) {
            stealthMode = message.stealthMode;
          }
          // Update instantMove if provided
          if (message.instantMove !== undefined) {
            instantMove = message.instantMove;
            log('Chessist: Instant move', instantMove ? 'enabled' : 'disabled');
          }
          if (message.smartTiming !== undefined) {
            smartTiming = message.smartTiming;
            log('Chessist: Smart timing', smartTiming ? 'enabled' : 'disabled');
          }
          if (message.autoRematch !== undefined) {
            autoRematch = message.autoRematch;
            log('Chessist: Auto rematch', autoRematch ? 'enabled' : 'disabled');
          }
          if (message.autoNewGame !== undefined) {
            autoNewGame = message.autoNewGame;
            log('Chessist: Auto new game', autoNewGame ? 'enabled' : 'disabled');
          }
          // Update auto-move delay settings if provided
          if (message.autoMoveDelayMin !== undefined) {
            autoMoveDelayMin = message.autoMoveDelayMin;
          }
          if (message.autoMoveDelayMax !== undefined) {
            autoMoveDelayMax = message.autoMoveDelayMax;
          }
          // Update skill level if provided
          if (message.skillLevel !== undefined) {
            skillLevel = message.skillLevel;
            log('Chessist: Skill level updated to', skillLevel);
          }
          if (message.targetAccuracy !== undefined) {
            targetAccuracy = message.targetAccuracy;
            log('Chessist: Target accuracy set to', targetAccuracy);
          }
          if (message.wlBalance !== undefined) {
            wlBalance = message.wlBalance;
            if (!wlBalance) { shouldThrowThisGame = false; shouldWinThisGame = false; }
          }
          if (message.maxConsecutiveWins !== undefined) maxConsecutiveWins = message.maxConsecutiveWins;
          if (message.maxConsecutiveLosses !== undefined) maxConsecutiveLosses = message.maxConsecutiveLosses;
          if (message.throwRandom !== undefined) throwRandom = message.throwRandom;
          if (message.lossRandom !== undefined) lossRandom = message.lossRandom;
          if (message.matchElo !== undefined) {
            matchElo = message.matchElo;
            if (!matchElo) {
              // Disable ELO limiting on engine
              if (extensionContextValid && checkExtensionContext()) {
                chrome.runtime.sendMessage({ type: 'SET_ELO', elo: null }).catch(() => {});
              }
            }
          }
          if (message.manualElo !== undefined) manualElo = message.manualElo;
          if (message.manualMap !== undefined) manualMap = message.manualMap;
          if (message.manualOffsetX !== undefined) manualOffsetX = message.manualOffsetX;
          if (message.manualOffsetY !== undefined) manualOffsetY = message.manualOffsetY;
          if (message.overlayMode !== undefined) {
            overlayMode = message.overlayMode;
            if (overlayMode) {
              _teardownDomElements();
              _connectOverlayWs();
            } else {
              _disconnectOverlayWs();
              const board = findBoard();
              if (board) {
                createEvalBar(board);
                createArrowOverlay(board);
              }
            }
          }
        } else if (message.type === 'RE_EVALUATE') {
          // Engine switched - trigger re-evaluation of current position
          if (currentFen && isEnabled) {
            log('Chessist: Re-evaluating after engine switch');
            evalBar?.classList.add('loading');
            requestEval(currentFen);
          }
        } else if (message.type === 'GET_OVERLAY_WS_STATUS') {
          sendResponse({ connected: !!(_overlayWs && _overlayWs.readyState === WebSocket.OPEN) });
          return true;
        }
      } catch (e) {
        if (e.message?.includes('Extension context invalidated')) {
          extensionContextValid = false;
          showRefreshMessage();
        }
      }
    });
  } catch (e) {
    log('Chessist: Could not add settings listener - context invalid');
  }

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
