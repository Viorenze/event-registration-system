import { expect } from "vite-plus/test";
import { type pg } from "@event-system/db";

export function assertDistinctPids(pids: number[]): void {
  const unique = new Set(pids);
  expect(unique.size, `Expected ${pids.length} distinct backend PIDs, got ${unique.size}`).toBe(
    pids.length,
  );
}

export function createStartGate(): {
  barrier: Promise<void>;
  startSignal: () => void;
} {
  let startSignal!: () => void;
  const barrier = new Promise<void>((resolve) => {
    startSignal = resolve;
  });
  return { barrier, startSignal };
}

export async function waitForLockWait(
  observerClient: pg.Client | pg.PoolClient,
  targetAppName: string,
  blockingPid?: number,
  timeoutMs = 10000,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await observerClient.query<{
      pid: number;
      wait_event_type: string | null;
      wait_event: string | null;
      blocking_pids: number[];
    }>(
      `SELECT pid, wait_event_type, wait_event, pg_blocking_pids(pid) AS blocking_pids
       FROM pg_stat_activity
       WHERE application_name = $1`,
      [targetAppName],
    );

    if (res.rows.length > 0) {
      const row = res.rows[0];
      if (
        row.wait_event_type === "Lock" &&
        (!blockingPid || row.blocking_pids.includes(blockingPid))
      ) {
        return true;
      }
    }
    await new Promise((r) => setTimeout(r, 30));
  }

  // Diagnosis if timed out
  const statDiag = await observerClient.query(
    "SELECT pid, application_name, state, wait_event_type, wait_event, query FROM pg_stat_activity",
  );
  const lockDiag = await observerClient.query(
    "SELECT locktype, relation::regclass, mode, granted, pid FROM pg_locks",
  );
  console.error("waitForLockWait Timeout: pg_stat_activity:", statDiag.rows);
  console.error("waitForLockWait Timeout: pg_locks:", lockDiag.rows);
  throw new Error(
    `waitForLockWait timed out waiting for ${targetAppName} to enter Lock wait state`,
  );
}

export async function assertInvariants(
  client: pg.Client | pg.PoolClient | pg.Pool,
  eventId: string,
): Promise<{
  capacity: number;
  confirmedCount: number;
  waitlistedCount: number;
  cancelledCount: number;
}> {
  const eventRes = await client.query<{ capacity: number }>(
    `SELECT capacity FROM events WHERE id = $1`,
    [eventId],
  );
  if (eventRes.rows.length === 0) {
    throw new Error(`assertInvariants failed: Event ${eventId} not found`);
  }
  const capacity = eventRes.rows[0].capacity;

  const regRes = await client.query<{
    id: string;
    user_id: string;
    status: string;
    seq: string | number;
  }>(`SELECT id, user_id, status, seq FROM registrations WHERE event_id = $1 ORDER BY seq ASC`, [
    eventId,
  ]);

  const confirmedRows = regRes.rows.filter((r) => r.status === "confirmed");
  const waitlistedRows = regRes.rows.filter((r) => r.status === "waitlisted");
  const cancelledRows = regRes.rows.filter((r) => r.status === "cancelled");

  // INV-1: confirmed count <= capacity
  expect(
    confirmedRows.length,
    `INV-1 violated: confirmed (${confirmedRows.length}) > capacity (${capacity})`,
  ).toBeLessThanOrEqual(capacity);

  // INV-2: if waitlisted exists, confirmed == capacity
  if (waitlistedRows.length > 0) {
    expect(
      confirmedRows.length,
      `INV-2 violated: waitlisted exists (${waitlistedRows.length}) but confirmed (${confirmedRows.length}) < capacity (${capacity})`,
    ).toBe(capacity);
  }

  // INV-3: at most 1 active registration per user
  const activeUsers = [...confirmedRows, ...waitlistedRows].map((r) => r.user_id);
  const uniqueActiveUsers = new Set(activeUsers);
  expect(
    uniqueActiveUsers.size,
    `INV-3 violated: duplicate active registrations found (total ${activeUsers.length}, unique ${uniqueActiveUsers.size})`,
  ).toBe(activeUsers.length);

  return {
    capacity,
    confirmedCount: confirmedRows.length,
    waitlistedCount: waitlistedRows.length,
    cancelledCount: cancelledRows.length,
  };
}
