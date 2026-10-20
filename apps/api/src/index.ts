import { Hono } from "hono";
import { parseEnv } from "./env.ts";

export const env = parseEnv(process.env);

export const app = new Hono().get("/", (c) => {
  return c.json({ status: "ok" });
});
