import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { signInWithPopup, signOut as firebaseSignOut } from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import {
  auth,
  db,
  googleAuthProvider,
  handleFirestoreError,
  OperationType,
  testFirestoreConnection,
} from '../lib/firebase';
import { api, type UserDTO } from '../lib/api';

interface AuthContextValue {
  user: UserDTO | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (params: {
    email: string;
    displayName: string;
    password: string;
    confirmPassword: string;
  }) => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const SESSION_KEY = 'mediexplain_session_token';

async function syncUserToFirestore(uid: string, email: string, displayName: string): Promise<void> {
  const userPath = `users/${uid}`;
  try {
    const ref = doc(db, 'users', uid);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        uid,
        email,
        displayName,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    // Non-blocking if email_verified is false; otherwise report cleanly
    if (auth.currentUser?.emailVerified) {
      handleFirestoreError(err, OperationType.WRITE, userPath);
    }
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserDTO | null>(null);
  const [token, setToken] = useState<string | null>(() => sessionStorage.getItem(SESSION_KEY));
  const [loading, setLoading] = useState(true);

  const persistSession = useCallback((newToken: string | null, newUser: UserDTO | null) => {
    if (newToken) {
      sessionStorage.setItem(SESSION_KEY, newToken);
    } else {
      sessionStorage.removeItem(SESSION_KEY);
    }
    setToken(newToken);
    setUser(newUser);
  }, []);

  useEffect(() => {
    void testFirestoreConnection();
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function restore() {
      const savedToken = sessionStorage.getItem(SESSION_KEY);
      if (!savedToken) {
        if (!cancelled) setLoading(false);
        return;
      }
      try {
        const res = await api.getMe(savedToken);
        if (!cancelled) {
          setToken(savedToken);
          setUser(res.user);
        }
      } catch {
        if (!cancelled) {
          persistSession(null, null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void restore();
    return () => {
      cancelled = true;
    };
  }, [persistSession]);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await api.login({ email, password });
      persistSession(res.token, res.user);
    },
    [persistSession]
  );

  const register = useCallback(
    async (params: {
      email: string;
      displayName: string;
      password: string;
      confirmPassword: string;
    }) => {
      const res = await api.register(params);
      persistSession(res.token, res.user);
    },
    [persistSession]
  );

  const loginWithGoogle = useCallback(async () => {
    const cred = await signInWithPopup(auth, googleAuthProvider);
    const idToken = await cred.user.getIdToken();
    const res = await api.exchangeFirebaseToken(idToken);
    persistSession(res.token, res.user);
    if (cred.user.email) {
      await syncUserToFirestore(
        cred.user.uid,
        cred.user.email,
        cred.user.displayName || cred.user.email.split('@')[0]
      ).catch(() => {});
    }
  }, [persistSession]);

  const logout = useCallback(async () => {
    try {
      await api.logout(token);
      if (auth.currentUser) {
        await firebaseSignOut(auth);
      }
    } finally {
      persistSession(null, null);
    }
  }, [persistSession, token]);

  const refreshUser = useCallback(async () => {
    if (!token) return;
    const res = await api.getMe(token);
    setUser(res.user);
  }, [token]);

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        loading,
        login,
        register,
        loginWithGoogle,
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
