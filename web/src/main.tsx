import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './linkverse.css'
import LinkVerse from './linkverse/LinkVerse'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LinkVerse />
  </StrictMode>,
)
