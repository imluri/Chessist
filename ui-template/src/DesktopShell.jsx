import React, { useEffect, useRef, useState } from 'react'
import { Icon } from './icons'

export function TitleBar({ brand, windowControls, onToggleNavigation, navigationExpanded }) {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    let mounted = true
    windowControls?.isMaximized?.().then(value => {
      if (mounted) setMaximized(value)
    }).catch(() => {})
    const unsubscribe = windowControls?.onMaximizedChange?.(setMaximized)
    return () => {
      mounted = false
      unsubscribe?.()
    }
  }, [windowControls])

  return (
    <header className="title-bar">
      <button className="icon-button mobile-navigation" type="button" onClick={onToggleNavigation}
        aria-label="Toggle navigation" aria-expanded={navigationExpanded} aria-controls="app-navigation"><Icon name="menu" /></button>
      <div className="title-brand">
        <span className="brand-mark" aria-hidden="true">{brand.mark}</span>
        <span>{brand.name}</span>
      </div>
      <span className="title-caption">{brand.caption}</span>
      {windowControls && (
        <div className="window-controls">
          <button type="button" onClick={() => windowControls.minimize()} aria-label="Minimize"><Icon name="minimize" /></button>
          <button type="button" onClick={() => windowControls.toggleMaximize()} aria-label={maximized ? 'Restore window' : 'Maximize'}><Icon name={maximized ? 'restore' : 'maximize'} /></button>
          <button type="button" className="window-close" onClick={() => windowControls.close()} aria-label="Close window"><Icon name="close" /></button>
        </div>
      )}
    </header>
  )
}

export function Sidebar({ items, page, onNavigate, tools, footer, expanded }) {
  return (
    <aside className={`sidebar${expanded ? ' sidebar--expanded' : ''}`} id="app-navigation">
      <nav aria-label="Main navigation">
        {items.map(({ id, label, icon }) => (
          <button key={id} type="button" className="nav-item" aria-current={page === id ? 'page' : undefined} onClick={() => onNavigate(id)}>
            {icon}<span>{label}</span>
          </button>
        ))}
      </nav>
      {tools}
      {footer && <div className="sidebar-footer">{footer}</div>}
    </aside>
  )
}

export default function DesktopShell({ brand, items, page, onNavigate, windowControls, sidebarTools, sidebarFooter, banner, children, footer }) {
  const [expanded, setExpanded] = useState(false)
  const scroller = useRef(null)
  useEffect(() => {
    scroller.current?.scrollTo(0, 0)
  }, [page])
  const navigate = id => {
    onNavigate(id)
    setExpanded(false)
  }

  return (
    <div className="desktop-shell">
      <TitleBar brand={brand} windowControls={windowControls} navigationExpanded={expanded}
        onToggleNavigation={() => setExpanded(open => !open)} />
      <Sidebar items={items} page={page} onNavigate={navigate} tools={sidebarTools} footer={sidebarFooter} expanded={expanded} />
      <main className="main-content">
        {banner}
        <div className="main-scroll" ref={scroller}>{children}</div>
        {footer}
      </main>
    </div>
  )
}
