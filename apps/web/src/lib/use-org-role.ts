"use client";

import { useEffect, useState } from "react";
import { listMembers } from "./api-calls";
import { describeApiError } from "./api-errors";

export type OrgRoleState =
  | { status: "loading" }
  | { status: "ready"; role: string; canManage: boolean }
  | { status: "unauthenticated" }
  | { status: "forbidden" }
  | { status: "error"; message: string };

export function useOrgRole(orgId: string, userId: string): OrgRoleState {
  const [roleState, setRoleState] = useState<OrgRoleState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    if (!orgId || !userId) {
      setRoleState({ status: "forbidden" });
      return;
    }

    setRoleState({ status: "loading" });

    void (async () => {
      const res = await listMembers(orgId);
      if (cancelled) return;

      if (!res.ok) {
        if (res.status === 401) {
          setRoleState({ status: "unauthenticated" });
        } else if (res.status === 403) {
          setRoleState({ status: "forbidden" });
        } else {
          setRoleState({
            status: "error",
            message: describeApiError(res),
          });
        }
        return;
      }

      const currentMember = res.data.find((m) => m.userId === userId);
      if (!currentMember) {
        setRoleState({ status: "forbidden" });
        return;
      }

      const canManage = currentMember.role === "owner" || currentMember.role === "admin";
      setRoleState({
        status: "ready",
        role: currentMember.role,
        canManage,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [orgId, userId]);

  return roleState;
}
