import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as authSchema from "./auth-schema.ts";
import * as eventsSchema from "./events-schema.ts";
import * as registrationsSchema from "./registrations-schema.ts";

export * from "./auth-schema.ts";
export * from "./events-schema.ts";
export * from "./registrations-schema.ts";
export { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
export { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
export { authSchema, eventsSchema, registrationsSchema, pg };

export const schema = { ...authSchema, ...eventsSchema, ...registrationsSchema };

export function createDbClient(client: pg.Client | pg.Pool | pg.PoolClient) {
  return drizzle(client, { schema });
}

export type Db = ReturnType<typeof createDbClient>;

export function createDb(connectionString: string) {
  const pool = new pg.Pool({
    connectionString,
    max: 10,
  });
  return createDbClient(pool);
}
