import { expect, newUserContext, test } from "./fixtures.ts";
import { createE2eDb, generateTestCredentials, getEventDateTimes } from "./helpers.ts";

test.describe("E3 End-to-End Test: Organization Isolation in Browser", () => {
  let e2eDb: ReturnType<typeof createE2eDb>;

  test.beforeAll(() => {
    e2eDb = createE2eDb();
  });

  test.afterAll(async () => {
    if (e2eDb) {
      await e2eDb.close();
    }
  });

  test("verifies organization isolation between tenants in browser and database", async ({
    page,
  }) => {
    const credsA = generateTestCredentials();
    const credsB = generateTestCredentials();
    const randSuffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const teamNameA = `TeamA-${randSuffix}`;
    const eventTitleA = `EventA-${randSuffix}`;
    const { startsAtFormatted, registrationDeadlineFormatted } = getEventDateTimes();

    // 1. A 注册、建团队、建活动；A 自己的团队页能看到该活动标题（作为选择器有效的正向对照）。记录活动行的完整内容快照（查库）。
    await page.goto("/");
    await page.getByRole("button", { name: "没有账号？点击注册" }).click();
    await page.getByLabel("姓名").fill(credsA.name);
    await page.getByLabel("邮箱").fill(credsA.email);
    await page.getByLabel("密码").fill(credsA.password);
    await page.getByRole("button", { name: "注册" }).click();
    await expect(page.getByText(`当前用户：${credsA.name}`)).toBeVisible();

    await page.getByLabel("团队名称").fill(teamNameA);
    await page.getByRole("button", { name: "创建团队" }).click();
    const teamLinkA = page.getByRole("link", { name: teamNameA });
    await expect(teamLinkA).toBeVisible();
    await teamLinkA.click();

    await expect(page).toHaveURL(/\/orgs\/[^/]+$/);
    const orgUrlParts = new URL(page.url()).pathname.split("/");
    const orgIdA = orgUrlParts[2];
    expect(orgIdA).toBeTruthy();

    await page.getByLabel("活动标题").fill(eventTitleA);
    await page.getByLabel("开始时间").fill(startsAtFormatted);
    await page.getByLabel("报名截止时间").fill(registrationDeadlineFormatted);
    await page.getByLabel("活动名额").fill("5");
    await page.getByRole("button", { name: "创建活动" }).click();

    const eventLinkA = page.getByRole("link", { name: new RegExp(eventTitleA) });
    await expect(page.getByText(eventTitleA)).toBeVisible();
    await expect(eventLinkA).toBeVisible();
    await eventLinkA.click();

    await expect(page).toHaveURL(/\/orgs\/[^/]+\/events\/[^/]+$/);
    const eventUrlParts = new URL(page.url()).pathname.split("/");
    const eventIdA = eventUrlParts[4];
    expect(eventIdA).toBeTruthy();

    const eventRows = await e2eDb.db
      .select()
      .from(e2eDb.schema.events)
      .where(e2eDb.eq(e2eDb.schema.events.id, eventIdA));
    expect(eventRows.length).toBe(1);
    const eventSnapshot = { ...eventRows[0] };

    // 2. B 用独立上下文注册、建自己的团队。B 的团队页：先等页面进入“已加载”状态，再断言 A 的活动标题 count = 0。
    const contextB = await newUserContext(page.context().browser()!, test.info());
    try {
      const pageB = await contextB.newPage();
      await pageB.goto("/");
      await pageB.getByRole("button", { name: "没有账号？点击注册" }).click();
      await pageB.getByLabel("姓名").fill(credsB.name);
      await pageB.getByLabel("邮箱").fill(credsB.email);
      await pageB.getByLabel("密码").fill(credsB.password);
      await pageB.getByRole("button", { name: "注册" }).click();
      await expect(pageB.getByText(`当前用户：${credsB.name}`)).toBeVisible();

      const teamNameB = `TeamB-${randSuffix}`;
      await pageB.getByLabel("团队名称").fill(teamNameB);
      await pageB.getByRole("button", { name: "创建团队" }).click();
      const teamLinkB = pageB.getByRole("link", { name: teamNameB });
      await expect(teamLinkB).toBeVisible();
      await teamLinkB.click();

      await expect(pageB).toHaveURL(/\/orgs\/[^/]+$/);
      await expect(pageB.getByText("暂无活动")).toBeVisible();
      await expect(pageB.getByText(eventTitleA)).toHaveCount(0);

      // 3. B 直接打开 A 的团队页 URL，断言步骤 1.6 找到的“访问受限”精确文案可见。再直接打开 A 的活动详情 URL，同样断言。
      await pageB.goto(`/orgs/${orgIdA}`);
      await expect(pageB.getByText("访问受限", { exact: true })).toBeVisible();
      await expect(pageB.getByText("你不是该团队成员，或无权访问该团队")).toBeVisible();

      await pageB.goto(`/orgs/${orgIdA}/events/${eventIdA}`);
      await expect(pageB.getByText("访问受限", { exact: true })).toBeVisible();
      await expect(pageB.getByText("你不是该团队成员，或无权访问该团队")).toBeVisible();

      // 4. 查库：B 对 A 的活动没有报名行；A 的活动行与步骤 3.1 的快照逐字段相同；A 的团队下 B 没有 member 行。
      const usersB = await e2eDb.db
        .select()
        .from(e2eDb.schema.user)
        .where(e2eDb.eq(e2eDb.schema.user.email, credsB.email));
      expect(usersB.length).toBe(1);
      const userBId = usersB[0].id;

      const bRegs = await e2eDb.db
        .select()
        .from(e2eDb.schema.registrations)
        .where(
          e2eDb.and(
            e2eDb.eq(e2eDb.schema.registrations.eventId, eventIdA),
            e2eDb.eq(e2eDb.schema.registrations.userId, userBId),
          ),
        );
      expect(bRegs.length).toBe(0);

      const currentEventRows = await e2eDb.db
        .select()
        .from(e2eDb.schema.events)
        .where(e2eDb.eq(e2eDb.schema.events.id, eventIdA));
      expect(currentEventRows.length).toBe(1);
      expect(currentEventRows[0]).toEqual(eventSnapshot);

      const bMembersInA = await e2eDb.db
        .select()
        .from(e2eDb.schema.member)
        .where(
          e2eDb.and(
            e2eDb.eq(e2eDb.schema.member.organizationId, orgIdA),
            e2eDb.eq(e2eDb.schema.member.userId, userBId),
          ),
        );
      expect(bMembersInA.length).toBe(0);
    } finally {
      await contextB.close();
    }
  });
});
