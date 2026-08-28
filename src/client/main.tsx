import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('MISSING_ROOT');
}

createRoot(rootElement).render(
  <StrictMode>
    <main>Neon Relay</main>
  </StrictMode>
);
