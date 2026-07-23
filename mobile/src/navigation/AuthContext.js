import React, { createContext, useState, useEffect } from 'react';
import { loadSession, saveSession, clearSession } from '../utils/storage';

export const AuthContext = createContext({
  session: null,
  signIn: async () => {},
  signOut: async () => {},
  loading: true,
});

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  // Re-hydrate session on app start
  useEffect(() => {
    (async () => {
      try {
        const stored = await loadSession();
        if (stored?.token) setSession(stored);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const signIn = async (data) => {
    // data = { token, role, name, company, companyName, userId }
    await saveSession(data);
    setSession(data);
  };

  const signOut = async () => {
    await clearSession();
    setSession(null);
  };

  return (
    <AuthContext.Provider value={{ session, signIn, signOut, loading }}>
      {children}
    </AuthContext.Provider>
  );
}
