import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as authSchema from "./auth-schema.ts";
import * as eventsSchema from "./events-schema.ts";

export * from "./auth-schema.ts";
export * from "./events-schema.ts";
export { and, asc, desc, eq, sql } from "drizzle-orm";
export { authSchema, eventsSchema, pg };

export const schema = { ...authSchema, ...eventsSchema };

export function createDb(connectionString: string) {
  const pool = new pg.Pool({
    connectionString,
    max: 10,
  });
  return drizzle(pool, { schema });
}
