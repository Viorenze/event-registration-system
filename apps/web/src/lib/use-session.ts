"use client";

import { useCallback, useEffect, useState } from "react";
import { getSession, type AuthUser } from "./auth-client";

export type SessionStatus = "loading" | "anonymous" | "authenticated";

export interface SessionState {
  status: SessionStatus;
  user: AuthUser | null;
  error?: string;
  reload: () => Promise<void>;
}

export function useSession(): SessionState {
  const [status, setStatus] = useState<SessionStatus>("loading");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);

  const reload = useCallback(async () => {
    const res = await getSession();
    if (res.ok) {
      setError(undefined);
      if (res.data) {
        setUser(res.data);
        setStatus("authenticated");
      } else {
        setUser(null);
        setStatus("anonymous");
      }
    } else {
      setUser(null);
      setError(res.message);
      setStatus("anonymous");
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return {
    status,
    user,
    error,
    reload,
  };
}
