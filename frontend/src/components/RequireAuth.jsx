// Wrapper de ruta que redirige a /login si no hay sesión.

import { Navigate, useLocation } from 'react-router-dom';

import { useAuthStore } from '../store/auth.store.js';

export function RequireAuth({ children }) {
  const { user, token } = useAuthStore();
  const location = useLocation();
  if (!user || !token) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }
  return children;
}
