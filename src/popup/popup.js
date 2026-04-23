// Chessist - Popup Script

document.addEventListener('DOMContentLoaded', async () => {
  const enableToggle = document.getElementById('enableToggle');
  const showBestMove = document.getElementById('showBestMove');
  const showMoveIconToggle = document.getElementById('showMoveIcon');
  const engineDepth = document.getElementById('engineDepth');
  const depthValue = document.getElementById('depthValue');
  const currentEval = document.getElementById('currentEval');
  const currentDepth = document.getElementById('currentDepth');
  const wasmBtn = document.getElementById('wasmBtn');
  const nativeBtn = document.getElementById('nativeBtn');
  const nativeStatus = document.getElementById('nativeStatus');
  const nativeStatusIcon = document.getElementById('nativeStatusIcon');
  const nativeStatusText = document.getElementById('nativeStatusText');
  const nativeHelp = document.getElementById('nativeHelp');
  const copyIdBtn = document.getElementById('copyIdBtn');
  const extensionIdEl = document.getElementById('extensionId');
  const autoMoveToggle = document.getElementById('autoMove');
  const instantMoveToggle = document.getElementById('instantMove');
  const delayMinInput = document.getElementById('delayMin');
  const delayMaxInput = document.getElementById('delayMax');
  const smartTimingToggle = document.getElementById('smartTiming');
  const skillLevelInput = document.getElementById('skillLevel');
  const skillValueEl = document.getElementById('skillValue');
  const autoRematchToggle = document.getElementById('autoRematch');
  const autoNewGameToggle = document.getElementById('autoNewGame');
  const stealthModeToggle = document.getElementById('stealthMode');
  const colorAutoBtn = document.getElementById('colorAuto');
  const colorWhiteBtn = document.getElementById('colorWhite');
  const colorBlackBtn = document.getElementById('colorBlack');
  const forceRestartBtn = document.getElementById('forceRestartBtn');

  let currentEngineSource = 'wasm';
  let currentPlayerColor = 'auto'; // 'auto', 'w', or 'b'
  let lastReceivedEvaluation = null; // Store last eval to refresh on color change

  // Display the extension ID for native host setup
  const extensionId = chrome.runtime.id;
  extensionIdEl.textContent = extensionId;
  extensionIdEl.title = 'Click to copy extension ID';

  const accToggle = document.getElementById('accToggle');
  const wlBalanceToggle = document.getElementById('wlBalance');
  const wlSettings = document.getElementById('wlSettings');
  const maxConsecutiveWinsInput = document.getElementById('maxConsecutiveWins');
  const maxConsecutiveLossesInput = document.getElementById('maxConsecutiveLosses');
  const throwRndBtn = document.getElementById('throwRndBtn');
  const lossRndBtn = document.getElementById('lossRndBtn');
  const gameHistoryDisplay = document.getElementById('gameHistoryDisplay');
  const throwIndicator = document.getElementById('throwIndicator');
  const winIndicator = document.getElementById('winIndicator');
  const matchEloToggle = document.getElementById('matchElo');
  const eloSettings = document.getElementById('eloSettings');
  const eloStatusText = document.getElementById('eloStatusText');
  const manualEloInput = document.getElementById('manualElo');

  let currentTargetAccuracy = 100; // 100 = off

  // Load current settings
  const settings = await chrome.storage.sync.get([
    'enabled', 'showBestMove', 'showMoveIcon', 'autoMove', 'instantMove', 'smartTiming', 'autoRematch', 'autoNewGame',
    'stealthMode', 'engineDepth', 'engineSource', 'playerColor', 'autoMoveDelayMin', 'autoMoveDelayMax', 'skillLevel',
    'targetAccuracy', 'wlBalance', 'maxConsecutiveWins', 'maxConsecutiveLosses',
    'throwRandom', 'lossRandom', 'matchElo', 'manualElo'
  ]);
  let isEnabled = settings.enabled !== false;
  if (isEnabled) {
    enableToggle.classList.add('active');
    enableToggle.textContent = 'Enabled';
  } else {
    enableToggle.classList.remove('active');
    enableToggle.textContent = 'Disabled';
  }
  showBestMove.checked = settings.showBestMove === true;
  showMoveIconToggle.checked = settings.showMoveIcon === true;
  autoMoveToggle.checked = settings.autoMove === true;
  autoRematchToggle.checked = settings.autoRematch === true;
  autoNewGameToggle.checked = settings.autoNewGame === true;
  stealthModeToggle.checked = settings.stealthMode === true;
  engineDepth.value = settings.engineDepth || 18;
  depthValue.textContent = engineDepth.value;
  currentEngineSource = settings.engineSource || 'wasm';
  currentPlayerColor = settings.playerColor || 'auto';

  // Auto-move settings
  instantMoveToggle.checked = settings.instantMove === true;
  smartTimingToggle.checked = settings.smartTiming !== false; // Default true
  delayMinInput.value = settings.autoMoveDelayMin ?? 0.5;
  delayMaxInput.value = settings.autoMoveDelayMax ?? 2;
  updateInstantModeUI();
  skillLevelInput.value = settings.skillLevel ?? 20;
  skillValueEl.textContent = skillLevelInput.value;

  currentTargetAccuracy = settings.targetAccuracy ?? 100;
  updateAccButtons();

  wlBalanceToggle.checked = settings.wlBalance === true;
  maxConsecutiveWinsInput.value = settings.maxConsecutiveWins ?? 2;
  maxConsecutiveLossesInput.value = settings.maxConsecutiveLosses ?? 3;
  if (settings.throwRandom) throwRndBtn.classList.add('active');
  if (settings.lossRandom) lossRndBtn.classList.add('active');

  matchEloToggle.checked = settings.matchElo === true;
  if (settings.manualElo) manualEloInput.value = settings.manualElo;

  // Load game history + flags from local storage
  const localData = await chrome.storage.local.get(['gameHistory', 'shouldThrowNextGame', 'shouldWinNextGame', 'detectedElo']);
  renderGameHistory(localData.gameHistory || [], localData.shouldThrowNextGame === true, localData.shouldWinNextGame === true);
  if (localData.detectedElo) {
    eloStatusText.textContent = `Detected: ${localData.detectedElo}`;
    eloStatusText.classList.add('detected');
  }


  // Update button states
  updateEngineButtons();
  updateNativeStatusVisibility();
  updateColorButtons();

  // Request last evaluation to show current state
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_LAST_EVAL' });
    if (response?.evaluation) {
      lastReceivedEvaluation = response.evaluation;
      updateEvalDisplay(response.evaluation);
    }
  } catch (e) {
    // Service worker might not have an evaluation yet
  }

  // Toggle enabled state
  enableToggle.addEventListener('click', async () => {
    isEnabled = !isEnabled;
    enableToggle.classList.toggle('active', isEnabled);
    enableToggle.textContent = isEnabled ? 'Enabled' : 'Disabled';
    await chrome.storage.sync.set({ enabled: isEnabled });
    notifyContentScripts({ type: 'TOGGLE_ENABLED', enabled: isEnabled });
  });

  // Toggle best move
  showBestMove.addEventListener('change', async () => {
    await chrome.storage.sync.set({ showBestMove: showBestMove.checked });
    notifyContentScripts({ type: 'SETTINGS_UPDATED', showBestMove: showBestMove.checked });
  });

  // Toggle move icon
  showMoveIconToggle.addEventListener('change', async () => {
    await chrome.storage.sync.set({ showMoveIcon: showMoveIconToggle.checked });
    notifyContentScripts({ type: 'SETTINGS_UPDATED', showMoveIcon: showMoveIconToggle.checked });
  });

  // Toggle auto move
  autoMoveToggle.addEventListener('change', async () => {
    await chrome.storage.sync.set({ autoMove: autoMoveToggle.checked });
    notifyContentScripts({ type: 'SETTINGS_UPDATED', autoMove: autoMoveToggle.checked });
  });

  function updateInstantModeUI() {
    const instant = instantMoveToggle.checked;
    const delaySettings = document.getElementById('delaySettings');
    const smartTimingToggleEl = document.getElementById('smartTimingToggle');
    delayMinInput.disabled = instant;
    delayMaxInput.disabled = instant;
    delaySettings?.classList.toggle('timing-disabled', instant);
    smartTimingToggleEl?.classList.toggle('timing-disabled', instant);
  }

  // Toggle instant move
  instantMoveToggle.addEventListener('change', async () => {
    await chrome.storage.sync.set({ instantMove: instantMoveToggle.checked });
    notifyContentScripts({ type: 'SETTINGS_UPDATED', instantMove: instantMoveToggle.checked });
    updateInstantModeUI();
  });

  // Toggle smart timing
  smartTimingToggle.addEventListener('change', async () => {
    await chrome.storage.sync.set({ smartTiming: smartTimingToggle.checked });
    notifyContentScripts({ type: 'SETTINGS_UPDATED', smartTiming: smartTimingToggle.checked });
  });

  // Auto-move delay settings
  delayMinInput.addEventListener('change', async () => {
    const min = parseFloat(delayMinInput.value) || 0;
    const max = parseFloat(delayMaxInput.value) || 2;
    // Ensure min <= max
    if (min > max) {
      delayMinInput.value = max;
    }
    await chrome.storage.sync.set({ autoMoveDelayMin: parseFloat(delayMinInput.value) });
    notifyContentScripts({
      type: 'SETTINGS_UPDATED',
      autoMoveDelayMin: parseFloat(delayMinInput.value),
      autoMoveDelayMax: max
    });
  });

  delayMaxInput.addEventListener('change', async () => {
    const min = parseFloat(delayMinInput.value) || 0;
    const max = parseFloat(delayMaxInput.value) || 2;
    // Ensure max >= min
    if (max < min) {
      delayMaxInput.value = min;
    }
    await chrome.storage.sync.set({ autoMoveDelayMax: parseFloat(delayMaxInput.value) });
    notifyContentScripts({
      type: 'SETTINGS_UPDATED',
      autoMoveDelayMin: min,
      autoMoveDelayMax: parseFloat(delayMaxInput.value)
    });
  });

  // Skill level slider
  skillLevelInput.addEventListener('input', () => {
    skillValueEl.textContent = skillLevelInput.value;
  });

  skillLevelInput.addEventListener('change', async () => {
    const level = parseInt(skillLevelInput.value);
    await chrome.storage.sync.set({ skillLevel: level });
    // Send to service worker to update native engine's Skill Level UCI option
    try {
      await chrome.runtime.sendMessage({ type: 'SET_SKILL_LEVEL', level: level });
    } catch (e) {
      // Service worker might not be ready
    }
    notifyContentScripts({ type: 'SETTINGS_UPDATED', skillLevel: level });
  });

  // Accuracy target buttons
  accToggle.addEventListener('click', async (e) => {
    const btn = e.target.closest('.acc-btn');
    if (!btn) return;
    currentTargetAccuracy = parseInt(btn.dataset.acc);
    updateAccButtons();
    await chrome.storage.sync.set({ targetAccuracy: currentTargetAccuracy });
    notifyContentScripts({ type: 'SETTINGS_UPDATED', targetAccuracy: currentTargetAccuracy });
  });

  function updateAccButtons() {
    accToggle.querySelectorAll('.acc-btn').forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.acc) === currentTargetAccuracy);
    });
  }

  // W/L Balance toggle
  wlBalanceToggle.addEventListener('change', async () => {
    await chrome.storage.sync.set({ wlBalance: wlBalanceToggle.checked });
    notifyContentScripts({ type: 'SETTINGS_UPDATED', wlBalance: wlBalanceToggle.checked });
  });

  // Max consecutive wins input
  maxConsecutiveWinsInput.addEventListener('change', async () => {
    const val = Math.max(1, Math.min(10, parseInt(maxConsecutiveWinsInput.value) || 2));
    maxConsecutiveWinsInput.value = val;
    await chrome.storage.sync.set({ maxConsecutiveWins: val });
    notifyContentScripts({ type: 'SETTINGS_UPDATED', maxConsecutiveWins: val });
  });

  // Throw random toggle
  throwRndBtn.addEventListener('click', async () => {
    throwRndBtn.classList.toggle('active');
    const rnd = throwRndBtn.classList.contains('active');
    await chrome.storage.sync.set({ throwRandom: rnd });
    notifyContentScripts({ type: 'SETTINGS_UPDATED', throwRandom: rnd });
  });

  // Max consecutive losses input
  maxConsecutiveLossesInput.addEventListener('change', async () => {
    const val = Math.max(1, Math.min(10, parseInt(maxConsecutiveLossesInput.value) || 3));
    maxConsecutiveLossesInput.value = val;
    await chrome.storage.sync.set({ maxConsecutiveLosses: val });
    notifyContentScripts({ type: 'SETTINGS_UPDATED', maxConsecutiveLosses: val });
  });

  // Loss random toggle
  lossRndBtn.addEventListener('click', async () => {
    lossRndBtn.classList.toggle('active');
    const rnd = lossRndBtn.classList.contains('active');
    await chrome.storage.sync.set({ lossRandom: rnd });
    notifyContentScripts({ type: 'SETTINGS_UPDATED', lossRandom: rnd });
  });

  // Match ELO toggle
  matchEloToggle.addEventListener('change', async () => {
    await chrome.storage.sync.set({ matchElo: matchEloToggle.checked });
    notifyContentScripts({ type: 'SETTINGS_UPDATED', matchElo: matchEloToggle.checked });
    if (!matchEloToggle.checked) {
      await chrome.storage.local.remove('detectedElo');
      eloStatusText.textContent = 'Auto-detect from Chess.com';
      eloStatusText.classList.remove('detected');
    }
  });

  // Manual ELO override
  manualEloInput.addEventListener('change', async () => {
    const val = manualEloInput.value ? parseInt(manualEloInput.value) : null;
    await chrome.storage.sync.set({ manualElo: val });
    notifyContentScripts({ type: 'SETTINGS_UPDATED', manualElo: val });
  });

  // Render game history dots
  function renderGameHistory(history, shouldThrow, shouldWin) {
    gameHistoryDisplay.innerHTML = '';
    const last10 = history.slice(-10);
    for (const r of last10) {
      const dot = document.createElement('div');
      dot.className = `history-dot ${r === 'w' ? 'win' : r === 'l' ? 'loss' : 'draw'}`;
      dot.title = r === 'w' ? 'Win' : r === 'l' ? 'Loss' : 'Draw';
      gameHistoryDisplay.appendChild(dot);
    }
    throwIndicator.classList.toggle('hidden', !shouldThrow);
    winIndicator.classList.toggle('hidden', !shouldWin);
  }

  // Refresh game history when popup opens (storage may have updated)
  chrome.storage.local.onChanged.addListener((changes) => {
    if (changes.gameHistory || changes.shouldThrowNextGame || changes.shouldWinNextGame || changes.detectedElo) {
      chrome.storage.local.get(['gameHistory', 'shouldThrowNextGame', 'shouldWinNextGame', 'detectedElo'], (data) => {
        renderGameHistory(data.gameHistory || [], data.shouldThrowNextGame === true, data.shouldWinNextGame === true);
        if (data.detectedElo) {
          eloStatusText.textContent = `Detected: ${data.detectedElo}`;
          eloStatusText.classList.add('detected');
        }
      });
    }
  });

  // Toggle auto rematch (mutually exclusive with auto new game)
  autoRematchToggle.addEventListener('change', async () => {
    if (autoRematchToggle.checked) {
      autoNewGameToggle.checked = false;
      await chrome.storage.sync.set({ autoRematch: true, autoNewGame: false });
      notifyContentScripts({ type: 'SETTINGS_UPDATED', autoRematch: true, autoNewGame: false });
    } else {
      await chrome.storage.sync.set({ autoRematch: false });
      notifyContentScripts({ type: 'SETTINGS_UPDATED', autoRematch: false });
    }
  });

  // Toggle auto new game (mutually exclusive with auto rematch)
  autoNewGameToggle.addEventListener('change', async () => {
    if (autoNewGameToggle.checked) {
      autoRematchToggle.checked = false;
      await chrome.storage.sync.set({ autoNewGame: true, autoRematch: false });
      notifyContentScripts({ type: 'SETTINGS_UPDATED', autoNewGame: true, autoRematch: false });
    } else {
      await chrome.storage.sync.set({ autoNewGame: false });
      notifyContentScripts({ type: 'SETTINGS_UPDATED', autoNewGame: false });
    }
  });

  // Toggle stealth mode
  stealthModeToggle.addEventListener('change', async () => {
    await chrome.storage.sync.set({ stealthMode: stealthModeToggle.checked });
    notifyContentScripts({ type: 'SETTINGS_UPDATED', stealthMode: stealthModeToggle.checked });
  });

  // Engine depth slider
  engineDepth.addEventListener('input', () => {
    depthValue.textContent = engineDepth.value;
  });

  engineDepth.addEventListener('change', async () => {
    const newDepth = parseInt(engineDepth.value);
    await chrome.storage.sync.set({ engineDepth: newDepth });
    // Notify offscreen document
    try {
      await chrome.runtime.sendMessage({
        type: 'SET_DEPTH',
        depth: newDepth
      });
    } catch (e) {
      // Offscreen document might not be running
    }
    // Notify content scripts to update their target depth and re-evaluate
    notifyContentScripts({ type: 'SETTINGS_UPDATED', engineDepth: newDepth });
  });

  // Engine button clicks
  wasmBtn.addEventListener('click', () => selectEngine('wasm'));
  nativeBtn.addEventListener('click', () => selectEngine('native'));

  // Player color button clicks
  colorAutoBtn.addEventListener('click', () => selectPlayerColor('auto'));
  colorWhiteBtn.addEventListener('click', () => selectPlayerColor('w'));
  colorBlackBtn.addEventListener('click', () => selectPlayerColor('b'));

  async function selectPlayerColor(color) {
    currentPlayerColor = color;
    await chrome.storage.sync.set({ playerColor: color });
    updateColorButtons();
    notifyContentScripts({ type: 'SETTINGS_UPDATED', playerColor: color });
    // Refresh eval display with new perspective
    if (lastReceivedEvaluation) {
      updateEvalDisplay(lastReceivedEvaluation);
    }
  }

  function updateColorButtons() {
    colorAutoBtn.classList.toggle('active', currentPlayerColor === 'auto');
    colorWhiteBtn.classList.toggle('active', currentPlayerColor === 'w');
    colorBlackBtn.classList.toggle('active', currentPlayerColor === 'b');
  }

  // Copy extension ID button
  copyIdBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(extensionId);
      copyIdBtn.classList.add('copied');
      const originalText = extensionIdEl.textContent;
      extensionIdEl.textContent = 'Copied!';
      setTimeout(() => {
        copyIdBtn.classList.remove('copied');
        extensionIdEl.textContent = originalText;
      }, 1500);
    } catch (e) {
      // Fallback: select the text
      extensionIdEl.select?.();
    }
  });

  // Force restart engine button
  forceRestartBtn.addEventListener('click', async () => {
    forceRestartBtn.disabled = true;
    forceRestartBtn.textContent = 'Restarting...';

    try {
      const response = await chrome.runtime.sendMessage({ type: 'FORCE_RESTART_ENGINE' });
      console.log('Force restart response:', response);

      // Wait a moment, then update status and trigger re-evaluation
      setTimeout(async () => {
        forceRestartBtn.textContent = 'Force Restart Engine';
        forceRestartBtn.disabled = false;

        // Update native status if using native engine
        if (currentEngineSource === 'native') {
          await checkNativeStatus();
        }

        // Trigger re-evaluation on active Chess.com tabs
        notifyContentScripts({ type: 'RE_EVALUATE' });
      }, 1500);
    } catch (e) {
      console.error('Force restart failed:', e);
      forceRestartBtn.textContent = 'Restart Failed';
      setTimeout(() => {
        forceRestartBtn.textContent = 'Force Restart Engine';
        forceRestartBtn.disabled = false;
      }, 2000);
    }
  });

  async function selectEngine(source) {
    currentEngineSource = source;
    await chrome.storage.sync.set({ engineSource: source });
    updateEngineButtons();

    // Show native status panel immediately (but don't check status yet)
    if (source === 'native') {
      nativeStatus.classList.remove('hidden');
      nativeHelp.classList.remove('hidden');
      // Show "Connecting..." state
      nativeStatusIcon.textContent = '⏳';
      nativeStatusText.textContent = 'Connecting...';
      nativeStatus.classList.remove('connected', 'error');
    } else {
      nativeStatus.classList.add('hidden');
      nativeHelp.classList.add('hidden');
    }

    // Notify service worker to switch engine
    try {
      await chrome.runtime.sendMessage({
        type: 'SET_ENGINE_SOURCE',
        source: source
      });

      // Wait for engine to connect, then check status and trigger re-evaluation
      if (source === 'native') {
        // Wait for native connection before checking status
        setTimeout(async () => {
          await checkNativeStatus();
          const status = await chrome.runtime.sendMessage({ type: 'CHECK_NATIVE_STATUS' });
          if (status?.connected) {
            notifyContentScripts({ type: 'RE_EVALUATE' });
          }
        }, 1000);
      } else {
        // WASM is always ready, trigger re-evaluation immediately
        notifyContentScripts({ type: 'RE_EVALUATE' });
      }
    } catch (e) {
      console.error('Failed to set engine source:', e);
    }
  }

  // Update button active states
  function updateEngineButtons() {
    if (currentEngineSource === 'wasm') {
      wasmBtn.classList.add('active');
      nativeBtn.classList.remove('active');
    } else {
      wasmBtn.classList.remove('active');
      nativeBtn.classList.add('active');
    }
  }

  // Update native status visibility based on selected engine
  // Called on initial load - selectEngine handles its own status checking
  function updateNativeStatusVisibility() {
    if (currentEngineSource === 'native') {
      nativeStatus.classList.remove('hidden');
      nativeHelp.classList.remove('hidden');
      // Check status (for initial popup load, engine should already be connected)
      checkNativeStatus();
    } else {
      nativeStatus.classList.add('hidden');
      nativeHelp.classList.add('hidden');
    }
  }

  // Check native Stockfish connection status
  async function checkNativeStatus() {
    nativeStatusIcon.textContent = '⏳';
    nativeStatusText.textContent = 'Connecting...';
    nativeStatus.classList.remove('connected', 'error');

    try {
      const response = await chrome.runtime.sendMessage({ type: 'CHECK_NATIVE_STATUS' });
      if (response && response.connected) {
        nativeStatus.classList.remove('error');
        nativeStatus.classList.add('connected');
        nativeStatusIcon.textContent = '✓';
        nativeStatusText.textContent = `Connected: ${response.path || 'Stockfish'}`;
        nativeHelp.classList.add('hidden');
      } else {
        nativeStatus.classList.remove('connected');
        nativeStatus.classList.add('error');
        nativeStatusIcon.textContent = '✗';
        nativeStatusText.textContent = response?.error || 'Not connected';
        nativeHelp.classList.remove('hidden');
      }
    } catch (e) {
      nativeStatus.classList.remove('connected');
      nativeStatus.classList.add('error');
      nativeStatusIcon.textContent = '✗';
      nativeStatusText.textContent = 'Not connected';
      nativeHelp.classList.remove('hidden');
    }
  }

  // Notify content scripts helper
  async function notifyContentScripts(message) {
    const [chessTabs, lichessTabs] = await Promise.all([
      chrome.tabs.query({ url: 'https://www.chess.com/*' }),
      chrome.tabs.query({ url: 'https://lichess.org/*' })
    ]);
    const tabs = [...chessTabs, ...lichessTabs];
    for (const tab of tabs) {
      try {
        await chrome.tabs.sendMessage(tab.id, message);
      } catch (e) {
        // Tab might not have content script
      }
    }
  }

  // Listen for eval updates and engine source changes
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'EVAL_RESULT' && message.evaluation) {
      lastReceivedEvaluation = message.evaluation;
      updateEvalDisplay(message.evaluation);
    }
    // Handle auto-fallback from native to WASM (e.g., Opera browser)
    if (message.type === 'ENGINE_SOURCE_CHANGED') {
      currentEngineSource = message.source;
      updateEngineButtons();
      updateNativeStatusVisibility();
      if (message.source === 'wasm') {
        // Show brief notification that we fell back
        nativeStatus.classList.remove('hidden', 'connected');
        nativeStatus.classList.add('error');
        nativeStatusIcon.textContent = '⚠';
        nativeStatusText.textContent = 'Native not supported, using built-in engine';
        setTimeout(() => {
          nativeStatus.classList.add('hidden');
        }, 3000);
      }
    }
  });

  // Update eval display
  function updateEvalDisplay(evaluation) {
    let displayText;
    let depthText = '';
    let className = '';

    // Step 1: Normalize to white's perspective (positive = white winning)
    // Stockfish gives score from side-to-move's perspective
    const isBlackToMove = evaluation.turn === 'b';
    let normalizedMate = evaluation.mate;
    let normalizedCp = evaluation.cp || 0;

    if (isBlackToMove) {
      // Flip to white's perspective
      if (normalizedMate !== undefined) {
        normalizedMate = -normalizedMate;
      }
      normalizedCp = -normalizedCp;
    }

    // Step 2: Flip to player's perspective if playing as black
    // (currentPlayerColor is 'auto', 'w', or 'b')
    const viewFromBlack = currentPlayerColor === 'b';
    let displayMate = normalizedMate;
    let displayCp = normalizedCp;

    if (viewFromBlack) {
      if (displayMate !== undefined) {
        displayMate = -displayMate;
      }
      displayCp = -displayCp;
    }

    if (displayMate !== undefined) {
      displayText = displayMate > 0 ? `M${displayMate}` : `-M${Math.abs(displayMate)}`;
      className = displayMate > 0 ? 'positive' : 'negative';
    } else if (displayCp !== undefined) {
      const pawns = displayCp / 100;
      if (pawns > 0) {
        displayText = `+${pawns.toFixed(1)}`;
        className = 'positive';
      } else if (pawns < 0) {
        displayText = pawns.toFixed(1);
        className = 'negative';
      } else {
        displayText = '0.0';
      }
    }

    if (evaluation.depth) {
      depthText = `Depth ${evaluation.depth}`;
    }

    if (displayText) {
      currentEval.textContent = displayText;
      currentEval.className = `eval-value ${className}`;
    }

    if (depthText) {
      currentDepth.textContent = depthText;
    }
  }
});
