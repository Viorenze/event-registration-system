"use client";

import type { ReactNode } from "react";
import type { AuthUser } from "../lib/auth-client";
import { useSession } from "../lib/use-session";
import { AuthForm } from "./auth-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";

interface SessionGateProps {
  children: (ctx: { user: AuthUser; reload: () => Promise<void> }) => ReactNode;
}

export function SessionGate({ children }: SessionGateProps) {
  const { status, user, error, reload } = useSession();

  if (status === "loading") {
    return (
      <main className="flex min-h-screen items-center justify-center p-4">
        <p className="text-muted-foreground">加载中…</p>
      </main>
    );
  }

  if (status === "anonymous" || !user) {
    return (
      <main className="flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>活动报名系统</CardTitle>
            <CardDescription>登录或注册以继续使用系统</CardDescription>
          </CardHeader>
          <CardContent>
            {error && (
              <div
                role="alert"
                className="mb-4 rounded-md bg-destructive/15 p-3 text-sm text-destructive"
              >
                {error}
              </div>
            )}
            <AuthForm
              onAuthenticated={() => {
                void reload();
              }}
            />
          </CardContent>
        </Card>
      </main>
    );
  }

  return <>{children({ user, reload })}</>;
}
