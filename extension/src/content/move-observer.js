(() => {
  const movePattern = /^(?:[a-h][1-8]){2}[qrbn]?$/;
  const files = 'abcdefgh';

  function readPlacement(fen) {
    if (typeof fen !== 'string') return null;
    const ranks = fen.split(' ')[0].split('/');
    if (ranks.length !== 8) return null;
    const board = [];
    for (const rank of ranks) {
      const row = [];
      for (const token of rank) {
        if (/^[1-8]$/.test(token)) row.push(...Array(Number(token)).fill('.'));
        else if (/^[prnbqkPRNBQK]$/.test(token)) row.push(token);
        else return null;
      }
      if (row.length !== 8) return null;
      board.push(...row);
    }
    if (board.filter(piece => piece === 'K').length !== 1 || board.filter(piece => piece === 'k').length !== 1) return null;
    return board;
  }

  function squareIndex(square) {
    return (8 - Number(square[1])) * 8 + files.indexOf(square[0]);
  }

  // Build the placement to compare with the observed board. This never
  // sends input and does not determine whether a move is legal.
  function expectedPlacement(before, move) {
    const board = before.slice();
    const from = squareIndex(move.slice(0, 2));
    const to = squareIndex(move.slice(2, 4));
    const piece = board[from];
    const target = board[to];
    if (from === to || piece === '.') return null;
    const white = piece === piece.toUpperCase();
    if (target !== '.' && (target === target.toUpperCase()) === white) return null;
    const fileDelta = to % 8 - from % 8;

    if (piece.toLowerCase() === 'k' && Math.abs(fileDelta) === 2) {
      const home = white ? 56 : 0;
      if (from !== home + 4 || to !== home + (fileDelta > 0 ? 6 : 2)) return null;
      const rookFrom = home + (fileDelta > 0 ? 7 : 0);
      const rookTo = home + (fileDelta > 0 ? 5 : 3);
      if (board[rookFrom] !== (white ? 'R' : 'r') || board[rookTo] !== '.' || target !== '.') return null;
      board[rookTo] = board[rookFrom];
      board[rookFrom] = '.';
    }
    if (piece.toLowerCase() === 'p' && Math.abs(fileDelta) === 1 && target === '.') {
      const captured = to + (white ? 8 : -8);
      if (board[captured] !== (white ? 'p' : 'P')) return null;
      board[captured] = '.';
    }

    const promotion = move[4];
    if (promotion && (piece.toLowerCase() !== 'p' || Math.floor(to / 8) !== (white ? 0 : 7))) return null;
    board[to] = promotion ? (white ? promotion.toUpperCase() : promotion) : piece;
    board[from] = '.';
    return board.join('');
  }

  function create({ read, report, timeoutMs = 1500 }) {
    let pending = null;

    function emit(move, state) {
      try { report({ move, state }); } catch { /* Status delivery is best effort. */ }
    }

    function finish(attempt, state) {
      if (pending !== attempt) return;
      clearTimeout(attempt.timer);
      pending = null;
      emit(attempt.move, state);
    }

    function readBoard() {
      try { return read(); } catch { return null; }
    }

    function observe(final = false) {
      const attempt = pending;
      if (!attempt) return;
      const snapshot = readBoard();
      if (snapshot?.context != null && snapshot.context !== attempt.context) {
        finish(attempt, 'unverified');
        return;
      }
      const observed = snapshot?.context === attempt.context ? readPlacement(snapshot.fen)?.join('') : null;
      if (observed && observed === attempt.expected) {
        finish(attempt, 'confirmed');
      } else if (final) {
        if (observed && observed !== attempt.before) finish(attempt, attempt.expected ? 'changed' : 'unverified');
        else if (attempt.failed) finish(attempt, 'dispatch_error');
        else finish(attempt, observed && attempt.baselineMatches && attempt.sent ? 'unchanged' : 'unverified');
      }
    }

    return {
      begin({ move, before, context }) {
        const board = readPlacement(before);
        if (typeof move !== 'string' || !movePattern.test(move) || !board || context == null) return null;
        if (pending) finish(pending, 'unverified');
        const placement = board.join('');
        const snapshot = readBoard();
        const baselineMatches = snapshot?.context === context && readPlacement(snapshot.fen)?.join('') === placement;
        const attempt = {
          move, before: placement, context, baselineMatches,
          expected: baselineMatches ? expectedPlacement(board, move) : null,
        };
        pending = attempt;
        attempt.timer = setTimeout(() => observe(true), timeoutMs);
        emit(move, 'sending');
        return attempt;
      },
      sent(attempt, error) {
        if (!attempt || pending !== attempt) return;
        attempt.sent = true;
        attempt.failed = !!error;
        observe();
      },
      observe() { observe(); },
      reset() {
        if (pending) finish(pending, 'unverified');
      },
    };
  }

  globalThis.ChessistMoveObserver = { create };
})();
