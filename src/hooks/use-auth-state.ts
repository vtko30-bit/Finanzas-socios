"use client";

import { useAuthContext } from "@/components/auth-provider";

type AuthState = {
  ready: boolean;
  authenticated: boolean;
};

export function useAuthState(): AuthState {
  const { ready, authenticated } = useAuthContext();
  return { ready, authenticated };
}
