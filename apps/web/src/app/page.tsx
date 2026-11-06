"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AuthForm } from "../components/auth-form";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import {
  createOrganization,
  generateTeamSlug,
  listOrganizations,
  signOut,
  type OrganizationItem,
} from "../lib/auth-client";
import { useSession } from "../lib/use-session";

export default function HomePage() {
  const { status, user, error: sessionError, reload } = useSession();
  const [organizations, setOrganizations] = useState<OrganizationItem[]>([]);
  const [orgsError, setOrgsError] = useState("");
  const [loadingOrgs, setLoadingOrgs] = useState(false);
  const [newTeamName, setNewTeamName] = useState("");
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createError, setCreateError] = useState("");
  const [forcedAnonymous, setForcedAnonymous] = useState(false);

  const fetchOrgs = useCallback(async () => {
    setLoadingOrgs(true);
    const res = await listOrganizations();
    setLoadingOrgs(false);
    if (res.ok) {
      setOrgsError("");
      setOrganizations(res.data);
    } else {
      if (res.status === 401) {
        setOrganizations([]);
        setForcedAnonymous(true);
        void reload();
      } else {
        setOrgsError(res.message);
      }
    }
  }, [reload]);

  useEffect(() => {
    if (status === "authenticated" && !forcedAnonymous) {
      void fetchOrgs();
    }
  }, [status, forcedAnonymous, fetchOrgs]);

  const handleSignOut = async () => {
    const res = await signOut();
    if (res.ok) {
      setOrganizations([]);
      setForcedAnonymous(false);
    } else {
      setOrgsError(res.message);
    }
    await reload();
  };

  const handleCreateTeam = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const trimmed = newTeamName.trim();
    if (!trimmed) return;

    setCreateError("");
    setCreateSubmitting(true);
    const slug = generateTeamSlug();
    const res = await createOrganization({ name: trimmed, slug });
    setCreateSubmitting(false);

    if (res.ok) {
      setNewTeamName("");
      await fetchOrgs();
    } else {
      if (res.status === 401) {
        setOrganizations([]);
        setForcedAnonymous(true);
        void reload();
      } else {
        setCreateError(res.message);
      }
    }
  };

  if (status === "loading") {
    return (
      <main className="flex min-h-screen items-center justify-center p-4">
        <p className="text-muted-foreground">加载中…</p>
      </main>
    );
  }

  if (status === "anonymous" || forcedAnonymous) {
    return (
      <main className="flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>活动报名系统</CardTitle>
            <CardDescription>登录或注册以继续使用系统</CardDescription>
          </CardHeader>
          <CardContent>
            {sessionError && (
              <div
                role="alert"
                className="mb-4 rounded-md bg-destructive/15 p-3 text-sm text-destructive"
              >
                {sessionError}
              </div>
            )}
            <AuthForm
              onAuthenticated={() => {
                setForcedAnonymous(false);
                void reload();
              }}
            />
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="min-h-screen p-6 md:p-10">
      <div className="mx-auto max-w-4xl space-y-8">
        <header className="flex flex-col gap-4 border-b pb-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">活动报名系统</h1>
            <p className="text-sm text-muted-foreground">
              当前用户：<span className="font-medium text-foreground">{user?.name}</span>（
              {user?.email}）
            </p>
          </div>
          <Button variant="outline" onClick={handleSignOut}>
            退出
          </Button>
        </header>

        <section className="space-y-4">
          <h2 className="text-xl font-semibold">我的团队</h2>
          {orgsError && (
            <div role="alert" className="rounded-md bg-destructive/15 p-3 text-sm text-destructive">
              {orgsError}
            </div>
          )}
          {loadingOrgs ? (
            <p className="text-sm text-muted-foreground">正在加载团队列表…</p>
          ) : orgsError ? null : organizations.length === 0 ? (
            <p className="text-sm text-muted-foreground">还没有团队，先创建一个</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {organizations.map((org) => (
                <Link
                  key={org.id}
                  href={`/orgs/${org.id}`}
                  className="block rounded-lg border p-4 transition-colors hover:bg-muted/50"
                >
                  <div className="font-medium">{org.name}</div>
                  <div className="text-xs text-muted-foreground">{org.slug}</div>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section>
          <Card className="max-w-md">
            <CardHeader>
              <CardTitle>创建团队</CardTitle>
              <CardDescription>输入团队名称，标识符将自动生成</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleCreateTeam} className="space-y-4">
                {createError && (
                  <div
                    role="alert"
                    className="rounded-md bg-destructive/15 p-3 text-sm text-destructive"
                  >
                    {createError}
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="team-name">团队名称</Label>
                  <Input
                    id="team-name"
                    type="text"
                    required
                    placeholder="请输入团队名称"
                    value={newTeamName}
                    onChange={(e) => setNewTeamName(e.target.value)}
                    disabled={createSubmitting}
                  />
                </div>
                <Button type="submit" disabled={createSubmitting} className="w-full">
                  {createSubmitting ? "创建中…" : "创建团队"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </section>
      </div>
    </main>
  );
}
