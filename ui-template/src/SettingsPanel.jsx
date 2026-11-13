import React, { useId, useRef } from 'react'

function SettingField({ field, value, onChange }) {
  const id = useId()
  const labelId = `${id}-label`
  const descriptionId = field.description ? `${id}-description` : undefined
  const isRadio = field.type === 'radio'
  const inputProps = { id, disabled: field.disabled, 'aria-describedby': descriptionId }
  const options = field.options ?? []

  let control
  switch (field.type) {
    case 'radio':
      control = (
        <div className="setting-radio-options" role="radiogroup"
          aria-labelledby={labelId} aria-describedby={descriptionId}>
          {options.map((option, index) => {
            const optionId = `${id}-option-${index}`
            const optionLabelId = `${optionId}-label`
            const optionDescriptionId = option.description ? `${optionId}-description` : undefined
            return (
              <label className="setting-radio-option" key={option.value} data-option={option.value}>
                <input className="setting-radio-input" type="radio" name={id}
                  value={option.value} checked={Object.is(value, option.value)}
                  disabled={field.disabled} aria-labelledby={optionLabelId} aria-describedby={optionDescriptionId}
                  onChange={() => onChange(option.value)} />
                <span className="setting-radio-copy">
                  <span className="setting-radio-label" id={optionLabelId}>{option.label}</span>
                  {option.description && <span className="setting-radio-description" id={optionDescriptionId}>
                    {option.description}
                  </span>}
                </span>
              </label>
            )
          })}
        </div>
      )
      break
    case 'select': {
      const selectedIndex = options.findIndex(option => Object.is(option.value, value))
      control = (
        <select className="setting-input setting-select" {...inputProps} value={selectedIndex < 0 ? '' : selectedIndex}
          onChange={event => onChange(options[Number(event.target.value)].value)}>
          {selectedIndex < 0 && <option value="" disabled>{field.placeholder ?? 'Choose an option'}</option>}
          {options.map((option, index) => <option key={option.value} value={index}>{option.label}</option>)}
        </select>
      )
      break
    }
    case 'switch':
      control = (
        <label className="setting-switch">
          <input className="setting-switch-input" {...inputProps} type="checkbox" role="switch"
            checked={Boolean(value)} onChange={event => onChange(event.target.checked)} />
          <span className="setting-switch-track" aria-hidden="true" />
        </label>
      )
      break
    case 'checkbox':
      control = <input className="setting-checkbox" {...inputProps} type="checkbox"
        checked={Boolean(value)} onChange={event => onChange(event.target.checked)} />
      break
    case 'range': {
      const current = value ?? field.min ?? 0
      const formatted = field.formatValue ? field.formatValue(current) : current
      control = (
        <div className="setting-range-control">
          <input className="setting-range" {...inputProps} type="range"
            min={field.min} max={field.max} step={field.step} value={current}
            aria-valuetext={field.formatValue ? String(formatted) : undefined}
            onChange={event => onChange(event.target.valueAsNumber)} />
          <span className="setting-value" aria-hidden="true">{formatted}</span>
        </div>
      )
      break
    }
    case 'number':
      control = <input className="setting-input setting-number" {...inputProps} type="number"
        min={field.min} max={field.max} step={field.step} value={value ?? ''} placeholder={field.placeholder}
        onChange={event => onChange(event.target.value === '' ? '' : event.target.valueAsNumber)} />
      break
    case 'text':
    default:
      control = <input className="setting-input setting-text" {...inputProps} type="text"
        value={value ?? ''} placeholder={field.placeholder} onChange={event => onChange(event.target.value)} />
  }

  return (
    <div className={`setting-field setting-field--${field.type}`} data-field={field.id}>
      <div className="setting-copy">
        {isRadio
          ? <span className="setting-label" id={labelId}>{field.label}</span>
          : <label className="setting-label" htmlFor={id}>{field.label}</label>}
        {field.description && <p className="setting-description" id={descriptionId}>{field.description}</p>}
      </div>
      <div className="setting-control">{control}</div>
    </div>
  )
}

export default function SettingsPanel({ groups, values, onChange, activeGroup, onGroupChange, renderGroupContent }) {
  const id = useId()
  const tabs = useRef([])
  const activeIndex = Math.max(0, groups.findIndex(group => group.id === activeGroup))
  const group = groups[activeIndex]

  if (!group) return null

  function onTabKeyDown(event, index) {
    let nextIndex
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % groups.length
    else if (event.key === 'ArrowLeft') nextIndex = (index + groups.length - 1) % groups.length
    else if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = groups.length - 1
    else return

    event.preventDefault()
    onGroupChange(groups[nextIndex].id)
    tabs.current[nextIndex]?.focus()
  }

  return (
    <div className="setting-panel">
      {groups.length > 1 && (
        <div className="setting-tabs" role="tablist" aria-label="Settings sections">
          {groups.map((item, index) => (
            <button className="setting-tab" key={item.id} id={`${id}-tab-${index}`} type="button"
              role="tab" aria-selected={index === activeIndex} aria-controls={`${id}-panel`}
              tabIndex={index === activeIndex ? 0 : -1} ref={element => { tabs.current[index] = element }}
              onClick={() => onGroupChange(item.id)} onKeyDown={event => onTabKeyDown(event, index)}>
              {item.label}
            </button>
          ))}
        </div>
      )}
      <div className="setting-content" id={`${id}-panel`}
        role={groups.length > 1 ? 'tabpanel' : undefined}
        aria-labelledby={groups.length > 1 ? `${id}-tab-${activeIndex}` : undefined}>
        {(group.description || group.title) && (
          <header className="setting-group-heading">
            {group.title && <h2>{group.title}</h2>}
            {group.description && <p>{group.description}</p>}
          </header>
        )}
        {renderGroupContent?.(group) ?? group.sections.map((section, index) => (
          <section className="setting-section" key={section.id ?? index}>
            <header className="setting-section-heading">
              <h2>{section.title}</h2>
              {section.description && <p>{section.description}</p>}
            </header>
            <div className="setting-fields">
              {section.fields.map(field => (
                <SettingField key={field.id} field={field} value={values[field.id]}
                  onChange={value => onChange(field.id, value)} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
