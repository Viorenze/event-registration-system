"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AuthForm } from "../../components/auth-form";
import { Button } from "../../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";
import { acceptInvitation, signOut } from "../../lib/auth-client";
import { useSession } from "../../lib/use-session";

export default function InvitePage() {
  const session = useSession();
  const [invitationId, setInvitationId] = useState<string | null>(null);
  const [checkedHash, setCheckedHash] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [errorCode, setErrorCode] = useState("");

  useEffect(() => {
    const rawHash = window.location.hash;
    const cleaned = rawHash.replace(/^#/, "").trim();
    if (cleaned) {
      setInvitationId(cleaned);
    } else {
      setInvitationId(null);
    }
    setCheckedHash(true);
  }, []);

  const handleSignOut = async () => {
    await signOut();
    await session.reload();
  };

  const handleAccept = async () => {
    if (!invitationId) return;
    setErrorMessage("");
    setErrorCode("");
    setSubmitting(true);

    const res = await acceptInvitation(invitationId);
    setSubmitting(false);

    if (res.ok) {
      history.replaceState(null, "", window.location.pathname + window.location.search);
      setAccepted(true);
      setInvitationId(null);
    } else {
      setErrorMessage(res.message);
      setErrorCode(res.code);
      if (res.status === 401) {
        void session.reload();
      }
    }
  };

  if (!checkedHash || session.status === "loading") {
    return (
      <main className="flex min-h-screen items-center justify-center p-4">
        <p className="text-muted-foreground">加载中…</p>
      </main>
    );
  }

  if (accepted) {
    return (
      <main className="flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-md text-center">
          <CardHeader>
            <CardTitle>已加入团队</CardTitle>
            <CardDescription>您已成功接受邀请并加入团队</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild className="w-full">
              <Link href="/">返回首页</Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  if (!invitationId) {
    return (
      <main className="flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>邀请接受</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-destructive">邀请链接无效或不完整</p>
            <Button asChild variant="outline" className="mt-4 w-full">
              <Link href="/">返回首页</Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  if (session.status === "anonymous") {
    return (
      <main className="flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>邀请接受</CardTitle>
            <CardDescription>请先登录或注册（请使用受邀邮箱）</CardDescription>
          </CardHeader>
          <CardContent>
            <AuthForm
              onAuthenticated={() => {
                void session.reload();
              }}
            />
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>团队邀请</CardTitle>
          <CardDescription>
            当前登录邮箱：<span className="font-medium text-foreground">{session.user?.email}</span>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {errorMessage && (
            <div
              role="alert"
              className="space-y-1 rounded-md bg-destructive/15 p-3 text-sm text-destructive"
            >
              <div>{errorMessage}</div>
              {errorCode === "YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION" && (
                <div className="font-medium">该邀请不是发给当前登录邮箱的，请换用受邀邮箱登录</div>
              )}
            </div>
          )}

          <div className="flex flex-col gap-2">
            <Button onClick={handleAccept} disabled={submitting} className="w-full">
              {submitting ? "正在接受…" : "接受邀请"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handleSignOut}
              disabled={submitting}
              className="w-full"
            >
              换账号
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
