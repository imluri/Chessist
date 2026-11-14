const dot = document.getElementById('dot')
const status = document.getElementById('status')
const hint = document.getElementById('hint')

const engineStatus = {
  starting: ['waiting', 'Stockfish is starting', 'The Chessist app is connected. Analysis will start when Stockfish is ready.'],
  retrying: ['waiting', 'Stockfish is restarting', 'Check the Setup tab in Chessist for details.'],
  downloading: ['waiting', 'Downloading Stockfish', 'Check the Setup tab in Chessist for download progress.'],
  ready: ['ok', 'Stockfish is ready', 'Open a board on Chess.com or Lichess to start analysis.'],
  error: ['off', 'Stockfish is unavailable', 'Open the Setup tab in Chessist to see the error and retry.'],
}
const appOffline = ['off', 'Can’t reach the Chessist app', 'Open the Chessist desktop app and check again.']
const engineUnknown = ['waiting', 'Chessist app connected', 'Check the Setup tab in Chessist for Stockfish status.']

function check() {
  let settled = false
  let connected = false
  let ws
  let timeout = setTimeout(noReply, 1500)

  function finish([state, label, detail]) {
    if (settled) return
    settled = true
    clearTimeout(timeout)
    try { ws?.close() } catch {}
    dot.className = `dot ${state}`
    status.textContent = label
    hint.textContent = detail
    setTimeout(check, 2000)
  }

  function noReply() { finish(connected ? engineUnknown : appOffline) }

  try { ws = new WebSocket('ws://127.0.0.1:27301') } catch { return noReply() }
  ws.onopen = () => {
    if (settled) return
    connected = true
    clearTimeout(timeout)
    timeout = setTimeout(noReply, 750)
    try { ws.send(JSON.stringify({ type: 'get_status' })) } catch { noReply() }
  }
  ws.onmessage = ({ data }) => {
    try {
      const msg = JSON.parse(data)
      if (msg?.type === 'app_status' && Object.hasOwn(engineStatus, msg.stockfishState)) {
        finish(engineStatus[msg.stockfishState])
      }
    } catch {}
  }
  ws.onerror = noReply
  ws.onclose = noReply
}

check()
