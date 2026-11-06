import { apiClient } from "./api-client";
import type { ApiResult } from "./auth-client";

function isRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null;
}

function parseApiError(json: unknown, status: number): { code: string; message: string } {
  let message = `请求失败（HTTP ${status}）`;
  let code = "";

  if (isRecord(json) && isRecord(json.error)) {
    if (typeof json.error.message === "string") {
      message = json.error.message;
    }
    if (typeof json.error.code === "string") {
      code = json.error.code;
    }
  }

  return { code, message };
}

export type OrgMemberItem = {
  userId: string;
  name: string;
  role: string;
};

export async function listMembers(orgId: string): Promise<ApiResult<OrgMemberItem[]>> {
  try {
    const res = await apiClient.api.orgs[":orgId"].members.$get({
      param: { orgId },
    });
    if (!res.ok) {
      let json: unknown = null;
      try {
        json = await res.json();
      } catch {
        json = null;
      }
      const { code, message } = parseApiError(json, res.status);
      return { ok: false, status: res.status, code, message };
    }
    const data = await res.json();
    return { ok: true, data };
  } catch {
    return {
      ok: false,
      status: 0,
      code: "NETWORK_ERROR",
      message: "网络错误，请稍后重试",
    };
  }
}

export type EventListItem = {
  id: string;
  organizationId: string;
  title: string;
  description?: string | null;
  startsAt: string;
  registrationDeadline: string;
  capacity: number;
  status: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  confirmedCount: number;
  waitlistedCount: number;
};

export async function listEvents(
  orgId: string,
  query?: { limit?: number; offset?: number },
): Promise<ApiResult<EventListItem[]>> {
  try {
    const queryParams: { limit?: string; offset?: string } = {};
    if (query?.limit !== undefined) {
      queryParams.limit = String(query.limit);
    }
    if (query?.offset !== undefined) {
      queryParams.offset = String(query.offset);
    }
    const res = await apiClient.api.orgs[":orgId"].events.$get({
      param: { orgId },
      query: queryParams,
    });
    if (!res.ok) {
      let json: unknown = null;
      try {
        json = await res.json();
      } catch {
        json = null;
      }
      const { code, message } = parseApiError(json, res.status);
      return { ok: false, status: res.status, code, message };
    }
    const data = await res.json();
    return { ok: true, data };
  } catch {
    return {
      ok: false,
      status: 0,
      code: "NETWORK_ERROR",
      message: "网络错误，请稍后重试",
    };
  }
}

export type CreateEventBody = {
  title: string;
  description?: string | null;
  startsAt: string;
  registrationDeadline: string;
  capacity: number;
};

export type EventDetail = {
  id: string;
  organizationId: string;
  title: string;
  description?: string | null;
  startsAt: string;
  registrationDeadline: string;
  capacity: number;
  status: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export async function createEvent(
  orgId: string,
  body: CreateEventBody,
): Promise<ApiResult<EventDetail>> {
  try {
    const res = await apiClient.api.orgs[":orgId"].events.$post({
      param: { orgId },
      json: body,
    });
    if (!res.ok) {
      let json: unknown = null;
      try {
        json = await res.json();
      } catch {
        json = null;
      }
      const { code, message } = parseApiError(json, res.status);
      return { ok: false, status: res.status, code, message };
    }
    const data = await res.json();
    return { ok: true, data };
  } catch {
    return {
      ok: false,
      status: 0,
      code: "NETWORK_ERROR",
      message: "网络错误，请稍后重试",
    };
  }
}

async function toApiError(res: {
  status: number;
  json: () => Promise<unknown>;
}): Promise<{ ok: false; status: number; code: string; message: string }> {
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  const { code, message } = parseApiError(json, res.status);
  return { ok: false, status: res.status, code, message };
}

export type RegistrationStatus = "confirmed" | "waitlisted";
export type MyRegistration = { id: string; status: RegistrationStatus };
export type EventDetailView = EventListItem & { myRegistration: MyRegistration | null };
export type RegistrationResult = {
  id: string;
  eventId: string;
  userId: string;
  status: string;
  createdAt: string;
};
export type EventRegistrationRow = {
  id: string;
  userId: string;
  name: string;
  status: RegistrationStatus;
  createdAt: string;
};
export type PatchEventBody = { title?: string; description?: string | null; capacity?: number };

export async function getEventDetail(
  orgId: string,
  eventId: string,
): Promise<ApiResult<EventDetailView>> {
  try {
    const res = await apiClient.api.orgs[":orgId"].events[":eventId"].$get({
      param: { orgId, eventId },
    });
    if (!res.ok) {
      return await toApiError(res);
    }
    const data = await res.json();
    return { ok: true, data };
  } catch {
    return {
      ok: false,
      status: 0,
      code: "NETWORK_ERROR",
      message: "网络错误，请稍后重试",
    };
  }
}

export async function listEventRegistrations(
  orgId: string,
  eventId: string,
): Promise<ApiResult<EventRegistrationRow[]>> {
  try {
    const res = await apiClient.api.orgs[":orgId"].events[":eventId"].registrations.$get({
      param: { orgId, eventId },
    });
    if (!res.ok) {
      return await toApiError(res);
    }
    const data = await res.json();
    return { ok: true, data };
  } catch {
    return {
      ok: false,
      status: 0,
      code: "NETWORK_ERROR",
      message: "网络错误，请稍后重试",
    };
  }
}

export async function registerForEvent(
  orgId: string,
  eventId: string,
): Promise<ApiResult<RegistrationResult>> {
  try {
    const res = await apiClient.api.orgs[":orgId"].events[":eventId"].registrations.$post({
      param: { orgId, eventId },
    });
    if (!res.ok) {
      return await toApiError(res);
    }
    const data = await res.json();
    return { ok: true, data };
  } catch {
    return {
      ok: false,
      status: 0,
      code: "NETWORK_ERROR",
      message: "网络错误，请稍后重试",
    };
  }
}

export async function cancelMyRegistration(
  orgId: string,
  eventId: string,
): Promise<ApiResult<null>> {
  try {
    const res = await apiClient.api.orgs[":orgId"].events[":eventId"].registrations.me.$delete({
      param: { orgId, eventId },
    });
    if (!res.ok) {
      return await toApiError(res);
    }
    return { ok: true, data: null };
  } catch {
    return {
      ok: false,
      status: 0,
      code: "NETWORK_ERROR",
      message: "网络错误，请稍后重试",
    };
  }
}

export async function cancelRegistrationById(
  orgId: string,
  eventId: string,
  registrationId: string,
): Promise<ApiResult<null>> {
  try {
    const res = await apiClient.api.orgs[":orgId"].events[":eventId"].registrations[
      ":registrationId"
    ].$delete({
      param: { orgId, eventId, registrationId },
    });
    if (!res.ok) {
      return await toApiError(res);
    }
    return { ok: true, data: null };
  } catch {
    return {
      ok: false,
      status: 0,
      code: "NETWORK_ERROR",
      message: "网络错误，请稍后重试",
    };
  }
}

export async function patchEvent(
  orgId: string,
  eventId: string,
  body: PatchEventBody,
): Promise<ApiResult<EventDetail>> {
  try {
    const res = await apiClient.api.orgs[":orgId"].events[":eventId"].$patch({
      param: { orgId, eventId },
      json: body,
    });
    if (!res.ok) {
      return await toApiError(res);
    }
    const data = await res.json();
    return { ok: true, data };
  } catch {
    return {
      ok: false,
      status: 0,
      code: "NETWORK_ERROR",
      message: "网络错误，请稍后重试",
    };
  }
}

export async function cancelEvent(orgId: string, eventId: string): Promise<ApiResult<EventDetail>> {
  try {
    const res = await apiClient.api.orgs[":orgId"].events[":eventId"].cancel.$post({
      param: { orgId, eventId },
    });
    if (!res.ok) {
      return await toApiError(res);
    }
    const data = await res.json();
    return { ok: true, data };
  } catch {
    return {
      ok: false,
      status: 0,
      code: "NETWORK_ERROR",
      message: "网络错误，请稍后重试",
    };
  }
}
