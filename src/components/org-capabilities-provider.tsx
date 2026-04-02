"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

type Capabilities = {
  loading: boolean;
  /** Usuario autenticado con organización y rol owner (puede importar, editar, borrar). */
  canWrite: boolean;
  role: string | null;
};

const defaultValue: Capabilities = {
  loading: true,
  canWrite: false,
  role: null,
};

const OrgCapabilitiesContext = createContext<Capabilities>(defaultValue);

export function OrgCapabilitiesProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [state, setState] = useState<Capabilities>(defaultValue);

  const refresh = useCallback(() => {
    fetch("/api/session-status")
      .then((res) => res.json())
      .then(
        (data: {
          level?: string;
          canWrite?: boolean;
          role?: string;
        }) => {
          const ok = data.level === "green";
          setState({
            loading: false,
            canWrite: ok && data.canWrite === true,
            role: typeof data.role === "string" ? data.role : null,
          });
        },
      )
      .catch(() =>
        setState({ loading: false, canWrite: false, role: null }),
      );
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <OrgCapabilitiesContext.Provider value={state}>
      {children}
    </OrgCapabilitiesContext.Provider>
  );
}

export function useOrgCapabilities() {
  return useContext(OrgCapabilitiesContext);
}
