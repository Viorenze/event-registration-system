import { describe, expect, it } from "vite-plus/test";
import { parseEnv, parseTrustedOrigins } from "./env.ts";

const validEnv = {
  DATABASE_URL: "postgresql://postgres:password@127.0.0.1:5433/event_registration",
  BETTER_AUTH_SECRET: "a_very_secret_key_with_at_least_32_characters",
  BETTER_AUTH_URL: "http://localhost:3000",
  TRUSTED_ORIGINS: "http://localhost:3000",
  LOG_LEVEL: "info",
  NODE_ENV: "development",
};

describe("parseEnv", () => {
  it("fails when DATABASE_URL is missing", () => {
    const { DATABASE_URL: _removed, ...envWithoutDb } = validEnv;
    expect(() => parseEnv(envWithoutDb)).toThrow(/DATABASE_URL/);
  });

  it("succeeds and returns parsed result when all required environment variables are present", () => {
    const result = parseEnv(validEnv);
    expect(result).toEqual(validEnv);
  });
});

describe("parseTrustedOrigins", () => {
  it("parses comma-separated origins into a trimmed string array", () => {
    expect(parseTrustedOrigins("http://localhost:3000, https://app.example.com")).toEqual([
      "http://localhost:3000",
      "https://app.example.com",
    ]);
  });

  it("rejects wildcard, empty, or invalid origin values", () => {
    expect(() => parseTrustedOrigins(" , ")).toThrow(/TRUSTED_ORIGINS/);
    expect(() => parseTrustedOrigins("*")).toThrow(/TRUSTED_ORIGINS/);
    expect(() => parseTrustedOrigins("not-a-valid-origin")).toThrow(/TRUSTED_ORIGINS/);
  });
});
