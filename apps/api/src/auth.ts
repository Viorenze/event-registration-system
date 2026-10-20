import { authSchema, createDb } from "@event-system/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins";
import { parseEnv, parseTrustedOrigins } from "./env.ts";

const env = parseEnv(process.env);
const trustedOrigins = parseTrustedOrigins(env.TRUSTED_ORIGINS);
const db = createDb(env.DATABASE_URL);

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: authSchema,
  }),
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  trustedOrigins,
  emailAndPassword: {
    enabled: true,
  },
  plugins: [
    organization({
      disableOrganizationDeletion: true,
    }),
  ],
});
