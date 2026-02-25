import { Navigate, Route, Routes } from 'react-router-dom';
import { HomePage } from './pages/HomePage.jsx';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/home" replace />} />
      <Route path="/home" element={<HomePage />} />
      <Route path="*" element={<Navigate to="/home" replace />} />
    </Routes>
  );
}
