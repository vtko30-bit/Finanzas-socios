"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { createClient } from "@/lib/supabase/browser";

type AuthContextValue = {
  ready: boolean;
  authenticated: boolean;
  email: string | null;
  signOut: () => Promise<void>;
};

const defaultValue: AuthContextValue = {
  ready: false,
  authenticated: false,
  email: null,
  signOut: async () => {},
};

const AuthContext = createContext<AuthContextValue>(defaultValue);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<Omit<AuthContextValue, "signOut">>({
    ready: false,
    authenticated: false,
    email: null,
  });

  useEffect(() => {
    const supabase = createClient();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setState({
        ready: true,
        authenticated: Boolean(session?.user),
        email: session?.user?.email ?? null,
      });
    });

    return () => subscription.unsubscribe();
  }, []);

  const signOut = useCallback(async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    setState({
      ready: true,
      authenticated: false,
      email: null,
    });
    window.location.href = "/login";
  }, []);

  const value = useMemo(
    () => ({
      ...state,
      signOut,
    }),
    [state, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthContext() {
  return useContext(AuthContext);
}
