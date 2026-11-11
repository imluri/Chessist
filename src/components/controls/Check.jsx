// Custom checkbox — square, sharp-cornered, accent fill + checkmark when on.
export default function Check({ checked, onChange, disabled = false, label }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-label={label}
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      style={{
        width: 18, height: 18, flexShrink: 0, padding: 0, borderRadius: 5,
        border: `1px solid ${checked ? 'rgb(var(--accent))' : 'rgb(var(--border))'}`,
        background: checked ? 'rgb(var(--accent))' : 'transparent',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.4 : 1,
        transition: 'background-color 140ms ease, border-color 140ms ease',
      }}
    >
      {checked && (
        <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2.5 6.4l2.4 2.4 4.6-5.2" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  )
}
