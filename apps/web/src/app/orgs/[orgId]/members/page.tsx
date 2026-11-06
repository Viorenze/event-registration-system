"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { SessionGate } from "../../../../components/session-gate";
import { Button } from "../../../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../../../components/ui/card";
import { Input } from "../../../../components/ui/input";
import { Label } from "../../../../components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../../components/ui/table";
import { listMembers, type OrgMemberItem } from "../../../../lib/api-calls";
import { describeApiError } from "../../../../lib/api-errors";
import { createInvitation, type AuthUser } from "../../../../lib/auth-client";
import { useOrgRole } from "../../../../lib/use-org-role";

function formatMemberRole(role: string): string {
  switch (role) {
    case "owner":
      return "所有者";
    case "admin":
      return "管理员";
    case "member":
      return "成员";
    default:
      return role;
  }
}

function describeInviteError(e: { status: number; code: string; message: string }): string {
  switch (e.code) {
    case "USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION":
      return "该用户已经是团队成员";
    case "USER_IS_ALREADY_INVITED_TO_THIS_ORGANIZATION":
      return "该邮箱已有待处理的邀请，无法重复邀请";
    case "YOU_ARE_NOT_ALLOWED_TO_INVITE_USERS_TO_THIS_ORGANIZATION":
      return "你没有权限邀请成员";
    default:
      if (e.message && e.message.trim().length > 0) {
        return e.message;
      }
      return `邀请失败（HTTP ${e.status}）`;
  }
}

interface MembersBodyProps {
  orgId: string;
  user: AuthUser;
  reload: () => Promise<void>;
}

function MembersBody({ orgId, user, reload }: MembersBodyProps) {
  const roleState = useOrgRole(orgId, user.id);

  const [members, setMembers] = useState<OrgMemberItem[] | null>(null);
  const [membersError, setMembersError] = useState("");

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"member" | "admin">("member");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [inviteLink, setInviteLink] = useState("");
  const [invitedEmail, setInvitedEmail] = useState("");
  const [copyHint, setCopyHint] = useState("");

  // Handle unauthenticated state
  useEffect(() => {
    if (roleState.status === "unauthenticated") {
      void reload();
    }
  }, [roleState.status, reload]);

  // Fetch member list
  useEffect(() => {
    let cancelled = false;
    if (roleState.status !== "ready") return;

    void (async () => {
      const res = await listMembers(orgId);
      if (cancelled) return;

      if (res.ok) {
        setMembers(res.data);
        setMembersError("");
      } else {
        if (res.status === 401) {
          void reload();
        } else {
          setMembersError(describeApiError(res));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [orgId, roleState.status, reload]);

  const handleInvite = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setFormError("");
    setInviteLink("");
    setCopyHint("");

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setFormError("邮箱不能为空");
      return;
    }

    setSubmitting(true);
    const res = await createInvitation({
      organizationId: orgId,
      email: trimmedEmail,
      role,
    });
    setSubmitting(false);

    if (res.ok) {
      setInviteLink(window.location.origin + "/invite#" + res.data.id);
      setInvitedEmail(trimmedEmail);
      setEmail("");
      setCopyHint("");
    } else {
      setInviteLink("");
      if (res.status === 401) {
        void reload();
      } else {
        setFormError(describeInviteError(res));
      }
    }
  };

  const handleCopyLink = async () => {
    if (
      typeof navigator !== "undefined" &&
      navigator.clipboard &&
      typeof navigator.clipboard.writeText === "function"
    ) {
      try {
        await navigator.clipboard.writeText(inviteLink);
        setCopyHint("已复制");
      } catch {
        setCopyHint("复制失败，请手动选中上面的链接复制");
      }
    } else {
      setCopyHint("复制失败，请手动选中上面的链接复制");
    }
  };

  if (roleState.status === "loading") {
    return (
      <main className="flex min-h-screen items-center justify-center p-4">
        <p className="text-muted-foreground">加载中…</p>
      </main>
    );
  }

  if (roleState.status === "unauthenticated") {
    return (
      <main className="flex min-h-screen items-center justify-center p-4">
        <p className="text-muted-foreground">登录已失效，请重新登录</p>
      </main>
    );
  }

  if (roleState.status === "forbidden") {
    return (
      <main className="flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>访问受限</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-destructive">你不是该团队成员，或无权访问该团队</p>
            <Button asChild variant="outline" className="w-full">
              <Link href="/">返回首页</Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  if (roleState.status === "error") {
    return (
      <main className="flex min-h-screen items-center justify-center p-4">
        <div className="w-full max-w-md space-y-4">
          <div role="alert" className="rounded-md bg-destructive/15 p-4 text-sm text-destructive">
            {roleState.message}
          </div>
          <Button asChild variant="outline" className="w-full">
            <Link href="/">返回首页</Link>
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen p-6 md:p-10">
      <div className="mx-auto max-w-4xl space-y-8">
        <header className="space-y-1 border-b pb-6">
          <Link href={`/orgs/${orgId}`} className="text-sm text-muted-foreground hover:underline">
            ← 返回活动列表
          </Link>
          <h1 className="text-2xl font-bold tracking-tight">成员与邀请</h1>
        </header>

        {/* 成员列表 */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold">团队成员</h2>
          {membersError ? (
            <div role="alert" className="rounded-md bg-destructive/15 p-3 text-sm text-destructive">
              {membersError}
            </div>
          ) : members === null ? (
            <p className="text-sm text-muted-foreground">正在加载成员…</p>
          ) : members.length === 0 ? (
            <p className="text-sm text-muted-foreground">暂无成员</p>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>姓名</TableHead>
                    <TableHead>角色</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {members.map((m) => (
                    <TableRow key={m.userId}>
                      <TableCell>
                        {m.name}
                        {m.userId === user.id ? "（你）" : ""}
                      </TableCell>
                      <TableCell>{formatMemberRole(m.role)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>

        {/* 仅控制显隐，权限由服务端中间件执行 */}
        {roleState.canManage && (
          <section className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>邀请新成员</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {formError && (
                  <div
                    role="alert"
                    className="rounded-md bg-destructive/15 p-3 text-sm text-destructive"
                  >
                    {formError}
                  </div>
                )}
                <form onSubmit={handleInvite} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="invite-email">被邀请人邮箱</Label>
                    <Input
                      id="invite-email"
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      disabled={submitting}
                      placeholder="name@example.com"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="invite-role">角色</Label>
                    <select
                      id="invite-role"
                      value={role}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val === "member" || val === "admin") {
                          setRole(val);
                        }
                      }}
                      disabled={submitting}
                      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <option value="member">成员</option>
                      <option value="admin">管理员</option>
                    </select>
                  </div>

                  <Button type="submit" disabled={submitting}>
                    {submitting ? "创建中…" : "创建邀请"}
                  </Button>
                </form>

                {inviteLink && (
                  <div className="space-y-2 rounded-md border p-4 bg-muted/40">
                    <p className="text-sm font-medium">
                      已为 {invitedEmail}{" "}
                      创建邀请。请只把下面的链接发给对方，该链接等同于邀请凭证，仅限该邮箱对应的账号接受。
                    </p>
                    <div className="flex gap-2">
                      <Input
                        readOnly
                        value={inviteLink}
                        onFocus={(e) => e.currentTarget.select()}
                        className="font-mono text-xs"
                      />
                      <Button type="button" variant="outline" onClick={handleCopyLink}>
                        复制链接
                      </Button>
                    </div>
                    {copyHint && <p className="text-xs text-muted-foreground">{copyHint}</p>}
                  </div>
                )}
              </CardContent>
            </Card>
          </section>
        )}
      </div>
    </main>
  );
}

export default function MembersPage() {
  const params = useParams<{ orgId: string }>();
  const orgId = params?.orgId ?? "";

  return (
    <SessionGate>
      {({ user, reload }) => <MembersBody orgId={orgId} user={user} reload={reload} />}
    </SessionGate>
  );
}
