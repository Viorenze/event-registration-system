"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { EventAdminPanel } from "../../../../../components/event-admin-panel";
import { SessionGate } from "../../../../../components/session-gate";
import { Badge } from "../../../../../components/ui/badge";
import { Button } from "../../../../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../../../../components/ui/card";
import {
  cancelMyRegistration,
  getEventDetail,
  registerForEvent,
  type EventDetailView,
} from "../../../../../lib/api-calls";
import { describeApiError } from "../../../../../lib/api-errors";
import type { AuthUser } from "../../../../../lib/auth-client";
import { useOrgRole } from "../../../../../lib/use-org-role";

interface EventDetailBodyProps {
  orgId: string;
  eventId: string;
  user: AuthUser;
  reload: () => Promise<void>;
}

type LoadError =
  | { kind: "not-found" }
  | { kind: "invalid" }
  | { kind: "other"; message: string }
  | null;

function EventDetailBody({ orgId, eventId, user, reload }: EventDetailBodyProps) {
  const roleState = useOrgRole(orgId, user.id);

  const [detail, setDetail] = useState<EventDetailView | null>(null);
  const [loadError, setLoadError] = useState<LoadError>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [actionError, setActionError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const detailRef = useRef<EventDetailView | null>(null);
  useEffect(() => {
    detailRef.current = detail;
  }, [detail]);

  // Handle unauthenticated state
  useEffect(() => {
    if (roleState.status === "unauthenticated") {
      void reload();
    }
  }, [roleState.status, reload]);

  // Fetch event detail
  useEffect(() => {
    let cancelled = false;
    if (roleState.status !== "ready") return;

    void (async () => {
      const res = await getEventDetail(orgId, eventId);
      if (cancelled) return;

      if (res.ok) {
        setDetail(res.data);
        setLoadError(null);
      } else {
        if (res.status === 401) {
          void reload();
          return;
        }
        if (detailRef.current === null) {
          if (res.status === 404) {
            setLoadError({ kind: "not-found" });
          } else if (res.status === 400) {
            setLoadError({ kind: "invalid" });
          } else {
            setLoadError({ kind: "other", message: describeApiError(res) });
          }
        } else {
          setActionError(describeApiError(res));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [orgId, eventId, refreshKey, roleState.status, reload]);

  const handleRegister = async () => {
    setActionError("");
    setSubmitting(true);
    const res = await registerForEvent(orgId, eventId);
    setSubmitting(false);

    if (res.ok) {
      setRefreshKey((k) => k + 1);
    } else {
      if (res.status === 401) {
        void reload();
      } else {
        setActionError(describeApiError(res));
        setRefreshKey((k) => k + 1);
      }
    }
  };

  const handleCancelRegistration = async () => {
    const confirmed = window.confirm("取消报名后重新报名将排到队尾，确定取消吗？");
    if (!confirmed) return;

    setActionError("");
    setSubmitting(true);
    const res = await cancelMyRegistration(orgId, eventId);
    setSubmitting(false);

    if (res.ok) {
      setRefreshKey((k) => k + 1);
    } else {
      if (res.status === 401) {
        void reload();
      } else {
        setActionError(describeApiError(res));
        setRefreshKey((k) => k + 1);
      }
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

  // roleState.status === "ready"
  if (detail === null) {
    if (loadError !== null) {
      const message =
        loadError.kind === "not-found"
          ? "活动不存在，或不属于该团队"
          : loadError.kind === "invalid"
            ? "活动链接无效"
            : loadError.message;

      return (
        <main className="flex min-h-screen items-center justify-center p-4">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle>无法加载活动</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-destructive">{message}</p>
              <Button asChild variant="outline" className="w-full">
                <Link href={`/orgs/${orgId}`}>返回活动列表</Link>
              </Button>
            </CardContent>
          </Card>
        </main>
      );
    }

    return (
      <main className="flex min-h-screen items-center justify-center p-4">
        <p className="text-muted-foreground">加载中…</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen p-6 md:p-10">
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <Link href={`/orgs/${orgId}`} className="text-sm text-muted-foreground hover:underline">
            ← 返回活动列表
          </Link>
        </div>

        {actionError && (
          <div role="alert" className="rounded-md bg-destructive/15 p-3 text-sm text-destructive">
            {actionError}
          </div>
        )}

        <Card>
          <CardHeader>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle className="text-2xl font-bold tracking-tight">{detail.title}</CardTitle>
              <div>
                {detail.status === "cancelled" ? (
                  <Badge variant="destructive">已取消</Badge>
                ) : (
                  <Badge>进行中</Badge>
                )}
              </div>
            </div>
            {detail.description ? (
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                {detail.description}
              </p>
            ) : null}
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <span className="text-muted-foreground">开始时间：</span>
                {new Date(detail.startsAt).toLocaleString("zh-CN")}
              </div>
              <div>
                <span className="text-muted-foreground">报名截止时间：</span>
                {new Date(detail.registrationDeadline).toLocaleString("zh-CN")}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-4 border-t pt-4 text-sm">
              <span className="text-muted-foreground">
                已确认 {detail.confirmedCount}/{detail.capacity}
              </span>
              <span className="text-muted-foreground">候补 {detail.waitlistedCount}</span>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">我的状态：</span>
                {detail.myRegistration === null ? (
                  <Badge variant="outline">未报名</Badge>
                ) : detail.myRegistration.status === "confirmed" ? (
                  <Badge>已确认</Badge>
                ) : (
                  <Badge variant="secondary">候补中</Badge>
                )}
              </div>
            </div>

            <div className="border-t pt-4">
              {detail.status === "cancelled" ? (
                <p className="text-sm text-muted-foreground">活动已取消，无法报名</p>
              ) : detail.myRegistration === null ? (
                <Button onClick={handleRegister} disabled={submitting}>
                  {submitting ? "提交中…" : "报名"}
                </Button>
              ) : (
                <Button variant="outline" onClick={handleCancelRegistration} disabled={submitting}>
                  {submitting ? "提交中…" : "取消报名"}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* 仅控制显隐，权限由服务端中间件执行 */}
        {roleState.canManage && (
          <EventAdminPanel
            orgId={orgId}
            eventId={eventId}
            detail={detail}
            refreshKey={refreshKey}
            reload={reload}
            onChanged={() => setRefreshKey((k) => k + 1)}
          />
        )}
      </div>
    </main>
  );
}

export default function EventDetailPage() {
  const params = useParams<{ orgId: string; eventId: string }>();
  const orgId = params?.orgId ?? "";
  const eventId = params?.eventId ?? "";

  return (
    <SessionGate>
      {({ user, reload }) => (
        <EventDetailBody orgId={orgId} eventId={eventId} user={user} reload={reload} />
      )}
    </SessionGate>
  );
}
