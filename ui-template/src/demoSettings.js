export const defaults = {
  workspace: 'Studio workspace',
  language: 'English',
  launchAtStartup: false,
  theme: 'light',
  accent: 'Teal',
  scale: 100,
  compact: false,
  notifications: true,
  rememberWindow: true,
  maxRecentItems: 10,
}

export const groups = [
  {
    id: 'appearance', label: 'Appearance',
    sections: [
      {
        title: 'Theme', description: 'Choose how the app looks on this device.',
        fields: [
          {
            id: 'theme', label: 'Color mode', type: 'radio',
            options: [
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
              { value: 'system', label: 'System' },
            ],
          },
        ],
      },
      {
        title: 'Interface', description: 'Adjust color, spacing, and text size.',
        fields: [
          { id: 'accent', label: 'Accent color', description: 'Used for buttons and selected controls.', type: 'select', options: ['Teal', 'Blue', 'Violet', 'Rose'].map(value => ({ value, label: value })) },
          { id: 'scale', label: 'Text size', description: 'Scale text in the settings panel.', type: 'range', min: 90, max: 125, step: 5, formatValue: value => `${value}%` },
          { id: 'compact', label: 'Compact layout', description: 'Reduce spacing between settings.', type: 'switch' },
        ],
      },
    ],
  },
  {
    id: 'general', label: 'General',
    sections: [
      {
        title: 'Workspace', description: 'Personalize the name and preferences for this workspace.',
        fields: [
          { id: 'workspace', label: 'Workspace name', description: 'Shown at the bottom of the sidebar.', type: 'text', placeholder: 'Enter a workspace name' },
          { id: 'language', label: 'Preferred language', description: 'Stored as a workspace preference.', type: 'select', options: ['English', 'Español', '日本語'].map(value => ({ value, label: value })) },
        ],
      },
      {
        title: 'Launch preferences', description: 'Try how desktop preferences are presented.',
        fields: [
          { id: 'launchAtStartup', label: 'Launch at startup', type: 'switch' },
          { id: 'rememberWindow', label: 'Remember window size', type: 'checkbox' },
        ],
      },
    ],
  },
  {
    id: 'advanced', label: 'Advanced',
    sections: [
      {
        title: 'Preferences',
        fields: [
          { id: 'notifications', label: 'Show notifications', description: 'Save a notification preference.', type: 'checkbox' },
          { id: 'maxRecentItems', label: 'Recent item limit', description: 'Set a value between 1 and 50.', type: 'number', min: 1, max: 50 },
        ],
      },
    ],
  },
]
