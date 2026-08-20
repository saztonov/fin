import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
// index.css включает все сабсеты (latin + cyrillic) через unicode-range
import '@fontsource-variable/inter/index.css';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
