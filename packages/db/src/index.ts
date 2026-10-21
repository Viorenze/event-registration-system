import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as authSchema from "./auth-schema.ts";

export * from "./auth-schema.ts";
export { and, eq, sql } from "drizzle-orm";
export { authSchema, pg };

export function createDb(connectionString: string) {
  const pool = new pg.Pool({
    connectionString,
    max: 10,
  });
  return drizzle(pool, { schema: authSchema });
}
