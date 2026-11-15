import React, { lazy, Suspense } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

const TerrainTest = lazy(() => import('./terrain/TerrainTest'))
const isTerrainTest = window.location.pathname.replace(/\/$/, '') === '/terrain-test'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isTerrainTest ? <Suspense fallback={<p>Loading terrain experiment…</p>}><TerrainTest /></Suspense> : <App />}
  </React.StrictMode>,
)
