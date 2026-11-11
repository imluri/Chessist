// Custom slider — native range styled via .cslider (see index.css) with an
// accent-filled track up to the thumb and a square thumb.
export default function Slider({ value, min = 0, max = 100, step = 1, onChange, disabled = false, label }) {
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0
  const fill = disabled ? 'rgb(var(--fg-dim))' : 'rgb(var(--accent))'
  return (
    <input
      type="range"
      aria-label={label}
      className="cslider"
      min={min}
      max={max}
      step={step}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(Number(e.target.value))}
      style={{
        width: '100%',
        background: `linear-gradient(to right, ${fill} 0%, ${fill} ${pct}%, rgb(var(--surface)) ${pct}%, rgb(var(--surface)) 100%)`,
        opacity: disabled ? 0.55 : 1,
      }}
    />
  )
}
