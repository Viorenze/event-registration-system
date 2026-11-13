import crypto from "node:crypto";
import { and, createDbClient, eq, pg, schema } from "@event-system/db";

export interface TestCredentials {
  email: string;
  name: string;
  password: string;
}

export function generateTestCredentials(): TestCredentials {
  const rand = crypto.randomBytes(6).toString("hex");
  return {
    email: `e2e-${rand}@example.com`,
    name: `E2E User ${rand}`,
    password: `E2e-Pw-${rand}`,
  };
}

export function formatDatetimeLocal(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

export function getEventDateTimes() {
  const now = new Date();
  const startsAt = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);
  const registrationDeadline = new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000);
  return {
    startsAtFormatted: formatDatetimeLocal(startsAt),
    registrationDeadlineFormatted: formatDatetimeLocal(registrationDeadline),
  };
}

export function createE2eDb() {
  if (!process.env.DATABASE_URL && typeof process.loadEnvFile === "function") {
    try {
      process.loadEnvFile();
    } catch {}
  }
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL environment variable is required for e2e tests");
  }
  const pool = new pg.Pool({
    connectionString,
    max: 3,
  });
  pool.on("error", () => {});
  const db = createDbClient(pool);
  return {
    db,
    schema,
    and,
    eq,
    close: async () => {
      await pool.end();
    },
  };
}
