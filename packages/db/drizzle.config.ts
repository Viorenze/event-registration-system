import { defineConfig } from "drizzle-kit";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL environment variable is required");
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/index.ts",
  out: process.env.DRIZZLE_OUT_DIR ?? "./drizzle",
  dbCredentials: {
    url: databaseUrl,
  },
});
