// 仅限本地演示的公开常量
export const DEMO_PASSWORD = "DemoPassword123!";

const SIGN_UP_DELAY_MS = 4000;
const REQUEST_TIMEOUT_MS = 15000;
const RATE_LIMIT_MAX_RETRIES = 3;
const RATE_LIMIT_DEFAULT_WAIT_MS = 11000;
const DAYS_TO_DEADLINE = 10;
const DAYS_TO_START = 14;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type SeedOutcome = "seeded" | "already-seeded" | "dry-run";

export interface SeedDependencies {
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
  log: (line: string) => void;
}

export interface RunSeedOptions extends Partial<SeedDependencies> {
  baseUrl?: string;
  dryRun?: boolean;
}

type OrgKey = "orgA" | "orgB";
type UserKey =
  | "ownerA"
  | "adminA"
  | "memberA1"
  | "memberA2"
  | "memberA3"
  | "memberA4"
  | "memberA5"
  | "ownerB"
  | "memberB1";

interface SeedUserSpec {
  key: UserKey;
  name: string;
  email: string;
  orgKey: OrgKey;
  role: "owner" | "admin" | "member";
}

interface SeedOrgSpec {
  key: OrgKey;
  name: string;
  slug: string;
  ownerKey: UserKey;
}

interface SeedEventSpec {
  orgKey: OrgKey;
  title: string;
  description: string | null;
  capacity: number;
  registerKeys: UserKey[];
}

const SEED_USERS: readonly SeedUserSpec[] = [
  {
    key: "ownerA",
    name: "Demo Owner A",
    email: "demo-owner-a@example.com",
    orgKey: "orgA",
    role: "owner",
  },
  {
    key: "adminA",
    name: "Demo Admin A",
    email: "demo-admin-a@example.com",
    orgKey: "orgA",
    role: "admin",
  },
  {
    key: "memberA1",
    name: "Demo Member A1",
    email: "demo-member-a1@example.com",
    orgKey: "orgA",
    role: "member",
  },
  {
    key: "memberA2",
    name: "Demo Member A2",
    email: "demo-member-a2@example.com",
    orgKey: "orgA",
    role: "member",
  },
  {
    key: "memberA3",
    name: "Demo Member A3",
    email: "demo-member-a3@example.com",
    orgKey: "orgA",
    role: "member",
  },
  {
    key: "memberA4",
    name: "Demo Member A4",
    email: "demo-member-a4@example.com",
    orgKey: "orgA",
    role: "member",
  },
  {
    key: "memberA5",
    name: "Demo Member A5",
    email: "demo-member-a5@example.com",
    orgKey: "orgA",
    role: "member",
  },
  {
    key: "ownerB",
    name: "Demo Owner B",
    email: "demo-owner-b@example.com",
    orgKey: "orgB",
    role: "owner",
  },
  {
    key: "memberB1",
    name: "Demo Member B1",
    email: "demo-member-b1@example.com",
    orgKey: "orgB",
    role: "member",
  },
];

const SEED_ORGS: readonly SeedOrgSpec[] = [
  { key: "orgA", name: "Demo Org A", slug: "demo-org-a", ownerKey: "ownerA" },
  { key: "orgB", name: "Demo Org B", slug: "demo-org-b", ownerKey: "ownerB" },
];

const SEED_EVENTS: readonly SeedEventSpec[] = [
  {
    orgKey: "orgA",
    title: "Demo: Small Workshop (3 spots)",
    description: null,
    capacity: 3,
    registerKeys: ["memberA1", "memberA2", "memberA3", "memberA4", "memberA5"],
  },
  {
    orgKey: "orgA",
    title: "Demo: Open Meetup (50 spots)",
    description: null,
    capacity: 50,
    registerKeys: [],
  },
  {
    orgKey: "orgB",
    title: "Demo: Org B Private Event",
    description: null,
    capacity: 5,
    registerKeys: ["memberB1"],
  },
];

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function validateLoopbackBaseUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    throw new Error("SEED_BASE_URL must not be empty");
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("SEED_BASE_URL is not a valid URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Unsupported SEED_BASE_URL protocol: ${parsed.protocol}`);
  }

  if (parsed.username !== "" || parsed.password !== "") {
    throw new Error("SEED_BASE_URL must not contain userinfo");
  }

  if (!LOOPBACK_HOSTS.has(parsed.hostname)) {
    throw new Error(`SEED_BASE_URL host is not loopback: ${parsed.hostname}`);
  }

  if (
    (parsed.pathname !== "" && parsed.pathname !== "/") ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    throw new Error("SEED_BASE_URL must be an origin without path, query, or hash");
  }

  return parsed.origin;
}

export class CookieJar {
  private readonly cookies = new Map<string, string>();

  applySetCookies(headers: Headers): void {
    const rawCookies =
      typeof headers.getSetCookie === "function"
        ? headers.getSetCookie()
        : headers.get("set-cookie")
          ? [headers.get("set-cookie") as string]
          : [];

    for (const raw of rawCookies) {
      const nameValue = raw.split(";", 1)[0]?.trim() ?? "";
      const eqIndex = nameValue.indexOf("=");
      if (eqIndex <= 0) {
        continue;
      }
      const name = nameValue.slice(0, eqIndex).trim();
      const value = nameValue.slice(eqIndex + 1).trim();
      if (name) {
        this.cookies.set(name, value);
      }
    }
  }

  toCookieHeader(): string | undefined {
    if (this.cookies.size === 0) {
      return undefined;
    }
    const pairs: string[] = [];
    for (const [name, value] of this.cookies.entries()) {
      pairs.push(`${name}=${value}`);
    }
    return pairs.join("; ");
  }
}

function parseRetryAfterMs(headerValue: string | null): number {
  if (headerValue === null) {
    return RATE_LIMIT_DEFAULT_WAIT_MS;
  }
  const parsedSeconds = Number(headerValue.trim());
  if (Number.isFinite(parsedSeconds) && parsedSeconds > 0) {
    return Math.ceil(parsedSeconds * 1000);
  }
  return RATE_LIMIT_DEFAULT_WAIT_MS;
}

export interface RequestWithRetryParams {
  baseOrigin: string;
  path: string;
  method: "GET" | "POST";
  body?: unknown;
  jar: CookieJar;
  stepName: string;
  fetchFn: typeof fetch;
  sleepFn: (ms: number) => Promise<void>;
}

export async function requestWithRetry(params: RequestWithRetryParams): Promise<Response> {
  const { baseOrigin, path, method, body, jar, stepName, fetchFn, sleepFn } = params;
  const targetUrl = `${baseOrigin}${path}`;

  for (let attempt = 0; attempt <= RATE_LIMIT_MAX_RETRIES; attempt += 1) {
    const headers = new Headers();
    headers.set("Origin", baseOrigin);

    let serializedBody: string | undefined;
    if (method === "POST") {
      headers.set("Content-Type", "application/json");
      serializedBody = JSON.stringify(body ?? {});
    }

    const cookieHeader = jar.toCookieHeader();
    if (cookieHeader) {
      headers.set("Cookie", cookieHeader);
    }

    const init: RequestInit = {
      method,
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    };
    if (serializedBody !== undefined) {
      init.body = serializedBody;
    }

    const res = await fetchFn(targetUrl, init);
    jar.applySetCookies(res.headers);

    if (res.status !== 429) {
      return res;
    }

    if (attempt >= RATE_LIMIT_MAX_RETRIES) {
      throw new Error(
        `Failed at step "${stepName}": HTTP 429 after ${RATE_LIMIT_MAX_RETRIES} retries`,
      );
    }

    const waitMs = parseRetryAfterMs(res.headers.get("x-retry-after"));
    await sleepFn(waitMs);
  }

  throw new Error(`Failed at step "${stepName}": unexpected retry loop exit`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function readJsonSafe(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function extractErrorCode(json: unknown): string | undefined {
  if (!isRecord(json)) {
    return undefined;
  }
  if (typeof json.code === "string") {
    return json.code;
  }
  if (isRecord(json.error) && typeof json.error.code === "string") {
    return json.error.code;
  }
  return undefined;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const defaultLog = (line: string): void => {
  console.log(line);
};

export async function runSeed(options: RunSeedOptions = {}): Promise<SeedOutcome> {
  const fetchFn = options.fetch ?? fetch;
  const sleepFn = options.sleep ?? defaultSleep;
  const nowFn = options.now ?? (() => new Date());
  const log = options.log ?? defaultLog;
  const dryRun = options.dryRun ?? false;
  const baseOrigin = validateLoopbackBaseUrl(options.baseUrl ?? "http://localhost:3000");

  const anchorTime = nowFn();
  const startsAt = new Date(anchorTime.getTime() + DAYS_TO_START * MS_PER_DAY).toISOString();
  const registrationDeadline = new Date(
    anchorTime.getTime() + DAYS_TO_DEADLINE * MS_PER_DAY,
  ).toISOString();

  if (dryRun) {
    log(`[seed] Dry run (target: ${baseOrigin}, no requests will be sent)`);
    log("[seed] Demo accounts share one local-only password (see DEMO_PASSWORD).");
    log(`[seed] Planned organizations (${SEED_ORGS.length}):`);
    for (const org of SEED_ORGS) {
      log(`[seed]   - ${org.name} (slug: ${org.slug})`);
    }
    log(`[seed] Planned users (${SEED_USERS.length}):`);
    for (const u of SEED_USERS) {
      log(`[seed]   - ${u.email} (${u.orgKey}, role: ${u.role})`);
    }
    log(
      `[seed] Planned events (${SEED_EVENTS.length}, startsAt: ${startsAt}, registrationDeadline: ${registrationDeadline}):`,
    );
    for (const ev of SEED_EVENTS) {
      log(
        `[seed]   - ${ev.title} (${ev.orgKey}, capacity: ${ev.capacity}, registrations: ${ev.registerKeys.length})`,
      );
    }
    return "dry-run";
  }

  log(`[seed] Starting seed against ${baseOrigin}`);
  log("[seed] Demo accounts share one local-only password (see DEMO_PASSWORD).");

  const jars = new Map<UserKey, CookieJar>();
  for (const userSpec of SEED_USERS) {
    jars.set(userSpec.key, new CookieJar());
  }

  // 1. Register users (first user checks for already-seeded; sleep 4000ms before subsequent sign-ups)
  for (let i = 0; i < SEED_USERS.length; i += 1) {
    const userSpec = SEED_USERS[i];
    if (i > 0) {
      await sleepFn(SIGN_UP_DELAY_MS);
    }
    const stepName = `sign-up ${userSpec.email}`;
    const jar = jars.get(userSpec.key) as CookieJar;
    const res = await requestWithRetry({
      baseOrigin,
      path: "/api/auth/sign-up/email",
      method: "POST",
      body: {
        name: userSpec.name,
        email: userSpec.email,
        password: DEMO_PASSWORD,
      },
      jar,
      stepName,
      fetchFn,
      sleepFn,
    });

    if (i === 0 && res.status === 422) {
      const payload = await readJsonSafe(res);
      const code = extractErrorCode(payload);
      if (code === "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL" || code === "USER_ALREADY_EXISTS") {
        log(`[seed] Already seeded (${userSpec.email} exists). No changes made.`);
        return "already-seeded";
      }
    }

    if (!res.ok) {
      throw new Error(`Failed at step "${stepName}": HTTP ${res.status}`);
    }

    log(`[seed] Signed up ${userSpec.email} (${userSpec.role})`);
  }

  // 2. Owners create organizations
  const orgIds = new Map<OrgKey, string>();
  for (const orgSpec of SEED_ORGS) {
    const stepName = `create organization ${orgSpec.name}`;
    const ownerJar = jars.get(orgSpec.ownerKey) as CookieJar;
    const res = await requestWithRetry({
      baseOrigin,
      path: "/api/auth/organization/create",
      method: "POST",
      body: {
        name: orgSpec.name,
        slug: orgSpec.slug,
      },
      jar: ownerJar,
      stepName,
      fetchFn,
      sleepFn,
    });

    if (!res.ok) {
      throw new Error(`Failed at step "${stepName}": HTTP ${res.status}`);
    }

    const data = await readJsonSafe(res);
    if (!isRecord(data) || typeof data.id !== "string" || data.id.length === 0) {
      throw new Error(`Failed at step "${stepName}": missing organization id`);
    }

    orgIds.set(orgSpec.key, data.id);
    log(`[seed] Created organization: ${orgSpec.name} (${orgSpec.slug})`);
  }

  // 3. Owners invite members & members accept invitations
  for (const userSpec of SEED_USERS) {
    if (userSpec.role === "owner") {
      continue;
    }
    const orgSpec = SEED_ORGS.find((o) => o.key === userSpec.orgKey) as SeedOrgSpec;
    const orgId = orgIds.get(orgSpec.key) as string;
    const ownerJar = jars.get(orgSpec.ownerKey) as CookieJar;
    const inviteStep = `invite member ${userSpec.email} to ${orgSpec.name}`;

    const inviteRes = await requestWithRetry({
      baseOrigin,
      path: "/api/auth/organization/invite-member",
      method: "POST",
      body: {
        email: userSpec.email,
        role: userSpec.role,
        organizationId: orgId,
      },
      jar: ownerJar,
      stepName: inviteStep,
      fetchFn,
      sleepFn,
    });

    if (!inviteRes.ok) {
      throw new Error(`Failed at step "${inviteStep}": HTTP ${inviteRes.status}`);
    }

    const inviteData = await readJsonSafe(inviteRes);
    if (!isRecord(inviteData) || typeof inviteData.id !== "string" || inviteData.id.length === 0) {
      throw new Error(`Failed at step "${inviteStep}": missing invitation id`);
    }

    const invitationId = inviteData.id;
    const memberJar = jars.get(userSpec.key) as CookieJar;
    const acceptStep = `accept invitation for ${userSpec.email} in ${orgSpec.name}`;

    const acceptRes = await requestWithRetry({
      baseOrigin,
      path: "/api/auth/organization/accept-invitation",
      method: "POST",
      body: {
        invitationId,
      },
      jar: memberJar,
      stepName: acceptStep,
      fetchFn,
      sleepFn,
    });

    if (!acceptRes.ok) {
      throw new Error(`Failed at step "${acceptStep}": HTTP ${acceptRes.status}`);
    }

    log(`[seed] Member joined ${orgSpec.name}: ${userSpec.email} (${userSpec.role})`);
  }

  // 4. Owners create events & members register
  for (const eventSpec of SEED_EVENTS) {
    const orgSpec = SEED_ORGS.find((o) => o.key === eventSpec.orgKey) as SeedOrgSpec;
    const orgId = orgIds.get(orgSpec.key) as string;
    const ownerJar = jars.get(orgSpec.ownerKey) as CookieJar;
    const createEventStep = `create event "${eventSpec.title}" in ${orgSpec.name}`;

    const eventRes = await requestWithRetry({
      baseOrigin,
      path: `/api/orgs/${orgId}/events`,
      method: "POST",
      body: {
        title: eventSpec.title,
        description: eventSpec.description,
        startsAt,
        registrationDeadline,
        capacity: eventSpec.capacity,
      },
      jar: ownerJar,
      stepName: createEventStep,
      fetchFn,
      sleepFn,
    });

    if (eventRes.status !== 201) {
      throw new Error(`Failed at step "${createEventStep}": HTTP ${eventRes.status}`);
    }

    const eventData = await readJsonSafe(eventRes);
    if (!isRecord(eventData) || typeof eventData.id !== "string" || eventData.id.length === 0) {
      throw new Error(`Failed at step "${createEventStep}": missing event id`);
    }

    const eventId = eventData.id;
    let confirmed = 0;
    let waitlisted = 0;

    for (const memberKey of eventSpec.registerKeys) {
      const memberSpec = SEED_USERS.find((u) => u.key === memberKey) as SeedUserSpec;
      const memberJar = jars.get(memberKey) as CookieJar;
      const registerStep = `register ${memberSpec.email} for "${eventSpec.title}"`;

      const regRes = await requestWithRetry({
        baseOrigin,
        path: `/api/orgs/${orgId}/events/${eventId}/registrations`,
        method: "POST",
        body: {},
        jar: memberJar,
        stepName: registerStep,
        fetchFn,
        sleepFn,
      });

      if (regRes.status !== 201) {
        throw new Error(`Failed at step "${registerStep}": HTTP ${regRes.status}`);
      }

      const regData = await readJsonSafe(regRes);
      const regStatus =
        isRecord(regData) && typeof regData.status === "string" ? regData.status : "";
      if (regStatus === "confirmed") {
        confirmed += 1;
      } else if (regStatus === "waitlisted") {
        waitlisted += 1;
      } else {
        throw new Error(`Failed at step "${registerStep}": unexpected registration status`);
      }
    }

    log(
      `[seed] Event "${eventSpec.title}" (${orgSpec.name}): capacity=${eventSpec.capacity}, confirmed=${confirmed}, waitlisted=${waitlisted}`,
    );
  }

  log("[seed] Seed completed successfully.");
  return "seeded";
}

export async function executeSeedCli(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  deps: Partial<SeedDependencies> = {},
): Promise<number> {
  const log = deps.log ?? defaultLog;
  const dryRun = argv.includes("--dry-run");
  const rawBaseUrl = env.SEED_BASE_URL ?? "http://localhost:3000";

  let validatedBaseUrl: string;
  try {
    validatedBaseUrl = validateLoopbackBaseUrl(rawBaseUrl);
  } catch (err) {
    log(`[seed] ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  try {
    const outcome = await runSeed({
      ...deps,
      baseUrl: validatedBaseUrl,
      dryRun,
    });
    if (outcome === "already-seeded") {
      return 3;
    }
    return 0;
  } catch (err) {
    log(`[seed] ${err instanceof Error ? err.message : String(err)}`);
    log("[seed] 已创建的数据无法回滚，外键为 RESTRICT");
    return 1;
  }
}

if (import.meta.main) {
  executeSeedCli(process.argv.slice(2), process.env)
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      console.error(`[seed] ${err instanceof Error ? err.message : String(err)}`);
      console.error("[seed] 已创建的数据无法回滚，外键为 RESTRICT");
      process.exitCode = 1;
    });
}
