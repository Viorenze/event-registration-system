import { expect, test } from "./fixtures.ts";
import { createE2eDb, generateTestCredentials } from "./helpers.ts";

test.describe("E0 End-to-End Test: Browser Authentication Flow", () => {
  let e2eDb: ReturnType<typeof createE2eDb>;

  test.beforeAll(() => {
    e2eDb = createE2eDb();
  });

  test.afterAll(async () => {
    if (e2eDb) {
      await e2eDb.close();
    }
  });

  test("completes sign up, sign out, persistence after reload, and sign in", async ({
    page,
    context,
  }) => {
    const creds = generateTestCredentials();

    // 1. 注册
    await page.goto("/");
    await page.getByRole("button", { name: "没有账号？点击注册" }).click();
    await page.getByLabel("姓名").fill(creds.name);
    await page.getByLabel("邮箱").fill(creds.email);
    await page.getByLabel("密码").fill(creds.password);
    await page.getByRole("button", { name: "注册" }).click();

    // 断言“当前用户：<name>”可见
    await expect(page.getByText(`当前用户：${creds.name}`)).toBeVisible();

    // 查库：该用户的 session 行数 = 1
    const users1 = await e2eDb.db
      .select()
      .from(e2eDb.schema.user)
      .where(e2eDb.eq(e2eDb.schema.user.email, creds.email));
    expect(users1.length).toBe(1);
    const userId = users1[0].id;

    const sessions1 = await e2eDb.db
      .select()
      .from(e2eDb.schema.session)
      .where(e2eDb.eq(e2eDb.schema.session.userId, userId));
    expect(sessions1.length).toBe(1);

    // 2. 点退出，同时用 page.waitForResponse 断言：POST、URL 含 /api/auth/sign-out、状态 200
    const [signOutResponse] = await Promise.all([
      page.waitForResponse(
        (resp) =>
          resp.request().method() === "POST" &&
          resp.url().includes("/api/auth/sign-out") &&
          resp.status() === 200,
      ),
      page.getByRole("button", { name: "退出" }).click(),
    ]);
    expect(signOutResponse.status()).toBe(200);

    // 页面上没有步骤 1.1 找到的错误提示
    await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toHaveCount(0);

    // 回到登录表单
    await expect(page.getByRole("button", { name: "登录" })).toBeVisible();

    // 查库：该用户的 session 行数 = 0
    const sessions2 = await e2eDb.db
      .select()
      .from(e2eDb.schema.session)
      .where(e2eDb.eq(e2eDb.schema.session.userId, userId));
    expect(sessions2.length).toBe(0);

    // 3. page.reload() 后仍是未登录（登录表单可见）
    await page.reload();
    await expect(page.getByRole("button", { name: "登录" })).toBeVisible();
    await expect(page.getByText("当前用户：")).toHaveCount(0);

    // 4. 再登录，断言“当前用户：<name>”可见
    await page.getByLabel("邮箱").fill(creds.email);
    await page.getByLabel("密码").fill(creds.password);
    await page.getByRole("button", { name: "登录" }).click();
    await expect(page.getByText(`当前用户：${creds.name}`)).toBeVisible();

    // 用 context.request.get("/api/auth/get-session") 取会话，只断言 user.email 等于该邮箱
    const sessionResp = await context.request.get("/api/auth/get-session");
    expect(sessionResp.status()).toBe(200);
    const sessionData = await sessionResp.json();
    expect(sessionData?.user?.email).toBe(creds.email);

    // 查库：session 行数 = 1
    const sessions3 = await e2eDb.db
      .select()
      .from(e2eDb.schema.session)
      .where(e2eDb.eq(e2eDb.schema.session.userId, userId));
    expect(sessions3.length).toBe(1);
  });
});
