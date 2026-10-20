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

export function parseTrustedOrigins(rawOrigins: string): string[] {
  const origins = rawOrigins
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (origins.length === 0) {
    throw new Error("Invalid TRUSTED_ORIGINS: must contain at least one explicit origin");
  }

  for (const origin of origins) {
    if (origin.includes("*")) {
      throw new Error(`Invalid TRUSTED_ORIGINS: wildcard origin is not allowed (${origin})`);
    }
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(origin);
    } catch {
      throw new Error(`Invalid TRUSTED_ORIGINS: "${origin}" is not a valid URL origin`);
    }
    if (
      (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") ||
      parsedUrl.origin !== origin
    ) {
      throw new Error(
        `Invalid TRUSTED_ORIGINS: "${origin}" must be an exact http/https origin without path, query, or hash`,
      );
    }
  }

  return origins;
}
