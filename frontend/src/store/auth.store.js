// Store de auth: usuario logueado + JWT. Persiste en localStorage.

import { create } from 'zustand';

const STORAGE_KEY = 'qaforge.auth';

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { user: null, token: null };
    const parsed = JSON.parse(raw);
    return {
      user: parsed?.user ?? null,
      token: parsed?.token ?? null,
    };
  } catch {
    return { user: null, token: null };
  }
}

function saveToStorage({ user, token }) {
  if (!user || !token) {
    localStorage.removeItem(STORAGE_KEY);
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ user, token }));
}

const initial = loadFromStorage();

export const useAuthStore = create((set) => ({
  user: initial.user,
  token: initial.token,

  setSession: ({ user, token }) => {
    saveToStorage({ user, token });
    set({ user, token });
  },

  logout: () => {
    saveToStorage({ user: null, token: null });
    set({ user: null, token: null });
  },
}));

/** Helper para componentes/lib que necesitan el token actual fuera de React. */
export function getAuthToken() {
  return useAuthStore.getState().token;
}
