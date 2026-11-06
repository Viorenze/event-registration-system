"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { SessionGate } from "../../../components/session-gate";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../../components/ui/card";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { createEvent, listEvents, type EventListItem } from "../../../lib/api-calls";
import { describeApiError } from "../../../lib/api-errors";
import type { AuthUser } from "../../../lib/auth-client";
import { useOrgRole } from "../../../lib/use-org-role";

function formatRole(role: string): string {
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

interface OrgEventsViewProps {
  orgId: string;
  user: AuthUser;
  reload: () => Promise<void>;
}

function OrgEventsView({ orgId, user, reload }: OrgEventsViewProps) {
  const roleState = useOrgRole(orgId, user.id);

  // Events list state
  const [events, setEvents] = useState<EventListItem[]>([]);
  const [offset, setOffset] = useState(0);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [eventsError, setEventsError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  // Create event form state
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [registrationDeadline, setRegistrationDeadline] = useState("");
  const [capacity, setCapacity] = useState("10");
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  // Handle unauthenticated state
  useEffect(() => {
    if (roleState.status === "unauthenticated") {
      void reload();
    }
  }, [roleState.status, reload]);

  // Fetch events list
  useEffect(() => {
    let cancelled = false;
    if (roleState.status !== "ready") return;

    setLoadingEvents(true);
    setEventsError("");

    void (async () => {
      const res = await listEvents(orgId, { limit: 21, offset });
      if (cancelled) return;
      setLoadingEvents(false);

      if (res.ok) {
        setEvents(res.data);
      } else {
        if (res.status === 401) {
          void reload();
        } else {
          setEventsError(describeApiError(res));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [orgId, offset, refreshKey, roleState.status, reload]);

  const handleCreateEvent = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setFormError("");

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setFormError("标题不能为空");
      return;
    }

    const startDate = new Date(startsAt);
    const deadlineDate = new Date(registrationDeadline);

    if (isNaN(startDate.getTime()) || isNaN(deadlineDate.getTime())) {
      setFormError("时间格式不正确");
      return;
    }

    if (deadlineDate > startDate) {
      setFormError("报名截止时间不能晚于开始时间");
      return;
    }

    if (startDate.getTime() <= Date.now()) {
      setFormError("开始时间必须在未来");
      return;
    }

    const capNum = Number(capacity);
    if (!Number.isInteger(capNum) || capNum < 1 || capNum > 1000) {
      setFormError("名额必须为 1–1000 的整数");
      return;
    }

    setCreateSubmitting(true);
    const res = await createEvent(orgId, {
      title: trimmedTitle,
      description: description.trim() || null,
      startsAt: startDate.toISOString(),
      registrationDeadline: deadlineDate.toISOString(),
      capacity: capNum,
    });
    setCreateSubmitting(false);

    if (res.ok) {
      setTitle("");
      setDescription("");
      setStartsAt("");
      setRegistrationDeadline("");
      setCapacity("10");
      setOffset(0);
      setRefreshKey((k) => k + 1);
    } else {
      if (res.status === 401) {
        void reload();
      } else {
        setFormError(describeApiError(res));
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
  const hasNext = events.length > 20;
  const displayedEvents = events.slice(0, 20);

  return (
    <main className="min-h-screen p-6 md:p-10">
      <div className="mx-auto max-w-4xl space-y-8">
        <header className="flex flex-col gap-4 border-b pb-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight">活动列表</h1>
              <Badge variant="secondary">{formatRole(roleState.role)}</Badge>
            </div>
            <Link href="/" className="text-sm text-muted-foreground hover:underline">
              ← 返回首页
            </Link>
            {/* 仅控制显隐，权限由服务端中间件执行 */}
            {roleState.canManage && (
              <Link
                href={`/orgs/${orgId}/members`}
                className="block text-sm text-muted-foreground hover:underline"
              >
                成员与邀请
              </Link>
            )}
          </div>
        </header>

        {/* 活动列表 */}
        <section className="space-y-4">
          {eventsError && (
            <div role="alert" className="rounded-md bg-destructive/15 p-3 text-sm text-destructive">
              {eventsError}
            </div>
          )}

          {loadingEvents ? (
            <p className="text-sm text-muted-foreground">正在加载活动列表…</p>
          ) : displayedEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground">暂无活动</p>
          ) : (
            <div className="space-y-3">
              {displayedEvents.map((event) => (
                <Link
                  key={event.id}
                  href={`/orgs/${orgId}/events/${event.id}`}
                  className="block rounded-lg border p-4 transition-colors hover:bg-muted/50"
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="font-medium">{event.title}</div>
                      <div className="text-xs text-muted-foreground">
                        开始时间：{new Date(event.startsAt).toLocaleString("zh-CN")}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 text-sm">
                      <span className="text-muted-foreground">
                        已确认 {event.confirmedCount}/{event.capacity}
                      </span>
                      <span className="text-muted-foreground">候补 {event.waitlistedCount}</span>
                      {event.status === "cancelled" ? (
                        <Badge variant="destructive">已取消</Badge>
                      ) : (
                        <Badge>进行中</Badge>
                      )}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}

          {/* 分页控制 */}
          <div className="flex items-center justify-between pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setOffset((o) => Math.max(0, o - 20))}
              disabled={offset === 0 || loadingEvents}
            >
              上一页
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setOffset((o) => o + 20)}
              disabled={!hasNext || loadingEvents}
            >
              下一页
            </Button>
          </div>
        </section>

        {/* 创建活动表单 */}
        {/* 这只是显隐，权限由服务端中间件执行 */}
        {roleState.canManage && (
          <section>
            <Card className="max-w-xl">
              <CardHeader>
                <CardTitle>创建活动</CardTitle>
                <CardDescription>发布新的活动以供成员报名</CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleCreateEvent} className="space-y-4">
                  {formError && (
                    <div
                      role="alert"
                      className="rounded-md bg-destructive/15 p-3 text-sm text-destructive"
                    >
                      {formError}
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label htmlFor="event-title">活动标题</Label>
                    <Input
                      id="event-title"
                      type="text"
                      required
                      maxLength={120}
                      placeholder="请输入活动标题"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      disabled={createSubmitting}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="event-description">活动说明</Label>
                    <textarea
                      id="event-description"
                      className="w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 min-h-24"
                      placeholder="活动详情与说明（可选）"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      disabled={createSubmitting}
                    />
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="event-starts-at">开始时间</Label>
                      <Input
                        id="event-starts-at"
                        type="datetime-local"
                        required
                        value={startsAt}
                        onChange={(e) => setStartsAt(e.target.value)}
                        disabled={createSubmitting}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="event-deadline">报名截止时间</Label>
                      <Input
                        id="event-deadline"
                        type="datetime-local"
                        required
                        value={registrationDeadline}
                        onChange={(e) => setRegistrationDeadline(e.target.value)}
                        disabled={createSubmitting}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="event-capacity">活动名额</Label>
                    <Input
                      id="event-capacity"
                      type="number"
                      required
                      min={1}
                      max={1000}
                      step={1}
                      value={capacity}
                      onChange={(e) => setCapacity(e.target.value)}
                      disabled={createSubmitting}
                    />
                  </div>

                  <Button type="submit" disabled={createSubmitting} className="w-full">
                    {createSubmitting ? "创建中…" : "创建活动"}
                  </Button>
                </form>
              </CardContent>
            </Card>
          </section>
        )}
      </div>
    </main>
  );
}

export default function OrgPage() {
  const params = useParams<{ orgId: string }>();
  const orgId = params?.orgId ?? "";

  return (
    <SessionGate>
      {({ user, reload }) => <OrgEventsView orgId={orgId} user={user} reload={reload} />}
    </SessionGate>
  );
}
