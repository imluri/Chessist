import React from 'react'
import ReactDOM from 'react-dom/client'
import '../ui-template/src/styles.css'
import './index.css'
import './styles/chessist-shell.css'
import { applyTheme } from './data/theme'
import App from './App'

applyTheme()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
