import { SettingGroups } from '../components/controls/SettingInput'
import { SETTINGS_GROUPS } from '../data/settingControls'

export default function GamePage({ settings, onChange }) {
  if (!settings) return <div style={{ padding: 24, color: 'rgb(var(--fg-dim))', fontSize: 13 }}>Loading…</div>

  return (
    <div style={{ padding: 16 }}>
      <SettingGroups groups={SETTINGS_GROUPS.game} settings={settings} onChange={onChange} />
    </div>
  )
}
