import { expect, test } from "./fixtures.ts";
import { createE2eDb, generateTestCredentials, getEventDateTimes } from "./helpers.ts";

test.describe("E1 End-to-End Test: Sign up, Create Team, Create Event, Register", () => {
  let e2eDb: ReturnType<typeof createE2eDb>;

  test.beforeAll(() => {
    e2eDb = createE2eDb();
  });

  test.afterAll(async () => {
    if (e2eDb) {
      await e2eDb.close();
    }
  });

  test("completes full registration flow and confirms in database", async ({ page }) => {
    const creds = generateTestCredentials();
    const teamName = `Team-${Date.now()}`;
    const eventTitle = `Event-${Date.now()}`;

    // 1. Visit homepage & Sign up
    await page.goto("/");
    await page.getByRole("button", { name: "没有账号？点击注册" }).click();
    await page.getByLabel("姓名").fill(creds.name);
    await page.getByLabel("邮箱").fill(creds.email);
    await page.getByLabel("密码").fill(creds.password);
    await page.getByRole("button", { name: "注册" }).click();

    // Verify logged in
    await expect(page.getByText(`当前用户：${creds.name}`)).toBeVisible();

    // 2. Create team
    await page.getByLabel("团队名称").fill(teamName);
    await page.getByRole("button", { name: "创建团队" }).click();

    // Click into team
    const teamLink = page.getByRole("link", { name: teamName });
    await expect(teamLink).toBeVisible();
    await teamLink.click();

    // 3. Team Page: Verify header and extract orgId
    await expect(page).toHaveURL(/\/orgs\/[^/]+$/);
    await expect(page.getByRole("heading", { name: "活动列表" })).toBeVisible();
    const orgUrlParts = new URL(page.url()).pathname.split("/");
    const orgId = orgUrlParts[2];
    expect(orgId).toBeTruthy();

    // 4. Create event
    const { startsAtFormatted, registrationDeadlineFormatted } = getEventDateTimes();
    await page.getByLabel("活动标题").fill(eventTitle);
    await page.getByLabel("开始时间").fill(startsAtFormatted);
    await page.getByLabel("报名截止时间").fill(registrationDeadlineFormatted);
    await page.getByLabel("活动名额").fill("10");
    await page.getByRole("button", { name: "创建活动" }).click();

    // Click into event
    const eventLink = page.getByRole("link", { name: new RegExp(eventTitle) });
    await expect(eventLink).toBeVisible();
    await eventLink.click();

    // 5. Event Detail Page: Verify header, extract eventId, register
    await expect(page).toHaveURL(/\/orgs\/[^/]+\/events\/[^/]+$/);
    const eventUrlParts = new URL(page.url()).pathname.split("/");
    const eventId = eventUrlParts[4];
    expect(eventId).toBeTruthy();
    await expect(
      page.locator("[data-slot=card-title]").filter({ hasText: eventTitle }),
    ).toBeVisible();

    // Verify initial status is 未报名
    const statusContainer = page.getByText("我的状态：").locator("..");
    await expect(statusContainer.getByText("未报名")).toBeVisible();

    // Click register button
    const registerButton = page.getByRole("button", { name: "报名" });
    await expect(registerButton).toBeVisible();
    await registerButton.click();

    // 6. Assert UI displays "已确认"
    await expect(statusContainer.getByText("已确认", { exact: true })).toBeVisible();
    await expect(page.getByText("已确认 1/10")).toBeVisible();

    // 7. Database assertion: verify registration status in DB is confirmed
    const userRows = await e2eDb.db
      .select({ id: e2eDb.schema.user.id })
      .from(e2eDb.schema.user)
      .where(e2eDb.eq(e2eDb.schema.user.email, creds.email));
    expect(userRows.length).toBe(1);
    const userId = userRows[0].id;

    const regRows = await e2eDb.db
      .select({
        id: e2eDb.schema.registrations.id,
        status: e2eDb.schema.registrations.status,
        organizationId: e2eDb.schema.registrations.organizationId,
        eventId: e2eDb.schema.registrations.eventId,
      })
      .from(e2eDb.schema.registrations)
      .where(
        e2eDb.and(
          e2eDb.eq(e2eDb.schema.registrations.eventId, eventId),
          e2eDb.eq(e2eDb.schema.registrations.userId, userId),
        ),
      );

    expect(regRows.length).toBe(1);
    expect(regRows[0].status).toBe("confirmed");
    expect(regRows[0].organizationId).toBe(orgId);
  });
});
