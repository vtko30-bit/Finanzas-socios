"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/browser";

type AuthState = {
  ready: boolean;
  authenticated: boolean;
};

export function useAuthState(): AuthState {
  const [state, setState] = useState<AuthState>({
    ready: false,
    authenticated: false,
  });

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      setState({
        ready: true,
        authenticated: Boolean(data.user),
      });
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setState({
        ready: true,
        authenticated: Boolean(session?.user),
      });
    });

    return () => subscription.unsubscribe();
  }, []);

  return state;
}
