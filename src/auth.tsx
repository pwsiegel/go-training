// Auth context: Google sign-in over Firebase Auth, plus the caller's profile
// (display name + role) from Firestore. The first sign-in provisions the
// user's profile doc; allowlisting is enforced by security rules, so a
// non-allowlisted user signs in but every data read/write is denied.

import {
  createContext, useContext, useEffect, useState, type ReactNode,
} from 'react';
import {
  GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
  type User,
} from 'firebase/auth';
import { auth } from './firebase';
import { ensureProfile, type Profile } from './data/profile';

type AuthState = {
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  signIn: () => Promise<void>;
  signOutUser: () => Promise<void>;
  // Merge a patch into the in-memory profile so a persisted change (e.g. engine
  // prefs) is reflected across views this session without re-fetching.
  updateProfile: (patch: Partial<Profile>) => void;
};

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    return onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        try {
          setProfile(await ensureProfile(u.uid, u.email ?? '', u.displayName ?? ''));
        } catch {
          // Not allowlisted (rules deny): treated as signed-in-but-unauthorized.
          setProfile(null);
        }
      } else {
        setProfile(null);
      }
      setLoading(false);
    });
  }, []);

  const signIn = async () => {
    await signInWithPopup(auth, new GoogleAuthProvider());
  };
  const signOutUser = async () => {
    await signOut(auth);
  };
  const updateProfile = (patch: Partial<Profile>) =>
    setProfile((p) => (p ? { ...p, ...patch } : p));

  return (
    <Ctx.Provider value={{ user, profile, loading, signIn, signOutUser, updateProfile }}>
      {children}
    </Ctx.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used within AuthProvider');
  return v;
}
