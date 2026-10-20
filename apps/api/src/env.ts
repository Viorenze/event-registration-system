import { z } from "zod";

export const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(1),
  BETTER_AUTH_URL: z.string().min(1),
  TRUSTED_ORIGINS: z.string().min(1),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]),
  NODE_ENV: z.enum(["development", "test", "production"]),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(rawEnv: Record<string, string | undefined> = process.env): Env {
  const parsed = envSchema.safeParse(rawEnv);
  if (!parsed.success) {
    const missingOrInvalidKeys = Array.from(
      new Set(parsed.error.issues.map((issue) => issue.path.join("."))),
    );
    throw new Error(`Invalid or missing environment variables: ${missingOrInvalidKeys.join(", ")}`);
  }
  return parsed.data;
}
