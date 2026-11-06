"use client";

import { useEffect, useState } from "react";
import {
  cancelEvent,
  cancelRegistrationById,
  listEventRegistrations,
  patchEvent,
  type EventDetailView,
  type EventRegistrationRow,
  type PatchEventBody,
} from "../lib/api-calls";
import { describeApiError } from "../lib/api-errors";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";

interface EditEventFormProps {
  orgId: string;
  eventId: string;
  detail: EventDetailView;
  reload: () => Promise<void>;
  onChanged: () => void;
}

function EditEventForm({ orgId, eventId, detail, reload, onChanged }: EditEventFormProps) {
  const [baseline, setBaseline] = useState({
    title: detail.title,
    description: detail.description ?? "",
    capacity: detail.capacity,
  });
  const [title, setTitle] = useState(detail.title);
  const [description, setDescription] = useState(detail.description ?? "");
  const [capacity, setCapacity] = useState(String(detail.capacity));
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setFormError("");

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setFormError("标题不能为空");
      return;
    }

    const capNum = Number(capacity);
    if (!Number.isInteger(capNum) || capNum < 1 || capNum > 1000) {
      setFormError("名额必须为 1–1000 的整数");
      return;
    }

    const patch: PatchEventBody = {};
    if (trimmedTitle !== baseline.title) {
      patch.title = trimmedTitle;
    }
    if (description.trim() !== baseline.description.trim()) {
      patch.description = description.trim() === "" ? null : description.trim();
    }
    if (capNum !== baseline.capacity) {
      patch.capacity = capNum;
    }

    if (Object.keys(patch).length === 0) {
      setFormError("没有修改内容");
      return;
    }

    setSubmitting(true);
    const res = await patchEvent(orgId, eventId, patch);
    setSubmitting(false);

    if (res.ok) {
      const newTitle = res.data.title;
      const newDescription = res.data.description ?? "";
      const newCapacity = res.data.capacity;

      setBaseline({
        title: newTitle,
        description: newDescription,
        capacity: newCapacity,
      });
      setTitle(newTitle);
      setDescription(newDescription);
      setCapacity(String(newCapacity));
      onChanged();
    } else {
      if (res.status === 401) {
        void reload();
      } else {
        setFormError(describeApiError(res));
        onChanged();
      }
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl font-bold">修改活动</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {formError && (
            <div role="alert" className="rounded-md bg-destructive/15 p-3 text-sm text-destructive">
              {formError}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="edit-event-title">标题</Label>
            <Input
              id="edit-event-title"
              required
              maxLength={120}
              placeholder="活动标题"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-event-description">说明</Label>
            <textarea
              id="edit-event-description"
              maxLength={2000}
              className="w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 min-h-24"
              placeholder="活动详情与说明（可选）"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-event-capacity">名额</Label>
            <Input
              id="edit-event-capacity"
              type="number"
              min={1}
              max={1000}
              step={1}
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
            />
          </div>

          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? "保存中…" : "保存修改"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

interface EventAdminPanelProps {
  orgId: string;
  eventId: string;
  detail: EventDetailView;
  refreshKey: number;
  reload: () => Promise<void>;
  onChanged: () => void;
}

export function EventAdminPanel({
  orgId,
  eventId,
  detail,
  refreshKey,
  reload,
  onChanged,
}: EventAdminPanelProps) {
  const [rows, setRows] = useState<EventRegistrationRow[] | null>(null);
  const [listError, setListError] = useState("");
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);

  const [cancelError, setCancelError] = useState("");
  const [cancelBusy, setCancelBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const res = await listEventRegistrations(orgId, eventId);
      if (cancelled) return;

      if (res.ok) {
        setRows(res.data);
        setListError("");
      } else {
        if (res.status === 401) {
          void reload();
          return;
        }
        setListError(describeApiError(res));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [orgId, eventId, refreshKey, reload]);

  const handleCancelRow = async (row: EventRegistrationRow) => {
    const confirmed = window.confirm("确定取消 " + row.name + " 的报名吗？");
    if (!confirmed) return;

    setActionError("");
    setBusy(true);
    const res = await cancelRegistrationById(orgId, eventId, row.id);
    setBusy(false);

    if (res.ok) {
      onChanged();
    } else {
      if (res.status === 401) {
        void reload();
      } else {
        setActionError(describeApiError(res));
        onChanged();
      }
    }
  };

  const handleCancelEvent = async () => {
    const confirmed = window.confirm("确定取消该活动吗？此操作不可撤销。");
    if (!confirmed) return;

    setCancelError("");
    setCancelBusy(true);
    const res = await cancelEvent(orgId, eventId);
    setCancelBusy(false);

    if (res.ok) {
      onChanged();
    } else {
      if (res.status === 401) {
        void reload();
      } else {
        setCancelError(describeApiError(res));
        onChanged();
      }
    }
  };

  return (
    <div className="space-y-6">
      {/* 报名名单 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-xl font-bold">报名名单</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {actionError && (
            <div role="alert" className="rounded-md bg-destructive/15 p-3 text-sm text-destructive">
              {actionError}
            </div>
          )}

          {listError ? (
            <div role="alert" className="rounded-md bg-destructive/15 p-3 text-sm text-destructive">
              {listError}
            </div>
          ) : rows === null ? (
            <p className="text-sm text-muted-foreground">正在加载名单…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">暂无报名</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">序号</TableHead>
                  <TableHead>姓名</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>报名时间</TableHead>
                  <TableHead className="w-24 text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row, index) => (
                  <TableRow key={row.id}>
                    <TableCell>{index + 1}</TableCell>
                    <TableCell>{row.name}</TableCell>
                    <TableCell>{row.status === "confirmed" ? "已确认" : "候补中"}</TableCell>
                    <TableCell>{new Date(row.createdAt).toLocaleString("zh-CN")}</TableCell>
                    <TableCell className="text-right">
                      {detail.status !== "cancelled" ? (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={() => handleCancelRow(row)}
                        >
                          取消
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* 修改活动与取消活动 */}
      {detail.status === "cancelled" ? (
        <p className="text-sm text-muted-foreground">活动已取消，无法修改或再次取消</p>
      ) : (
        <>
          <EditEventForm
            orgId={orgId}
            eventId={eventId}
            detail={detail}
            reload={reload}
            onChanged={onChanged}
          />

          <Card>
            <CardHeader>
              <CardTitle className="text-xl font-bold">取消活动</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {cancelError && (
                <div
                  role="alert"
                  className="rounded-md bg-destructive/15 p-3 text-sm text-destructive"
                >
                  {cancelError}
                </div>
              )}
              <p className="text-sm text-muted-foreground">
                取消后，该活动将无法再报名、取消报名或修改；已有报名记录会保留。此操作不可撤销。
              </p>
              <Button variant="destructive" disabled={cancelBusy} onClick={handleCancelEvent}>
                {cancelBusy ? "取消中…" : "取消活动"}
              </Button>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
