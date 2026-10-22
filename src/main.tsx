import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { isNative } from './lib/native';
import { StoreProvider } from './lib/store';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StoreProvider>
      <App />
    </StoreProvider>
  </StrictMode>,
);

// En la app nativa los archivos ya van dentro del APK: no hace falta service worker.
if ('serviceWorker' in navigator && import.meta.env.PROD && !isNative) {
  window.addEventListener('load', () => void navigator.serviceWorker.register('./sw.js'));
}
// Pide almacenamiento persistente para que el navegador no borre tus grabaciones.
void navigator.storage?.persist?.();
