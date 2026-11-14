import './PerformanceResults.css'

function formatTime(ms) {
  if (!Number.isFinite(ms)) return '—'
  return `${ms.toFixed(ms < 1 ? 3 : ms < 10 ? 2 : 1)} ms`
}

export default function PerformanceResults({ result }) {
  const { local, stockfish, display, warnings } = result
  const fixedDepth = stockfish?.depth
  const rows = [
    ['Local connection round trip', local],
    ['Stockfish first evaluation', stockfish?.first],
    [fixedDepth ? `Stockfish depth ${fixedDepth}` : 'Stockfish fixed depth', stockfish?.fixed],
    ['Desktop update · foreground', display?.foreground],
    ['Desktop update · background', display?.background],
  ]

  return (
    <div className="performance-results">
      <table className="performance-results-table">
        <caption>Performance check results</caption>
        <thead>
          <tr>
            <th scope="col">Measurement</th>
            <th scope="col">Median</th>
            <th scope="col">95th percentile</th>
            <th scope="col">Samples</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, timing]) => (
            <tr key={label}>
              <th scope="row">{label}</th>
              {timing ? <>
                <td>{formatTime(timing.median)}</td>
                <td>{formatTime(timing.p95)}</td>
                <td>{timing.samples}</td>
              </> : <td className="performance-unavailable" colSpan={3}>Not measured</td>}
            </tr>
          ))}
        </tbody>
      </table>
      <p>Lower is faster. The 95th percentile shows the slower end of the samples.</p>
      <p>Desktop timings measure a test update from the app process through a renderer paint cycle. These results exclude browser extension scheduling, move handling, and site processing.</p>
      {!!warnings?.length && <ul aria-label="Measurement notes">
        {warnings.map((warning, index) => <li key={index}>{warning}</li>)}
      </ul>}
    </div>
  )
}
