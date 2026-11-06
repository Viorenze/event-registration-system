export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; code: string; message: string };

export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

export interface OrganizationItem {
  id: string;
  name: string;
  slug: string;
}

function isRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null;
}

async function request(path: string, init?: RequestInit): Promise<ApiResult<unknown>> {
  try {
    const headers = new Headers(init?.headers);
    if (init?.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const res = await fetch(path, {
      ...init,
      credentials: "include",
      headers,
    });

    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }

    if (!res.ok) {
      let message = `请求失败（HTTP ${res.status}）`;
      let code = "";

      if (isRecord(json)) {
        if (isRecord(json.error)) {
          if (typeof json.error.message === "string") {
            message = json.error.message;
          }
          if (typeof json.error.code === "string") {
            code = json.error.code;
          }
        } else {
          if (typeof json.message === "string") {
            message = json.message;
          }
          if (typeof json.code === "string") {
            code = json.code;
          }
        }
      }

      return {
        ok: false,
        status: res.status,
        code,
        message,
      };
    }

    return {
      ok: true,
      data: json,
    };
  } catch {
    return {
      ok: false,
      status: 0,
      code: "NETWORK_ERROR",
      message: "网络错误，请稍后重试",
    };
  }
}

export async function getSession(): Promise<ApiResult<AuthUser | null>> {
  const result = await request("/api/auth/get-session", { method: "GET" });
  if (!result.ok) {
    return result;
  }
  const data = result.data;
  if (data === null) {
    return { ok: true, data: null };
  }
  if (isRecord(data) && isRecord(data.user)) {
    const { id, email, name } = data.user;
    if (typeof id === "string" && typeof email === "string" && typeof name === "string") {
      return { ok: true, data: { id, email, name } };
    }
  }
  return { ok: true, data: null };
}

export async function signUpEmail(params: {
  name: string;
  email: string;
  password: string;
}): Promise<ApiResult<unknown>> {
  return request("/api/auth/sign-up/email", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export async function signInEmail(params: {
  email: string;
  password: string;
}): Promise<ApiResult<unknown>> {
  return request("/api/auth/sign-in/email", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export async function signOut(): Promise<ApiResult<unknown>> {
  return request("/api/auth/sign-out", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
}

export async function listOrganizations(): Promise<ApiResult<OrganizationItem[]>> {
  const result = await request("/api/auth/organization/list", { method: "GET" });
  if (!result.ok) {
    return result;
  }
  const data = result.data;
  const list: OrganizationItem[] = [];
  if (Array.isArray(data)) {
    for (const item of data) {
      if (isRecord(item)) {
        if (typeof item.id === "string" && typeof item.name === "string") {
          list.push({
            id: item.id,
            name: item.name,
            slug: typeof item.slug === "string" ? item.slug : "",
          });
        }
      }
    }
  }
  return { ok: true, data: list };
}

export async function createOrganization(params: {
  name: string;
  slug: string;
}): Promise<ApiResult<{ id: string }>> {
  const result = await request("/api/auth/organization/create", {
    method: "POST",
    body: JSON.stringify(params),
  });
  if (!result.ok) {
    return result;
  }
  const data = result.data;
  let id = "";
  if (isRecord(data) && typeof data.id === "string") {
    id = data.id;
  }
  return { ok: true, data: { id } };
}

export async function acceptInvitation(invitationId: string): Promise<ApiResult<unknown>> {
  return request("/api/auth/organization/accept-invitation", {
    method: "POST",
    body: JSON.stringify({ invitationId }),
  });
}

export function generateTeamSlug(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let randomStr = "";
  for (let i = 0; i < bytes.length; i++) {
    randomStr += chars[bytes[i] % chars.length];
  }
  return `team-${randomStr}`;
}

export async function createInvitation(params: {
  organizationId: string;
  email: string;
  role: "member" | "admin";
}): Promise<ApiResult<{ id: string }>> {
  const result = await request("/api/auth/organization/invite-member", {
    method: "POST",
    body: JSON.stringify(params),
  });
  if (!result.ok) {
    return result;
  }
  const data = result.data;
  if (isRecord(data) && typeof data.id === "string") {
    return { ok: true, data: { id: data.id } };
  }
  return {
    ok: false,
    status: 0,
    code: "INVALID_RESPONSE",
    message: "邀请已创建，但响应中没有邀请 id，请重试",
  };
}
