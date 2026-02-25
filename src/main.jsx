import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

function App() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>
      <h1>Entre</h1>
      <p>Frontend inicial cargado correctamente.</p>
    </main>
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
