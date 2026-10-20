import type { AppType } from "@event-system/api";
import { hc } from "hono/client";

export const apiClient = hc<AppType>("/");

export async function fetchApiHealth(echo: string): Promise<{ status: "ok"; echo: string }> {
  const res = await apiClient.api.health.$get({
    query: { echo },
  });
  if (!res.ok) {
    throw new Error(`Health check failed with HTTP ${res.status}`);
  }
  return await res.json();
}
