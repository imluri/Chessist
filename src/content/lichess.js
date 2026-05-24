// Chessist - Lichess Content Script
// Adapted for lichess.org (chessground board)

(function() {
  'use strict';

  let evalBar = null;
  let evalBarFill = null;
  let evalScore = null;
  let bestMoveEl = null;
  let countdownEl = null;
  let countdownInterval = null;
  let depthEl = null;
  let turnIndicatorEl = null;
  let currentFen = null;
  let currentTurn = 'w';
  let playerColor = null;
  let isEnabled = true;
  let showBestMove = false;
  let showOpponentBestMove = false;
  let showAltArrows = true;
  let showMoveIcon = false;
  let autoMove = false;
  let lastAutoMovePosition = null;
  let manualPlayerColor = 'auto';
  let boardObserver = null;
  let arrowOverlay = null;
  let currentBestMove = null;

  // W/L balance & throw mode
  let wlBalance = false;
  let maxConsecutiveWins = 2;
  let maxConsecutiveLosses = 3;
  let throwRandom = false;
  let lossRandom = false;
  let targetAccuracy = 100;
  let shouldThrowThisGame = false;
  let shouldWinThisGame = false;
  let gameOverHandled = false;

  // ELO matching
  let matchElo = false;
  let manualElo = null;

  // Accuracy tracking
  let accuracyEl = null;
  let prevCpWhite = null;
  let prevBestMove = null;
  let lastMoveToSquare = null;
  let moveAccuracies = [];
  let accuracyEvalPending = false;
  const ACCURACY_EVAL_DEPTH = 10;

  let overlayMode = false;
  let manualMap = false;
  let manualOffsetX = 0;
  let manualOffsetY = 0;
  let targetDepth = 18;
  let stealthMode = true;
  let instantMove = false;
  let smartTiming = true;
  let autoRematch = false;
  let autoNewGame = false;
  let autoMoveDelayMin = 0.1;
  let autoMoveDelayMax = 0.3;
  let skillLevel = 20;
  let lastGameUrl = null;

  function log(...args) {
    if (!stealthMode) console.log(...args);
  }

  let extensionContextValid = true;
  function checkExtensionContext() {
    try { return chrome.runtime?.id != null; } catch (e) { return false; }
  }

  async function loadSettings() {
    try {
      const result = await chrome.storage.sync.get([
        'enabled', 'showBestMove', 'showOpponentBestMove', 'showAltArrows', 'showMoveIcon', 'autoMove', 'instantMove', 'smartTiming', 'autoRematch', 'autoNewGame',
        'stealthMode', 'engineDepth', 'playerColor', 'autoMoveDelayMin', 'autoMoveDelayMax', 'skillLevel',
        'targetAccuracy', 'wlBalance', 'maxConsecutiveWins', 'maxConsecutiveLosses', 'throwRandom',
        'lossRandom', 'matchElo', 'manualElo', 'overlayMode'
      ]);
      isEnabled = result.enabled !== false;
      showBestMove = result.showBestMove === true;
      showOpponentBestMove = result.showOpponentBestMove === true;
      showAltArrows = result.showAltArrows !== false; // default true
      showMoveIcon = result.showMoveIcon === true;
      autoMove = result.autoMove === true;
      instantMove = result.instantMove === true;
      smartTiming = result.smartTiming !== false;
      autoRematch = result.autoRematch === true;
      autoNewGame = result.autoNewGame === true;
      stealthMode = result.stealthMode !== false;
      targetDepth = result.engineDepth || 18;
      manualPlayerColor = result.playerColor || 'auto';
      autoMoveDelayMin = result.autoMoveDelayMin ?? 0.1;
      autoMoveDelayMax = result.autoMoveDelayMax ?? 0.3;
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
      _connectEngineWs(); // always connect for engine eval
      if (overlayMode) {
        if (evalBar) evalBar.style.display = 'none';
        clearArrow();
        clearMoveIcon();
      }

      const local = await chrome.storage.local.get(['shouldThrowNextGame', 'shouldWinNextGame']);
      shouldThrowThisGame = false;
      if (local.shouldThrowNextGame) log('Chessist: Throw flag pending from previous game');
      if (local.shouldWinNextGame) log('Chessist: Win flag pending from previous game');
    } catch (e) {}
  }

  // --- Common utilities (unchanged from chess.com version) ---

  const pieceMap = {
    'wp': 'P', 'wn': 'N', 'wb': 'B', 'wr': 'R', 'wq': 'Q', 'wk': 'K',
    'bp': 'p', 'bn': 'n', 'bb': 'b', 'br': 'r', 'bq': 'q', 'bk': 'k'
  };

  function squareToIndices(square) {
    const file = square.charCodeAt(0) - 97; // a=0
    const rank = parseInt(square[1]) - 1;   // 1=0
    return { file, rank };
  }

  function getSquareCenter(square, isFlipped) {
    const { file, rank } = squareToIndices(square);
    const squareSize = 12.5;
    let x, y;
    if (isFlipped) {
      x = (7 - file + 0.5) * squareSize;
      y = (rank + 0.5) * squareSize;
    } else {
      x = (file + 0.5) * squareSize;
      y = (7 - rank + 0.5) * squareSize;
    }
    return { x, y };
  }

  function _teardownDomElements() {
    if (evalBar) { evalBar.remove(); evalBar = null; evalBarFill = null; evalScore = null;
      depthEl = null; bestMoveEl = null; countdownEl = null; turnIndicatorEl = null; accuracyEl = null; }
    if (arrowOverlay) { arrowOverlay.remove(); arrowOverlay = null; }
    document.querySelectorAll('.chess-live-eval-arrow-overlay').forEach(el => el.remove());
  }

  function createArrowOverlay(board) {
    if (overlayMode) return null;
    if (arrowOverlay && arrowOverlay.parentElement === board) return arrowOverlay;
    if (arrowOverlay) { arrowOverlay.remove(); arrowOverlay = null; }
    document.querySelectorAll('.chess-live-eval-arrow-overlay').forEach(el => el.remove());

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('class', 'chess-live-eval-arrow-overlay');
    svg.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:100;';

    const boardComputedStyle = window.getComputedStyle(board);
    if (boardComputedStyle.position === 'static') board.style.position = 'relative';

    // For lichess, append to cg-board (inside cg-wrap) so it sits on the board surface
    const cgBoard = board.querySelector('cg-board') || board;
    cgBoard.appendChild(svg);
    arrowOverlay = svg;
    return svg;
  }

  function drawArrow(group, fromSquare, toSquare, isFlipped, color, opacity, strokeWidth) {
    const from = getSquareCenter(fromSquare, isFlipped);
    const to   = getSquareCenter(toSquare, isFlipped);
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
    line.setAttribute('x1', from.x.toFixed(2)); line.setAttribute('y1', from.y.toFixed(2));
    line.setAttribute('x2', lineEndX.toFixed(2)); line.setAttribute('y2', lineEndY.toFixed(2));
    line.setAttribute('stroke', color); line.setAttribute('stroke-width', strokeWidth);
    line.setAttribute('stroke-linecap', 'round'); line.setAttribute('opacity', opacity);

    const headBaseX = to.x - Math.cos(angle) * arrowHeadLength;
    const headBaseY = to.y - Math.sin(angle) * arrowHeadLength;
    const perpX = Math.sin(angle) * arrowHeadWidth / 2;
    const perpY = -Math.cos(angle) * arrowHeadWidth / 2;

    const head = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    head.setAttribute('points', `${to.x.toFixed(2)},${to.y.toFixed(2)} ${(headBaseX+perpX).toFixed(2)},${(headBaseY+perpY).toFixed(2)} ${(headBaseX-perpX).toFixed(2)},${(headBaseY-perpY).toFixed(2)}`);
    head.setAttribute('fill', color); head.setAttribute('opacity', opacity);

    group.appendChild(line);
    group.appendChild(head);
  }

  function drawBestMoveArrow(move, multiPvMoves) {
    if (!move || move.length < 4) { clearArrow(); return; }
    const board = findBoard();
    if (!board) return;

    // LICHESS: use orientation-black class from cg-wrap
    const isFlipped = board.classList?.contains('orientation-black') || playerColor === 'b';

    const svg = createArrowOverlay(board);
    if (!svg) return;

    const existingGroup = svg.querySelector('.best-move-arrow-group');
    if (existingGroup) existingGroup.remove();

    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    group.setAttribute('class', 'best-move-arrow-group');

    const alts = (multiPvMoves || []).filter(m => m && m.length >= 4);
    if (showAltArrows) {
      if (alts[2]) drawArrow(group, alts[2].substring(0,2), alts[2].substring(2,4), isFlipped, '#e05050', '0.45', 1.6);
      if (alts[1]) drawArrow(group, alts[1].substring(0,2), alts[1].substring(2,4), isFlipped, '#e0b840', '0.55', 1.8);
    }
    drawArrow(group, move.substring(0,2), move.substring(2,4), isFlipped, '#792A9E', '0.9', 2.2);

    svg.appendChild(group);
    currentBestMove = move;
  }

  function clearArrow() {
    if (arrowOverlay) {
      const existingGroup = arrowOverlay.querySelector('.best-move-arrow-group');
      if (existingGroup) existingGroup.remove();
    }
    currentBestMove = null;
  }

  function drawMoveIconOnBoard(toSquare, classification) {
    const board = findBoard();
    if (!board) return;

    // LICHESS: orientation-black detection
    const isFlipped = board.classList?.contains('orientation-black') || playerColor === 'b';

    const svg = createArrowOverlay(board);
    if (!svg) return;

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

    const iconSize = 3.8;
    const iconX = squareX + squareSize - iconSize + 0.2;
    const iconY = squareY - 0.2;

    const { bg, inner } = getMoveIconParts(classification);
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', 'move-icon-group');
    g.setAttribute('transform', `translate(${iconX}, ${iconY}) scale(${iconSize / 18})`);
    g.innerHTML =
      `<path opacity="0.3" d="M9,.5a9,9,0,1,0,9,9A9,9,0,0,0,9,.5Z"/>` +
      `<path fill="${bg}" d="M9,0a9,9,0,1,0,9,9A9,9,0,0,0,9,0Z"/>` + inner;
    svg.appendChild(g);
  }

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

  // ============================================================
  // LICHESS-SPECIFIC BOARD FUNCTIONS
  // ============================================================

  // Returns the cg-wrap element (has orientation-black/white class and board dimensions)
  function findBoard() {
    return document.querySelector('cg-wrap') || document.querySelector('.cg-wrap');
  }

  // Returns cg-board (the actual surface with pieces)
  function getBoardSurface(board) {
    return board.querySelector('cg-board') || board;
  }

  // True when board is displayed from Black's perspective
  function isFlippedBoard(board) {
    if (!board) board = findBoard();
    return board?.classList.contains('orientation-black') || false;
  }

  // Extract FEN from lichess board (DOM-based, reliable for live + analysis)
  function extractFEN(board) {
    // Method 1: Try window.lichess analysis node (analysis pages, includes full FEN with turn)
    try {
      const fen = window.lichess?.analysis?.node?.fen;
      if (fen && fen.split('/').length >= 7) return fen;
    } catch(e) {}

    // Method 2: Try window.lichess round data
    try {
      const fen = window.lichess?.round?.data?.game?.fen;
      if (fen && fen.split('/').length >= 7) return fen;
    } catch(e) {}

    // Method 3: data-fen attribute anywhere on page
    const fenEl = document.querySelector('[data-fen]');
    if (fenEl) {
      const fen = fenEl.getAttribute('data-fen');
      if (fen && fen.split('/').length >= 7) return fen;
    }

    // Method 4: Parse pieces from chessground DOM (primary reliable fallback)
    return parsePiecesFromDOM(board);
  }

  // Determine castling rights from piece positions
  function determineCastlingRights(boardArray) {
    let rights = '';
    const whiteKingOnE1 = boardArray[7][4] === 'K';
    const whiteRookOnH1 = boardArray[7][7] === 'R';
    const whiteRookOnA1 = boardArray[7][0] === 'R';
    const blackKingOnE8 = boardArray[0][4] === 'k';
    const blackRookOnH8 = boardArray[0][7] === 'r';
    const blackRookOnA8 = boardArray[0][0] === 'r';

    if (whiteKingOnE1 && whiteRookOnH1) rights += 'K';
    if (whiteKingOnE1 && whiteRookOnA1) rights += 'Q';
    if (blackKingOnE8 && blackRookOnH8) rights += 'k';
    if (blackKingOnE8 && blackRookOnA8) rights += 'q';
    return rights || '-';
  }

  // Parse chessground pieces: <piece class="white knight" style="transform: translate(Xpx, Ypx)">
  function parsePiecesFromDOM(board) {
    const cgBoard = getBoardSurface(board);
    // Piece is mid-drag: its transform tracks the cursor, not a square
    if (cgBoard.querySelector('piece.dragging')) return null;
    const pieces = cgBoard.querySelectorAll('piece');
    if (!pieces.length) return null;

    const boardRect = board.getBoundingClientRect();
    const squareSize = boardRect.width / 8;
    if (squareSize <= 0) return null;

    const flipped = isFlippedBoard(board);

    // Chessground piece name → FEN character
    const lichessPieceMap = {
      king: { white: 'K', black: 'k' },
      queen: { white: 'Q', black: 'q' },
      rook: { white: 'R', black: 'r' },
      bishop: { white: 'B', black: 'b' },
      knight: { white: 'N', black: 'n' },
      pawn: { white: 'P', black: 'p' },
    };

    const boardArray = Array(8).fill(null).map(() => Array(8).fill(null));

    pieces.forEach(piece => {
      const cls = [...piece.classList];
      const colorStr = cls.includes('white') ? 'white' : cls.includes('black') ? 'black' : null;
      if (!colorStr) return;

      let fenChar = null;
      for (const [name, chars] of Object.entries(lichessPieceMap)) {
        if (cls.includes(name)) { fenChar = chars[colorStr]; break; }
      }
      if (!fenChar) return;

      // Chessground uses transform: translate(Xpx, Ypx)
      const transform = piece.style.transform;
      const match = transform.match(/translate\((\d+(?:\.\d+)?)px,\s*(\d+(?:\.\d+)?)px\)/);
      if (!match) return;

      const xPx = parseFloat(match[1]);
      const yPx = parseFloat(match[2]);

      // Convert pixel coordinates to file/rank indices
      // White orientation: x=file*sq, y=(7-rank)*sq  →  file=x/sq, rank=7-y/sq
      // Black orientation: x=(7-file)*sq, y=rank*sq  →  file=7-x/sq, rank=y/sq
      let fileIdx, rankIdx;
      if (flipped) {
        fileIdx = 7 - Math.round(xPx / squareSize);
        rankIdx = Math.round(yPx / squareSize);  // rank 0 = rank 1 at top in black view
      } else {
        fileIdx = Math.round(xPx / squareSize);
        rankIdx = 7 - Math.round(yPx / squareSize);  // rank 7 = rank 8 at top
      }

      if (fileIdx < 0 || fileIdx > 7 || rankIdx < 0 || rankIdx > 7) return;
      // boardArray: row 0 = rank 8, row 7 = rank 1
      boardArray[7 - rankIdx][fileIdx] = fenChar;
    });

    let fen = '';
    for (let row = 0; row < 8; row++) {
      let empty = 0;
      for (let col = 0; col < 8; col++) {
        const p = boardArray[row][col];
        if (p) { if (empty > 0) { fen += empty; empty = 0; } fen += p; }
        else empty++;
      }
      if (empty > 0) fen += empty;
      if (row < 7) fen += '/';
    }

    const turn = detectTurn(board);
    const castling = determineCastlingRights(boardArray);
    fen += ` ${turn} ${castling} - 0 1`;
    return fen;
  }

  // Find a piece element on a specific square (by transform position)
  function findPieceOnSquare(board, square) {
    const cgBoard = getBoardSurface(board);
    const boardRect = board.getBoundingClientRect();
    const sq = boardRect.width / 8;
    if (sq <= 0) return null;

    const { file, rank } = squareToIndices(square);
    const flipped = isFlippedBoard(board);

    let expectedX, expectedY;
    if (flipped) {
      expectedX = (7 - file) * sq;
      expectedY = rank * sq;
    } else {
      expectedX = file * sq;
      expectedY = (7 - rank) * sq;
    }

    const tolerance = sq * 0.35;
    for (const piece of cgBoard.querySelectorAll('piece')) {
      const m = piece.style.transform.match(/translate\((\d+(?:\.\d+)?)px,\s*(\d+(?:\.\d+)?)px\)/);
      if (!m) continue;
      const x = parseFloat(m[1]), y = parseFloat(m[2]);
      if (Math.abs(x - expectedX) < tolerance && Math.abs(y - expectedY) < tolerance) {
        return piece;
      }
    }
    return null;
  }

  // Handle promotion dialog on lichess
  function handlePromotion(piece) {
    const promotionMap = { 'q': 'queen', 'r': 'rook', 'b': 'bishop', 'n': 'knight' };
    const pieceName = promotionMap[piece?.toLowerCase()] || 'queen';

    // Lichess promotion choice squares
    const choice = document.querySelector(`.promotion-choice square[choice="${pieceName}"]`) ||
                   document.querySelector(`.promotion-choice square`);
    if (choice) { choice.click(); return; }

    // Fallback
    const el = document.querySelector(`.promotion-piece.${pieceName}, [data-piece="${pieceName}"]`);
    if (el) el.click();
  }

  // Detect puzzle mode (lichess training)
  function isPuzzleMode() {
    const path = window.location.pathname;
    return path.startsWith('/training') ||
           path.startsWith('/puzzle') ||
           !!document.querySelector('.puzzle--workout, .puzzle__side');
  }

  // Detect player's color from cg-wrap orientation class
  function detectPlayerColor() {
    if (manualPlayerColor === 'w') return 'w';
    if (manualPlayerColor === 'b') return 'b';

    // Puzzles always follow the current turn regardless of game state
    if (isPuzzleMode()) return currentTurn;

    // Spectating (TV, home, or someone else's game): no player color,
    // so eval and arrows are shown for whichever side is to move.
    if (!isInOwnGame()) return null;

    const board = findBoard();
    if (board?.classList.contains('orientation-black')) return 'b';
    if (board?.classList.contains('orientation-white')) return 'w';

    try {
      const color = window.lichess?.analysis?.data?.player?.color;
      if (color === 'black') return 'b';
      if (color === 'white') return 'w';
    } catch(e) {}

    return null;
  }

  // Detect whose turn it is
  function detectTurn(board) {
    // Try window.lichess analysis node FEN (has turn embedded)
    try {
      const fen = window.lichess?.analysis?.node?.fen;
      if (fen) {
        const parts = fen.split(' ');
        if (parts[1] === 'w' || parts[1] === 'b') return parts[1];
      }
    } catch(e) {}

    // Check active clock for live games
    const whiteActive = document.querySelector('.rclock-white.running, .clock.white.running');
    if (whiteActive) return 'w';
    const blackActive = document.querySelector('.rclock-black.running, .clock.black.running');
    if (blackActive) return 'b';

    // Count moves in analysis move list (each <move> element = 1 ply)
    const moves = document.querySelectorAll('.tview2 move:not(.empty)');
    if (moves.length > 0) return moves.length % 2 === 0 ? 'w' : 'b';

    // Count round game moves
    const roundMoves = document.querySelectorAll('.moves kwdb, l4x kwdb');
    if (roundMoves.length > 0) return roundMoves.length % 2 === 0 ? 'w' : 'b';

    // Last resort (works on TV/home page): look at which color piece sits on the
    // last-move destination — whoever just moved, the other side is to move now.
    if (board) {
      const cgBoard = getBoardSurface(board);
      const boardRect = board.getBoundingClientRect();
      const squareSize = boardRect.width / 8;
      if (squareSize > 0) {
        for (const sqEl of cgBoard.querySelectorAll('square.last-move')) {
          const m = sqEl.style.transform.match(/translate\((\d+(?:\.\d+)?)px,\s*(\d+(?:\.\d+)?)px\)/);
          if (!m) continue;
          const xPx = parseFloat(m[1]), yPx = parseFloat(m[2]);
          for (const piece of cgBoard.querySelectorAll('piece')) {
            const pm = piece.style.transform.match(/translate\((\d+(?:\.\d+)?)px,\s*(\d+(?:\.\d+)?)px\)/);
            if (!pm) continue;
            if (Math.abs(parseFloat(pm[1]) - xPx) < squareSize * 0.4 &&
                Math.abs(parseFloat(pm[2]) - yPx) < squareSize * 0.4) {
              if (piece.classList.contains('white')) return 'b';
              if (piece.classList.contains('black')) return 'w';
            }
          }
        }
      }
    }

    return 'w';
  }

  function countConsecutive(history, result) {
    let n = 0;
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i] === result) n++; else break;
    }
    return n;
  }

  function effectiveThreshold(base, isRandom) {
    if (!isRandom || base <= 1) return base;
    return 1 + Math.floor(Math.random() * base);
  }

  // Detect player ELO from lichess DOM
  function detectPlayerElo() {
    if (manualElo) return manualElo;

    // Lichess shows ratings near the board; bottom player = current user
    const flipped = isFlippedBoard();
    const selectors = [
      '.game__side__user .rating',
      '.ruser .rating',
      '.player .rating',
      '.user-link .rating',
      'rating',  // custom element
    ];

    for (const sel of selectors) {
      const els = [...document.querySelectorAll(sel)];
      if (!els.length) continue;
      // Bottom player is last element in normal orientation, first when flipped
      const el = flipped ? els[0] : els[els.length - 1];
      const m = el.textContent.trim().match(/\d{3,4}/);
      if (m) return parseInt(m[0]);
    }
    return null;
  }

  async function recordGameResult(result) {
    if (gameOverHandled) return;
    gameOverHandled = true;
    log(`Chessist: Game over - result: ${result}`);

    try {
      const local = await chrome.storage.local.get(['gameHistory']);
      const history = local.gameHistory || [];
      history.push(result);
      if (history.length > 30) history.shift();

      let throwNext = false, winNext = false;
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
    } catch (e) {}
  }

  // Watch for lichess game-over result
  function watchForGameOver() {
    let checkInterval = null;

    function checkResult() {
      if (gameOverHandled) { clearInterval(checkInterval); return; }

      // Lichess game result element
      const candidates = [
        document.querySelector('.result-wrap'),
        document.querySelector('.game-result'),
        document.querySelector('div.status'),
        document.querySelector('.lichess__board__round .result'),
      ];

      for (const el of candidates) {
        if (!el) continue;
        const text = el.textContent.toLowerCase();

        const whiteWin = text.includes('white wins') || text.includes('1-0');
        const blackWin = text.includes('black wins') || text.includes('0-1');
        const draw = text.includes('½-½') || text.includes('draw') || text.includes('stalemate') || text.includes('repetition');

        if (whiteWin) {
          recordGameResult(playerColor === 'w' ? 'w' : 'l');
          clearInterval(checkInterval);
          return;
        }
        if (blackWin) {
          recordGameResult(playerColor === 'b' ? 'w' : 'l');
          clearInterval(checkInterval);
          return;
        }
        if (draw) {
          recordGameResult('d');
          clearInterval(checkInterval);
          return;
        }
      }
    }

    checkInterval = setInterval(checkResult, 1000);
    let _gorPending = false;
    const observer = new MutationObserver(() => {
      if (_gorPending) return;
      _gorPending = true;
      setTimeout(() => { _gorPending = false; checkResult(); }, 500);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // Lichess game ID (8-char alphanumeric at start of path)
  function getGameId() {
    return window.location.pathname.match(/^\/([a-zA-Z0-9]{8})/)?.[1] || null;
  }

  // True only when the user is playing their own game (not spectating home/TV)
  function isInOwnGame() {
    if (!getGameId()) return false;
    // If lichess exposes round data, check that the local player has a color assigned
    try {
      if (window.lichess?.round?.data?.player?.color) return true;
    } catch (e) {}
    return false;
  }

  // ============================================================
  // ACCURACY TRACKING (unchanged)
  // ============================================================

  function winPercent(cp) {
    return 100 / (1 + Math.exp(-0.00368208 * cp));
  }

  function calculateMoveAccuracy(prevCp, newCp) {
    const winBefore = winPercent(prevCp);
    const winAfter = winPercent(newCp);
    const winLoss = Math.max(0, winBefore - winAfter);
    return Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * winLoss) - 3.1669));
  }

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
      accuracyIconSvg = text.replace(/style="[^"]*"/, '').replace(/<svg /, '<svg ');
    } catch (e) { accuracyIconSvg = ''; }
    return accuracyIconSvg;
  }

  function updateAccuracyDisplay(accuracy, playedBestMove) {
    if (accuracyEl && moveAccuracies.length > 0) {
      const avg = moveAccuracies.reduce((a, b) => a + b, 0) / moveAccuracies.length;
      const avgPct = avg.toFixed(1);
      const colorClass = accuracyColorClass(avg);
      getAccuracyIcon().then(svgHtml => {
        if (!accuracyEl) return;
        const wrappedIcon = svgHtml ? `<span class="acc-icon ${colorClass}">${svgHtml}</span>` : '';
        accuracyEl.innerHTML = wrappedIcon + `<span class="acc-last ${colorClass}">${avgPct}%</span>`;
        accuracyEl.className = 'chess-live-eval-accuracy';
        accuracyEl.style.display = 'flex';
      });
    }
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

  // ============================================================
  // EVAL BAR (lichess: always custom, no native container)
  // ============================================================

  function createEvalBar(board) {
    if (evalBar) return;
    if (overlayMode) return;

    log('Chessist: Creating eval bar for lichess');

    const boardRect = board.getBoundingClientRect();
    const boardHeight = boardRect.height || 400;

    evalBar = document.createElement('div');
    evalBar.className = 'chess-live-eval-bar loading';
    evalBar.style.height = `${boardHeight}px`;
    evalBar.style.position = 'absolute';
    evalBar.style.left = '-32px';
    evalBar.style.top = '0';

    evalBarFill = document.createElement('div');
    evalBarFill.className = 'chess-live-eval-bar-fill';
    evalBarFill.style.setProperty('height', '50%', 'important');

    evalScore = document.createElement('div');
    evalScore.className = 'chess-live-eval-score equal';
    evalScore.textContent = '0.0';

    bestMoveEl = document.createElement('div');
    bestMoveEl.className = 'chess-live-eval-best-move';
    bestMoveEl.style.display = 'none';

    countdownEl = document.createElement('div');
    countdownEl.className = 'chess-live-eval-countdown';
    countdownEl.style.display = 'none';

    depthEl = document.createElement('div');
    depthEl.className = 'chess-live-eval-depth';
    depthEl.textContent = '';

    turnIndicatorEl = document.createElement('div');
    turnIndicatorEl.className = 'chess-live-eval-turn';
    turnIndicatorEl.textContent = '';

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

    // Insert before the board in parent container
    let insertParent = board.parentElement;
    if (!insertParent) return;
    const parentStyle = window.getComputedStyle(insertParent);
    if (parentStyle.position === 'static') insertParent.style.position = 'relative';
    insertParent.insertBefore(evalBar, board);

    // Track board size changes
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const newHeight = entry.contentRect.height;
        if (newHeight > 100) evalBar.style.height = `${newHeight}px`;
      }
    });
    resizeObserver.observe(board);
  }

  // ============================================================
  // EVAL UPDATE
  // ============================================================

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

  // ── Move prediction cache ─────────────────────────────────────────────────
  let _pvQuickCache = null; // instant pv-derived prediction: { fenKey, bestMove, cp, mate, pv, depth, turn }
  let _preWarmCache = null; // exact engine result for predicted position: { fenKey, eval }

  function _fenKey(fen) { return fen ? fen.split(' ').slice(0, 2).join(' ') : null; }

  function _applyMove(fen, move) {
    if (!fen || !move || move.length < 4) return null;
    try {
      const sp = fen.split(' ');
      const turn = sp[1] || 'w';
      const b = sp[0].split('/').map(r => {
        const row = [];
        for (const c of r) /\d/.test(c) ? row.push(...Array(+c).fill(null)) : row.push(c);
        return row;
      });
      const ff = move.charCodeAt(0)-97, fr = +move[1]-1;
      const tf = move.charCodeAt(2)-97, tr = +move[3]-1;
      const piece = b[7-fr][ff];
      if (!piece) return null;
      b[7-fr][ff] = null;
      b[7-tr][tf] = move[4] ? (turn==='w' ? move[4].toUpperCase() : move[4]) : piece;
      if (piece.toLowerCase()==='k' && Math.abs(tf-ff)===2) {
        const rf=tf>ff?7:0, rt=tf>ff?5:3;
        b[7-fr][rt]=b[7-fr][rf]; b[7-fr][rf]=null;
      }
      const board = b.map(row => {
        let s='',e=0;
        for (const c of row) c?(e&&(s+=e,e=0),s+=c):e++;
        return s+(e||'');
      }).join('/');
      return `${board} ${turn==='w'?'b':'w'} - - 0 1`;
    } catch (_) { return null; }
  }

  function _updatePVPrediction(evaluation) {
    if (!evaluation.pv || evaluation.pv.length < 2 || !currentFen) return;
    const after1 = _applyMove(currentFen, evaluation.pv[0]);
    if (!after1) return;
    const after2 = _applyMove(after1, evaluation.pv[1]);
    if (!after2) return;
    const key = _fenKey(after2);
    _pvQuickCache = {
      fenKey: key,
      bestMove: evaluation.pv[2] || null,
      cp: evaluation.cp,
      mate: evaluation.mate,
      pv: evaluation.pv.slice(2),
      depth: evaluation.depth,
      turn: after2.split(' ')[1] || 'w',
    };
    _preWarmCache = null;
    if (_overlayWs?.readyState === WebSocket.OPEN) {
      try {
        _overlayWs.send(JSON.stringify({
          type: 'evaluate', fen: after2, depth: targetDepth, multiPv: showAltArrows ? 3 : 1,
        }));
      } catch (_) {}
    }
  }
  let _boardObserver = null;
  let _observedBoard = null;
  let _lastEvaluation = null;

  function _connectEngineWs() {
    if (_overlayWs && _overlayWs.readyState <= WebSocket.OPEN) return;
    try {
      _overlayWs = new WebSocket('ws://127.0.0.1:27301');
      _overlayWs.onopen  = () => {
        clearTimeout(_overlayReconnectTimer); _overlayReconnectTimer = null;
        sendPositionUpdate();
        // Board may not be in DOM yet on page load — poll until ready
        if (!findBoard()) {
          const _initPoll = setInterval(() => {
            if (!_overlayWs || _overlayWs.readyState !== WebSocket.OPEN) { clearInterval(_initPoll); return; }
            if (findBoard()) { sendPositionUpdate(); clearInterval(_initPoll); }
          }, 200);
        }
        if (_lastEvaluation) updateEval(_lastEvaluation);
        if (currentFen) requestEval(currentFen); // always request fresh after (re)connect
      };
      _overlayWs.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === 'eval' && msg.data) {
            const d = msg.data;
            const key = _fenKey(d.fen);
            const curKey = _fenKey(currentFen);
            if (key && key !== curKey) {
              // Only store complete (target-depth) pre-warm results — intermediate depths would
              // be served as the final answer and block the fresh eval request.
              if (_pvQuickCache && key === _pvQuickCache.fenKey && d.depth >= targetDepth)
                _preWarmCache = { fenKey: key, eval: d };
              return;
            }
            handleEvaluationResult(d);
          } else if (msg.type === 'engine_status') {
            chrome.runtime.sendMessage({ type: 'ENGINE_STATUS', status: msg.status, message: msg.message }).catch(() => {});
          }
        } catch (ignore) {}
      };
      _overlayWs.onclose = () => {
        _overlayWs = null;
        _overlayReconnectTimer = setTimeout(_connectEngineWs, 3000);
      };
      _overlayWs.onerror = () => {};
    } catch (e) {}
  }

  function _connectOverlayWs() { _connectEngineWs(); }

  function _disconnectOverlayWs() {
    clearTimeout(_overlayReconnectTimer);
    _overlayReconnectTimer = null;
    if (_overlayWs?.readyState === WebSocket.OPEN) {
      try { _overlayWs.send(JSON.stringify({ positionOnly: true, visible: false })); } catch (e) {}
    }
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

  // Fallback: re-show overlay every 1s — catches focus-restore, post-refresh board-ready, etc.
  setInterval(() => {
    if (!overlayMode || !isEnabled || !_overlayWs || _overlayWs.readyState !== WebSocket.OPEN) return;
    sendPositionUpdate();
  }, 1000);
  window.addEventListener('resize', sendPositionUpdate);
  window.addEventListener('scroll', sendPositionUpdate, { passive: true });
  document.addEventListener('fullscreenchange', sendPositionUpdate);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', sendPositionUpdate);
    window.visualViewport.addEventListener('scroll', sendPositionUpdate);
  }
  _watchZoom();

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (overlayMode && _overlayWs?.readyState === WebSocket.OPEN)
        try { _overlayWs.send(JSON.stringify({ positionOnly: true, visible: false })); } catch (e) {}
    } else {
      if (_overlayWs && _overlayWs.readyState === WebSocket.OPEN) sendPositionUpdate();
      else _connectEngineWs();
    }
  });
  window.addEventListener('focus', () => {
    if (!(_overlayWs && _overlayWs.readyState <= WebSocket.OPEN)) _connectEngineWs();
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

    const isPlayerTurn = !playerColor || currentTurn === playerColor;
    const showBest = isPlayerTurn ? showBestMove : showOpponentBestMove;
    const atDepth  = evaluation.depth >= targetDepth;
    const arrows   = [];
    if (showBest && atDepth) {
      const best = evaluation.bestMove;
      if (best && best.length >= 4)
        arrows.push({ from: best.substring(0, 2), to: best.substring(2, 4) });
      if (showAltArrows) {
        const alts = (evaluation.multiPvMoves || []).filter(m => m && m.length >= 4);
        for (let i = 0; i < Math.min(2, alts.length); i++)
          arrows.push({ from: alts[i].substring(0, 2), to: alts[i].substring(2, 4) });
      }
    }

    const dpr = window.devicePixelRatio || 1;
    try {
      const msg = {
        visible: true,
        flipped: isFlipped,
        viewX: rect.left, viewY: rect.top,
        width: rect.width, height: rect.height,
        dpr,
        evalBar: { fillPercent, isFlipped, score: displayScore },
        manualMap,
        offsetX: manualOffsetX,
        offsetY: manualOffsetY,
      };
      // Only update arrows at target depth — avoids blanking them during analysis
      if (atDepth) msg.arrows = arrows;
      _overlayWs.send(JSON.stringify(msg));
    } catch (e) {}
  }

  function updateEval(evaluation) {
    if (!evalBar && !overlayMode) return;

    if (evalBar && evaluation.depth >= targetDepth) evalBar.classList.remove('loading');

    if (isPuzzleMode() || !playerColor) playerColor = detectPlayerColor();

    let displayScore, fillPercent, scoreClass;
    let rawMate = evaluation.mate;
    let rawCp = evaluation.cp || 0;

    const evalTurn = evaluation.turn || 'w';
    const isBlackToMove = evalTurn === 'b';
    if (isBlackToMove) {
      if (rawMate !== undefined) rawMate = -rawMate;
      rawCp = -rawCp;
    }

    const isPlayerTurnForEval = playerColor && evalTurn === playerColor;
    if (isPlayerTurnForEval) {
      prevCpWhite = rawMate !== undefined ? (rawMate > 0 ? 10000 : -10000) : rawCp;
      if (evaluation.depth >= targetDepth) prevBestMove = evaluation.bestMove || null;
    }

    const viewFromBlack = playerColor === 'b';
    let displayMate = rawMate;
    let displayCp = rawCp;

    if (viewFromBlack) {
      if (displayMate !== undefined) displayMate = -displayMate;
      displayCp = -displayCp;
    }

    if (displayMate !== undefined) {
      const mateIn = displayMate;
      displayScore = mateIn > 0 ? `M${mateIn}` : `M${Math.abs(mateIn)}`;
      if (viewFromBlack) {
        fillPercent = displayMate > 0 ? 100 : 0;
        scoreClass = displayMate > 0 ? 'black-winning mate' : 'white-winning mate';
      } else {
        fillPercent = rawMate > 0 ? 100 : 0;
        scoreClass = rawMate > 0 ? 'white-winning mate' : 'black-winning mate';
      }
    } else {
      const pawns = displayCp / 100;
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
      const evalForFill = viewFromBlack ? displayCp : rawCp;
      const clampedPawns = Math.max(-10, Math.min(10, evalForFill / 100));
      fillPercent = 50 + (clampedPawns / 10) * 50;
    }

    sendOverlayUpdate(fillPercent, displayScore, viewFromBlack, evaluation);

    if (!overlayMode) {
      evalBarFill.style.setProperty('height', `${fillPercent}%`, 'important');
      if (evalBar) evalBar.classList.toggle('flipped', viewFromBlack);

      evalScore.textContent = displayScore;
      evalScore.className = `chess-live-eval-score ${scoreClass}`;

      if (evaluation.bestMove) {
        const move = evaluation.bestMove;
        let formattedMove = move;
        if (move.length >= 4) {
          const from = move.substring(0, 2);
          const to = move.substring(2, 4);
          const promotion = move.length > 4 ? '=' + move[4].toUpperCase() : '';
          formattedMove = `${from}→${to}${promotion}`;
        }

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
        if (bestMoveEl) bestMoveEl.style.display = 'none';
        clearArrow();
      }

      if (depthEl && evaluation.depth) depthEl.textContent = `D${evaluation.depth}`;
    }

    // Auto-move (only when playing an own game, not spectating home/TV)
    if (autoMove && evaluation.bestMove && evaluation.depth >= targetDepth && isInOwnGame()) {
      const isPlayerTurn = playerColor && currentTurn === playerColor;
      let evalMatchesCurrent = true;
      if (evaluation.fen && currentFen) {
        const evalPosition = evaluation.fen.split(' ').slice(0, 2).join(' ');
        const currentPosition = currentFen.split(' ').slice(0, 2).join(' ');
        evalMatchesCurrent = evalPosition === currentPosition;
      }

      const positionKey = currentFen ? currentFen.split(' ').slice(0, 2).join(' ') : null;

      // fromCache=true means PV-derived prediction (display only) — wait for real engine result
      if (isPlayerTurn && evalMatchesCurrent && positionKey && positionKey !== lastAutoMovePosition && !evaluation.fromCache) {
        lastAutoMovePosition = positionKey;

        let moveToPlay = evaluation.bestMove;
        const pv = evaluation.pv || [];

        if (shouldWinThisGame) {
          log('Chessist: Win mode - playing best move');
        } else if (shouldThrowThisGame && pv.length >= 3) {
          const ourPvMoves = pv.filter((_, i) => i % 2 === 0);
          if (ourPvMoves.length >= 2) {
            const throwIdx = Math.min(ourPvMoves.length - 1, 1 + Math.floor(Math.random() * Math.max(1, ourPvMoves.length - 1)));
            moveToPlay = ourPvMoves[throwIdx];
            log('Chessist: Throw mode - playing PV even-index', throwIdx * 2, ':', moveToPlay);
          }
        } else if (targetAccuracy < 100 && pv.length > 1) {
          const deviationChance = (100 - targetAccuracy) / 100;
          if (Math.random() < deviationChance) {
            const maxIdx = Math.min(pv.length - 1, Math.ceil((100 - targetAccuracy) / 15));
            const ourMoves = pv.filter((_, i) => i % 2 === 0);
            const pick = Math.min(ourMoves.length - 1, 1 + Math.floor(Math.random() * maxIdx));
            if (pick > 0 && ourMoves[pick]) {
              moveToPlay = ourMoves[pick];
              log('Chessist: Target accuracy', targetAccuracy, '% - deviating to PV move', pick);
            }
          }
        } else if (skillLevel < 20 && pv.length > 1) {
          const blunderChance = (20 - skillLevel) / 25;
          if (Math.random() < blunderChance) {
            const maxIndex = Math.min(pv.length - 1, Math.ceil((20 - skillLevel) / 4));
            const pickIndex = Math.floor(Math.random() * (maxIndex + 1));
            if (pickIndex > 0 && pv[pickIndex]) {
              moveToPlay = pv[pickIndex];
              log('Chessist: Skill level', skillLevel, '- picking move', pickIndex + 1, 'from PV:', moveToPlay);
            }
          }
        }

        const minDelayMs = autoMoveDelayMin * 1000;
        const maxDelayMs = autoMoveDelayMax * 1000;
        const delayRange = maxDelayMs - minDelayMs;
        let finalDelay;

        if (smartTiming) {
          const complexity = calculateMoveComplexity(moveToPlay, evaluation, currentFen);
          const baseDelay = minDelayMs + (delayRange * complexity);
          const randomFactor = 0.8 + (Math.random() * 0.4);
          finalDelay = Math.floor(baseDelay * randomFactor);
          log('Chessist: Move complexity:', complexity.toFixed(2), '-> delay:', finalDelay, 'ms');
        } else {
          finalDelay = Math.floor(Math.random() * (delayRange + 1)) + minDelayMs;
          log('Chessist: Random delay:', finalDelay, 'ms');
        }

        if (instantMove) {
          log('Chessist: Instant auto-move for', moveToPlay);
          hideCountdown();
          _executeMoveVerified(moveToPlay, positionKey);
        } else {
          log('Chessist: Auto-move triggered for', moveToPlay, 'with delay', finalDelay, 'ms');
          startCountdown(finalDelay, positionKey, moveToPlay);
        }
      } else if (!evalMatchesCurrent) {
        log('Chessist: Skipping auto-move - stale evaluation');
      }
    }
  }

  function calculateMoveComplexity(move, evaluation, fen) {
    let complexity = 0.5;
    if (fen && move.length >= 4) {
      const toSquare = move.substring(2, 4);
      const toFile = toSquare.charCodeAt(0) - 97;
      const toRank = parseInt(toSquare[1]) - 1;
      const fenBoard = fen.split(' ')[0];
      const rows = fenBoard.split('/');
      if (rows.length === 8) {
        const row = rows[7 - toRank];
        let fileIndex = 0;
        for (const char of row) {
          if (fileIndex === toFile) {
            if (isNaN(parseInt(char))) complexity -= 0.2;
            break;
          }
          if (isNaN(parseInt(char))) fileIndex++;
          else fileIndex += parseInt(char);
        }
      }
    }
    const evalCp = Math.abs(evaluation.cp || 0);
    if (evaluation.mate !== undefined) complexity -= 0.3;
    else if (evalCp > 500) complexity -= 0.2;
    else if (evalCp > 200) complexity -= 0.1;
    else if (evalCp < 50) complexity += 0.2;
    if (move.length > 4) complexity -= 0.15;
    if (evaluation.pv?.length >= 6) complexity -= 0.1;
    return Math.max(0.0, Math.min(1.0, complexity));
  }

  function startCountdown(delayMs, expectedPosition, moveToPlay) {
    hideCountdown();
    const endTime = Date.now() + delayMs;
    if (countdownEl) countdownEl.style.display = 'block';

    countdownInterval = setInterval(() => {
      const remaining = Math.max(0, endTime - Date.now());
      if (countdownEl) countdownEl.textContent = `${(remaining / 1000).toFixed(1)}s`;

      const board = findBoard();
      const currentFenNow = board ? extractFEN(board) : null;
      if (currentFenNow) {
        const nowPosition = currentFenNow.split(' ').slice(0, 2).join(' ');
        if (nowPosition !== expectedPosition) { log('Chessist: Position changed, cancelling countdown'); hideCountdown(); return; }
      }

      if (remaining <= 0) { hideCountdown(); log('Chessist: Countdown complete, executing move:', moveToPlay); _executeMoveVerified(moveToPlay, expectedPosition); }
    }, 100);
  }

  function hideCountdown() {
    if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
    if (countdownEl) { countdownEl.style.display = 'none'; countdownEl.textContent = ''; }
  }

  function showRefreshMessage() {
    if (evalBar) {
      if (evalScore) { evalScore.textContent = 'Refresh'; evalScore.title = 'Extension needs page refresh'; evalScore.style.cursor = 'pointer'; evalScore.onclick = () => window.location.reload(); }
      if (bestMoveEl) bestMoveEl.textContent = 'Click to reload page';
      evalBar.classList.remove('loading');
    }
  }

  async function requestEval(fen, isMouseRelease = false) {
    if (!isEnabled || !fen) return;
    if (!extensionContextValid || !checkExtensionContext()) { showRefreshMessage(); return; }

    log('Chessist: Requesting eval for FEN:', fen, isMouseRelease ? '(mouse release)' : '');

    // Use Chessist Engine via WebSocket when connected
    if (_overlayWs?.readyState === WebSocket.OPEN) {
      try {
        const key = _fenKey(fen);
        // Serve pre-warmed exact engine result instantly
        if (_preWarmCache?.fenKey === key) {
          const cached = _preWarmCache.eval;
          _preWarmCache = null;
          handleEvaluationResult(cached);
          return;
        }
        // Serve instant PV-derived prediction while engine computes fresh
        if (_pvQuickCache?.fenKey === key && _pvQuickCache.bestMove) {
          handleEvaluationResult({
            bestMove: _pvQuickCache.bestMove, cp: _pvQuickCache.cp, mate: _pvQuickCache.mate,
            pv: _pvQuickCache.pv, depth: _pvQuickCache.depth, turn: _pvQuickCache.turn,
            fen, fromCache: true,
          });
        }
        _overlayWs.send(JSON.stringify({
          type: 'evaluate', fen, depth: targetDepth, multiPv: showAltArrows ? 3 : 1,
        }));
        return;
      } catch (e) {}
    }

    // Fallback: WASM via service worker
    try {
      const response = await chrome.runtime.sendMessage({ type: 'EVALUATE', fen, isMouseRelease, t: Date.now() });
      if (response && response.evaluation) updateEval(response.evaluation);
    } catch (e) {
      const errorMsg = e.message || e.toString();
      if (errorMsg.includes('Extension context invalidated') || errorMsg.includes('message channel closed')) {
        extensionContextValid = false; showRefreshMessage();
      } else {
        console.error('Chessist: Error requesting evaluation', e);
      }
    }
  }

  // Shared handler for eval results from either WS engine or WASM service worker
  function handleEvaluationResult(evaluation) {
    if (!evaluation) return;
    if (evaluation.fen && currentFen) {
      const evalPosition = evaluation.fen.split(' ').slice(0, 2).join(' ');
      const currentPosition = currentFen.split(' ').slice(0, 2).join(' ');
      if (evalPosition !== currentPosition) return;
    }
    if (accuracyEvalPending) {
      const ev = evaluation;
      if (ev.depth >= ACCURACY_EVAL_DEPTH) {
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
          if (lastMoveToSquare) {
            const cls = classifyMove(accuracy, accuracy >= 99);
            drawMoveIconOnBoard(lastMoveToSquare, cls);
          }
          log(`Chessist: Move accuracy ${accuracy.toFixed(1)}%`);
        }
        accuracyEvalPending = false;
      }
    }
    updateEval(evaluation);
    chrome.runtime.sendMessage({ type: 'WS_EVAL_UPDATE', evaluation }).catch(() => {});
    if (!evaluation.fromCache && evaluation.pv?.length >= 2 && evaluation.depth >= targetDepth)
      _updatePVPrediction(evaluation);
  }

  // Listen for eval updates from background (WASM fallback path)
  try {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (!extensionContextValid) return;
      try {
        if (message.type === 'EVAL_RESULT' && message.evaluation) {
          handleEvaluationResult(message.evaluation);
        }
      } catch (e) {
        if (e.message?.includes('Extension context invalidated')) { extensionContextValid = false; showRefreshMessage(); }
      }
    });
  } catch (e) {
    log('Chessist: Could not add message listener');
  }

  // ============================================================
  // MOVE EXECUTION (lichess / chessground)
  // ============================================================

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

  function getSquarePixel(surface, square, flipped) {
    const rect = surface.getBoundingClientRect();
    const squareSize = rect.width / 8;
    const { file, rank } = squareToIndices(square);
    let x, y;
    if (flipped) {
      x = rect.left + (7 - file + 0.5) * squareSize;
      y = rect.top + (rank + 0.5) * squareSize;
    } else {
      x = rect.left + (file + 0.5) * squareSize;
      y = rect.top + (7 - rank + 0.5) * squareSize;
    }
    return { x, y };
  }

  function _executeMoveVerified(move, positionKeyBefore) {
    executeMove(move);
    setTimeout(() => {
      const currentKey = currentFen ? currentFen.split(' ').slice(0, 2).join(' ') : null;
      if (currentKey !== positionKeyBefore) return;
      log('Chessist: Move not registered, retrying:', move);
      lastAutoMovePosition = null;
      executeMove(move);
      setTimeout(() => {
        const stillKey = currentFen ? currentFen.split(' ').slice(0, 2).join(' ') : null;
        if (stillKey === positionKeyBefore) {
          log('Chessist: Retry also failed, forcing re-eval');
          lastAutoMovePosition = null;
          if (currentFen) requestEval(currentFen);
        }
      }, 500);
    }, 400);
  }

  function executeMove(move) {
    if (!move || move.length < 4) return false;
    const board = findBoard();
    if (!board) return false;

    const fromSquare = move.substring(0, 2);
    const toSquare = move.substring(2, 4);
    const promotion = move.length > 4 ? move[4] : null;

    log(`Chessist: Auto-moving ${fromSquare} to ${toSquare}${promotion ? ' promoting to ' + promotion : ''}`);

    const surface = getBoardSurface(board);
    const flipped = isFlippedBoard(board);

    // Lichess CSP blocks inline script injection, so use click-to-move directly.
    // Chessground supports: click piece to select → click destination to move.
    const fp = getSquarePixel(surface, fromSquare, flipped);
    const tp = getSquarePixel(surface, toSquare, flipped);

    const fromEl = document.elementFromPoint(fp.x, fp.y) || surface;
    fireClickAt(fromEl, fp.x, fp.y);

    setTimeout(() => {
      const toEl = document.elementFromPoint(tp.x, tp.y) || surface;
      fireClickAt(toEl, tp.x, tp.y);
      if (promotion) setTimeout(() => handlePromotion(promotion), 200);
    }, 120);

    return true;
  }

  // ============================================================
  // BOARD OBSERVATION
  // ============================================================

  function observeBoard(board) {
    if (boardObserver) boardObserver.disconnect();

    const rawFen = extractFEN(board);
    if (rawFen && rawFen !== currentFen) {
      const previousFen = currentFen;
      const isStartPos = rawFen.startsWith('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR');
      const fen = isStartPos ? 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1' : rawFen;
      if (fen === currentFen) return;

      currentFen = fen;
      lastAutoMovePosition = null;

      // LICHESS: detect flip from orientation-black class
      playerColor = isInOwnGame() ? (isFlippedBoard(board) ? 'b' : 'w') : null;

      const fenParts = fen.split(' ');
      if (fenParts.length > 1) currentTurn = fenParts[1];

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

    // Observe cg-board for piece changes (transforms update on moves)
    const cgBoard = getBoardSurface(board);

    boardObserver = new MutationObserver(() => {
      checkForPositionChange(false);
    });

    boardObserver.observe(cgBoard, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class', 'transform']
    });

    // Also observe cg-wrap for orientation changes
    const wrapObserver = new MutationObserver(() => {
      checkForPositionChange(false);
    });
    wrapObserver.observe(board, {
      attributes: true,
      attributeFilter: ['class']
    });

    // Poll fallback — safety net only
    setInterval(() => checkForPositionChange(false), 2000);

    // Mouse release on board (primary trigger)
    cgBoard.addEventListener('mouseup', () => {
      log('Chessist: Mouse released on board');
      setTimeout(() => checkForPositionChange(true), 100);
    });

    cgBoard.addEventListener('click', () => {
      setTimeout(() => checkForPositionChange(false), 300);
    });

    document.addEventListener('keydown', (e) => {
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        setTimeout(() => checkForPositionChange(false), 200);
      }
    });

    // Watch for move list changes (analysis navigation)
    const moveList = document.querySelector('.tview2, .moves');
    if (moveList) {
      const moveObserver = new MutationObserver(() => {
        setTimeout(() => checkForPositionChange(false), (instantMove && autoMove) ? 0 : 100);
      });
      moveObserver.observe(moveList, { childList: true, subtree: true });
    }
  }

  function checkForPositionChange(isMouseRelease = false) {
    clearTimeout(window.evalDebounce);
    const _debounceMs = (instantMove && autoMove) ? 0 : (isMouseRelease ? 50 : 200);
    window.evalDebounce = setTimeout(() => {
      const board = findBoard();
      if (!board) { log('Chessist: No board found'); return; }

      // LICHESS: detect premoves (chessground marks them with class 'premove')
      const cgBoard = getBoardSurface(board);
      const hasPremove = cgBoard.querySelector('piece.premove, square.premove');
      if (hasPremove) { log('Chessist: Premove detected, skipping eval'); return; }

      const newFen = extractFEN(board);
      if (newFen && newFen !== currentFen) {
        clearArrow();

        const isStartingPosition = newFen.startsWith('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR');
        const wasStartingPosition = currentFen?.startsWith('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR');

        let isNewGame = isStartingPosition && !wasStartingPosition && currentFen !== null;

        const currentUrl = location.href;
        const currentGameId = getGameId();
        const lastGameId = lastGameUrl ? lastGameUrl.match(/\/([a-zA-Z0-9]{8})/)?.[1] : null;
        if (currentGameId && lastGameId && currentGameId !== lastGameId) isNewGame = true;
        lastGameUrl = currentUrl;

        if (isNewGame) {
          log('Chessist: New game detected, resetting engine');
          lastAutoMovePosition = null;
          hideCountdown();
          currentBestMove = null;

          const oldGameId = getGameId();
          if (oldGameId) chrome.storage.local.remove(`accuracy_${oldGameId}`).catch(() => {});
          prevCpWhite = null;
          moveAccuracies = [];
          accuracyEvalPending = false;
          if (accuracyEl) { accuracyEl.style.display = 'none'; accuracyEl.innerHTML = ''; }
          clearMoveIcon();

          gameOverHandled = false;
          chrome.storage.local.get(['shouldThrowNextGame', 'shouldWinNextGame']).then(local => {
            shouldThrowThisGame = wlBalance && local.shouldThrowNextGame === true;
            shouldWinThisGame   = wlBalance && local.shouldWinNextGame  === true;
            chrome.storage.local.set({ shouldThrowNextGame: false, shouldWinNextGame: false });
            if (shouldThrowThisGame) log('Chessist: THROW MODE active');
            if (shouldWinThisGame)   log('Chessist: WIN MODE active');

            if (matchElo) {
              const elo = detectPlayerElo();
              if (elo) {
                chrome.storage.local.set({ detectedElo: elo });
                if (extensionContextValid && checkExtensionContext()) {
                  chrome.runtime.sendMessage({ type: 'SET_ELO', elo }).catch(() => {});
                }
              }
            }
          }).catch(() => {});

          if (evalBarFill) evalBarFill.style.setProperty('height', '50%', 'important');
          if (evalScore) { evalScore.textContent = '0.0'; evalScore.className = 'chess-live-eval-score equal'; }
          if (depthEl) depthEl.textContent = '';
          if (bestMoveEl) { bestMoveEl.style.display = 'none'; bestMoveEl.textContent = ''; }

          if (extensionContextValid && checkExtensionContext()) {
            chrome.runtime.sendMessage({ type: 'RESET_ENGINE' }).catch((e) => {
              if (e.message?.includes('Extension context invalidated')) {
                extensionContextValid = false; showRefreshMessage();
              }
            });
          }

          // LICHESS: detect player color from board orientation
          playerColor = isInOwnGame() ? (isFlippedBoard(board) ? 'b' : 'w') : null;
          log('Chessist: New game - player color from orientation:', playerColor);
        }

        const fenForEval = isStartingPosition
          ? 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
          : newFen;

        currentFen = fenForEval;
        const fenParts = fenForEval.split(' ');
        if (fenParts.length > 1) currentTurn = fenParts[1];

        if (!isNewGame) playerColor = detectPlayerColor();
        log('Chessist: Turn:', currentTurn, 'Player:', playerColor || 'spectating');

        if (turnIndicatorEl) {
          const turnText = currentTurn === 'w' ? 'W' : 'B';
          const playerText = playerColor ? (playerColor === 'w' ? 'W' : 'B') : '?';
          const isMyTurn = playerColor && currentTurn === playerColor;
          turnIndicatorEl.textContent = `${turnText}/${playerText}`;
          turnIndicatorEl.className = `chess-live-eval-turn ${isMyTurn ? 'my-turn' : ''}`;
        }

        const isMyTurn = !playerColor || currentTurn === playerColor;

        if (isMyTurn) {
          accuracyEvalPending = false;
          clearMoveIcon();
          const evalDelay = isNewGame ? 500 : 0;
          evalBar?.classList.add('loading');
          setTimeout(() => requestEval(fenForEval, isMouseRelease), evalDelay);
        } else {
          hideCountdown();
          evalBar?.classList.add('loading');
          if (prevCpWhite !== null) {
            accuracyEvalPending = true;

            // LICHESS: detect last move destination from last-move highlighted squares
            lastMoveToSquare = null;
            const boardRect = board.getBoundingClientRect();
            const squareSize = boardRect.width / 8;
            const flipped = isFlippedBoard(board);
            const lastMoveEls = cgBoard.querySelectorAll('square.last-move');

            for (const sqEl of lastMoveEls) {
              const m = sqEl.style.transform.match(/translate\((\d+(?:\.\d+)?)px,\s*(\d+(?:\.\d+)?)px\)/);
              if (!m) continue;
              const xPx = parseFloat(m[1]), yPx = parseFloat(m[2]);

              // Check if a piece is at this square's position
              const hasPieceHere = [...cgBoard.querySelectorAll('piece')].some(p => {
                const pm = p.style.transform.match(/translate\((\d+(?:\.\d+)?)px,\s*(\d+(?:\.\d+)?)px\)/);
                if (!pm) return false;
                return Math.abs(parseFloat(pm[1]) - xPx) < squareSize * 0.3 &&
                       Math.abs(parseFloat(pm[2]) - yPx) < squareSize * 0.3;
              });

              if (hasPieceHere) {
                let fileIdx, rankIdx;
                if (flipped) {
                  fileIdx = 7 - Math.round(xPx / squareSize);
                  rankIdx = Math.round(yPx / squareSize);
                } else {
                  fileIdx = Math.round(xPx / squareSize);
                  rankIdx = 7 - Math.round(yPx / squareSize);
                }
                if (fileIdx >= 0 && fileIdx < 8 && rankIdx >= 0 && rankIdx < 8) {
                  lastMoveToSquare = String.fromCharCode(97 + fileIdx) + (rankIdx + 1);
                  break;
                }
              }
            }
            log('Chessist: Opponent turn - accuracy pending, to square:', lastMoveToSquare);
          }
          requestEval(fenForEval, isMouseRelease);
        }
      }
    }, _debounceMs);
  }

  // ============================================================
  // BUTTON SIMULATION & AUTO-REMATCH (lichess)
  // ============================================================

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

  let autoRematchPending = false;
  function checkAutoRematch() {
    if (autoRematchPending) return;

    // Lichess rematch/new game buttons
    const rematchBtn = document.querySelector('.rematch-buttons a.button, .rematch-buttons .button, a.rematch, button.rematch');
    const newGameBtn = document.querySelector('.new-opponent, a.new-opponent, .play-again, a[href="/"]');

    let targetBtn = null, btnName = '';
    if (autoRematch && rematchBtn) { targetBtn = rematchBtn; btnName = 'Rematch'; }
    else if (autoNewGame && newGameBtn) { targetBtn = newGameBtn; btnName = 'New Game'; }

    if (targetBtn) {
      autoRematchPending = true;
      const delay = 1000 + Math.floor(Math.random() * 2000);
      log('Chessist: Game over detected, clicking', btnName, 'in', delay, 'ms');

      setTimeout(() => {
        // Re-verify the button still exists
        const rematch2 = document.querySelector('.rematch-buttons a.button, .rematch-buttons .button, a.rematch, button.rematch');
        const newGame2 = document.querySelector('.new-opponent, a.new-opponent, .play-again');
        let btn = null;
        if (autoRematch) btn = rematch2;
        if (!btn && autoNewGame) btn = newGame2;
        if (btn) {
          simulateButtonClick(btn);
          log('Chessist: Clicked', btnName);
          setTimeout(() => checkForPositionChange(false), 1000);
          setTimeout(() => checkForPositionChange(false), 2000);
        }
        autoRematchPending = false;
      }, delay);
    }
  }

  // ============================================================
  // INITIALIZATION
  // ============================================================

  async function init() {
    await loadSettings();
    if (!isEnabled) return;

    await restoreAccuracyState();

    if (extensionContextValid && checkExtensionContext()) {
      try {
        await chrome.runtime.sendMessage({ type: 'RESET_ENGINE' });
        log('Chessist: Engine reset on page load');
      } catch (e) {
        if (e.message?.includes('Extension context invalidated')) extensionContextValid = false;
      }
    }

    const checkForBoard = () => {
      const board = findBoard();
      if (board) {
        createEvalBar(board);
        observeBoard(board);
      } else {
        setTimeout(checkForBoard, 500);
      }
    };

    checkForBoard();
    watchForGameOver();

    if (matchElo) {
      setTimeout(() => {
        const elo = detectPlayerElo();
        if (elo && extensionContextValid && checkExtensionContext()) {
          chrome.storage.local.set({ detectedElo: elo });
          chrome.runtime.sendMessage({ type: 'SET_ELO', elo }).catch(() => {});
        }
      }, 2000);
    }

    // Lichess is a SPA - observe for navigation
    const pageObserver = new MutationObserver(() => {
      const board = findBoard();
      if (board) {
        if (evalBar && !evalBar.isConnected) {
          log('Chessist: Eval bar orphaned, re-creating');
          evalBar = null; evalBarFill = null; evalScore = null;
          bestMoveEl = null; countdownEl = null; depthEl = null;
          turnIndicatorEl = null; arrowOverlay = null; currentBestMove = null;
          accuracyEl = null;
        }
        if (!evalBar) {
          createEvalBar(board);
          observeBoard(board);
        }
      }

      if (autoRematch || autoNewGame) checkAutoRematch();
    });

    pageObserver.observe(document.body, { childList: true, subtree: true });
  }

  // ============================================================
  // SETTINGS MESSAGE HANDLER (unchanged from chess.com)
  // ============================================================

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
          }
        } else if (message.type === 'SETTINGS_UPDATED') {
          if (message.showBestMove !== undefined) {
            showBestMove = message.showBestMove;
            if (bestMoveEl) bestMoveEl.style.display = showBestMove ? 'block' : 'none';
            if (!showBestMove) clearArrow();
          }
          if (message.showOpponentBestMove !== undefined) {
            showOpponentBestMove = message.showOpponentBestMove;
            if (!showOpponentBestMove) clearArrow();
          }
          if (message.showAltArrows !== undefined) {
            showAltArrows = message.showAltArrows;
            clearArrow(); // redraw will happen on next eval
          }
          if (message.showMoveIcon !== undefined) { showMoveIcon = message.showMoveIcon; if (!showMoveIcon) clearMoveIcon(); }
          if (message.autoMove !== undefined) { autoMove = message.autoMove; if (autoMove) lastAutoMovePosition = null; }
          if (message.playerColor !== undefined) { manualPlayerColor = message.playerColor; playerColor = detectPlayerColor(); }
          if (message.engineDepth !== undefined) {
            targetDepth = message.engineDepth;
            if (currentFen && isEnabled) { evalBar?.classList.add('loading'); requestEval(currentFen); }
          }
          if (message.stealthMode !== undefined) stealthMode = message.stealthMode;
          if (message.instantMove !== undefined) instantMove = message.instantMove;
          if (message.smartTiming !== undefined) smartTiming = message.smartTiming;
          if (message.autoRematch !== undefined) autoRematch = message.autoRematch;
          if (message.autoNewGame !== undefined) autoNewGame = message.autoNewGame;
          if (message.autoMoveDelayMin !== undefined) autoMoveDelayMin = message.autoMoveDelayMin;
          if (message.autoMoveDelayMax !== undefined) autoMoveDelayMax = message.autoMoveDelayMax;
          if (message.skillLevel !== undefined) skillLevel = message.skillLevel;
          if (message.targetAccuracy !== undefined) targetAccuracy = message.targetAccuracy;
          if (message.wlBalance !== undefined) { wlBalance = message.wlBalance; if (!wlBalance) { shouldThrowThisGame = false; shouldWinThisGame = false; } }
          if (message.maxConsecutiveWins !== undefined) maxConsecutiveWins = message.maxConsecutiveWins;
          if (message.maxConsecutiveLosses !== undefined) maxConsecutiveLosses = message.maxConsecutiveLosses;
          if (message.throwRandom !== undefined) throwRandom = message.throwRandom;
          if (message.lossRandom !== undefined) lossRandom = message.lossRandom;
          if (message.matchElo !== undefined) {
            matchElo = message.matchElo;
            if (!matchElo && extensionContextValid && checkExtensionContext()) {
              chrome.runtime.sendMessage({ type: 'SET_ELO', elo: null }).catch(() => {});
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
          if (currentFen && isEnabled) { evalBar?.classList.add('loading'); requestEval(currentFen); }
        } else if (message.type === 'GET_OVERLAY_WS_STATUS') {
          sendResponse({ connected: !!(_overlayWs && _overlayWs.readyState === WebSocket.OPEN) });
          return true;
        }
      } catch (e) {
        if (e.message?.includes('Extension context invalidated')) { extensionContextValid = false; showRefreshMessage(); }
      }
    });
  } catch (e) {
    log('Chessist: Could not add settings listener');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
