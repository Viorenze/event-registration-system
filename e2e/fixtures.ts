import {
  type Browser,
  type BrowserContext,
  expect,
  test as base,
  type TestInfo,
} from "@playwright/test";

/**
 * 为什么在当前部署中基于 x-forwarded-for 的隔离方案成立：
 * 1. apps/web 在向后端转发请求时，对 x-forwarded-for 使用 ??= 保留客户端传入的值（若有）；
 * 2. apps/api 中 Better Auth 限流插件在未配置 trustedProxies 时，将 x-forwarded-for 中的单值视为客户端真实 IP 进行按 IP 限流计数。
 *
 * 已知限制：
 * 此机制意味着外部客户端若伪造 x-forwarded-for 头部可以绕过限流计数，本阶段作为 E2E 测试环境的限流隔离方案使用，已知该限制并在本阶段不作处理。
 */

let ipCounter = Math.floor(Math.random() * 200) + 1;

export function getUniqueIp(): string {
  // 生成 TEST-NET-3 (203.0.113.1 ~ 203.0.113.250) 单个 IPv4 地址（RFC 5737）
  const n = (ipCounter++ % 250) + 1;
  return `203.0.113.${n}`;
}

export async function newUserContext(
  browser: Browser,
  testInfo: TestInfo,
): Promise<BrowserContext> {
  const baseURL = testInfo.project.use.baseURL;
  const ip = getUniqueIp();
  return await browser.newContext({
    baseURL,
    extraHTTPHeaders: {
      "x-forwarded-for": ip,
    },
  });
}

export const test = base.extend<{}>({
  context: async ({ browser, contextOptions }, use) => {
    const ip = getUniqueIp();
    const context = await browser.newContext({
      ...contextOptions,
      extraHTTPHeaders: {
        ...contextOptions?.extraHTTPHeaders,
        "x-forwarded-for": ip,
      },
    });
    await use(context);
    await context.close();
  },
});

export { expect };
