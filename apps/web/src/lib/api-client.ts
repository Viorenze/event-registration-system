import type { AppType } from "@event-system/api";
import { hc } from "hono/client";

export const apiClient = hc<AppType>("/");

export async function fetchOrgMembers(
  orgId: string,
): Promise<Array<{ userId: string; name: string; role: string }>> {
  const res = await apiClient.api.orgs[":orgId"].members.$get({
    param: { orgId },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch organization members: HTTP ${res.status}`);
  }
  return await res.json();
}
