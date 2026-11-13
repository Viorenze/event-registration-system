import { expect, newUserContext, test } from "./fixtures.ts";
import { createE2eDb, generateTestCredentials, getEventDateTimes } from "./helpers.ts";

test.describe("E2 End-to-End Test: Cancel Registration and Waitlist Promotion", () => {
  let e2eDb: ReturnType<typeof createE2eDb>;

  test.beforeAll(() => {
    e2eDb = createE2eDb();
  });

  test.afterAll(async () => {
    if (e2eDb) {
      await e2eDb.close();
    }
  });

  test("cancels registration and promotes waitlisted user", async ({ page }) => {
    const credsA = generateTestCredentials();
    const credsB = generateTestCredentials();
    const randSuffix = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const teamName = `Team-${randSuffix}`;
    const eventTitle = `Event-${randSuffix}`;
    const { startsAtFormatted, registrationDeadlineFormatted } = getEventDateTimes();

    // 1. A 注册、建团队、建活动（名额 1），A 报名，UI 显示已确认。查库：A 的报名 confirmed。
    await page.goto("/");
    await page.getByRole("button", { name: "没有账号？点击注册" }).click();
    await page.getByLabel("姓名").fill(credsA.name);
    await page.getByLabel("邮箱").fill(credsA.email);
    await page.getByLabel("密码").fill(credsA.password);
    await page.getByRole("button", { name: "注册" }).click();
    await expect(page.getByText(`当前用户：${credsA.name}`)).toBeVisible();

    await page.getByLabel("团队名称").fill(teamName);
    await page.getByRole("button", { name: "创建团队" }).click();
    const teamLink = page.getByRole("link", { name: teamName });
    await expect(teamLink).toBeVisible();
    await teamLink.click();

    await page.getByLabel("活动标题").fill(eventTitle);
    await page.getByLabel("开始时间").fill(startsAtFormatted);
    await page.getByLabel("报名截止时间").fill(registrationDeadlineFormatted);
    await page.getByLabel("活动名额").fill("1");
    await page.getByRole("button", { name: "创建活动" }).click();

    const eventLink = page.getByRole("link", { name: new RegExp(eventTitle) });
    await expect(eventLink).toBeVisible();
    await eventLink.click();

    await expect(page).toHaveURL(/\/orgs\/[^/]+\/events\/[^/]+$/);
    const eventUrlParts = new URL(page.url()).pathname.split("/");
    const orgId = eventUrlParts[2];
    const eventId = eventUrlParts[4];
    expect(orgId).toBeTruthy();
    expect(eventId).toBeTruthy();

    await page.getByRole("button", { name: "报名" }).click();
    const statusContainerA = page.getByText("我的状态：").locator("..");
    await expect(statusContainerA.getByText("已确认", { exact: true })).toBeVisible();
    await expect(page.getByText("已确认 1/1")).toBeVisible();

    const usersA = await e2eDb.db
      .select()
      .from(e2eDb.schema.user)
      .where(e2eDb.eq(e2eDb.schema.user.email, credsA.email));
    expect(usersA.length).toBe(1);
    const userAId = usersA[0].id;

    const regA1 = await e2eDb.db
      .select()
      .from(e2eDb.schema.registrations)
      .where(
        e2eDb.and(
          e2eDb.eq(e2eDb.schema.registrations.eventId, eventId),
          e2eDb.eq(e2eDb.schema.registrations.userId, userAId),
        ),
      );
    expect(regA1.length).toBe(1);
    expect(regA1[0].status).toBe("confirmed");

    // 2. B 的凭据先生成（已在前面生成 credsB）。A 在 UI 里邀请 B 的邮箱（角色保持默认 member；断言角色下拉只有 member 和 admin 两个选项）
    await page.goto(`/orgs/${orgId}/members`);
    const roleSelect = page.getByLabel("角色");
    await expect(roleSelect).toBeVisible();
    await expect(roleSelect.locator("option")).toHaveCount(2);
    const options = await roleSelect.locator("option").all();
    const optValues = await Promise.all(options.map((o) => o.getAttribute("value")));
    expect(optValues.sort((a, b) => (a ?? "").localeCompare(b ?? ""))).toEqual(["admin", "member"]);
    expect(await roleSelect.inputValue()).toBe("member");

    await page.getByLabel("被邀请人邮箱").fill(credsB.email);
    await page.getByRole("button", { name: "创建邀请" }).click();

    const readonlyInput = page.locator("input[readonly]");
    await expect(readonlyInput).toBeVisible();
    const rawLink = await readonlyInput.inputValue();

    const hasValidInviteFormat =
      typeof rawLink === "string" &&
      rawLink.includes("/invite#") &&
      rawLink.split("/invite#")[1].length > 0;
    if (!hasValidInviteFormat) {
      throw new Error("Invalid invitation link format");
    }

    // 3. 用 newUserContext 打开 B 的独立上下文，打开邀请链接，B 在邀请页里注册（邮箱必须是被邀请的那个），接受邀请。
    const contextB = await newUserContext(page.context().browser()!, test.info());
    try {
      const pageB = await contextB.newPage();
      try {
        await pageB.goto(rawLink);
      } catch {
        throw new Error("Failed to navigate to invitation page");
      }

      await expect(pageB.getByText("邀请接受")).toBeVisible();
      await pageB.getByRole("button", { name: "没有账号？点击注册" }).click();
      await pageB.getByLabel("姓名").fill(credsB.name);
      await pageB.getByLabel("邮箱").fill(credsB.email);
      await pageB.getByLabel("密码").fill(credsB.password);
      await pageB.getByRole("button", { name: "注册" }).click();

      const acceptBtn = pageB.getByRole("button", { name: "接受邀请" });
      await expect(acceptBtn).toBeVisible();
      await acceptBtn.click();

      await expect(pageB.getByText("已加入团队")).toBeVisible();
      await expect.poll(() => pageB.url().includes("#")).toBe(false);

      const usersB = await e2eDb.db
        .select()
        .from(e2eDb.schema.user)
        .where(e2eDb.eq(e2eDb.schema.user.email, credsB.email));
      expect(usersB.length).toBe(1);
      const userBId = usersB[0].id;

      const membersB = await e2eDb.db
        .select()
        .from(e2eDb.schema.member)
        .where(
          e2eDb.and(
            e2eDb.eq(e2eDb.schema.member.organizationId, orgId),
            e2eDb.eq(e2eDb.schema.member.userId, userBId),
          ),
        );
      expect(membersB.length).toBe(1);
      expect(membersB[0].role).toBe("member");

      // 4. B 打开该活动详情页（用只含路径的 URL，由 A 的页面 URL 提取 orgId 与 eventId），报名，UI 显示“候补中”。
      await pageB.goto(`/orgs/${orgId}/events/${eventId}`);
      await expect(pageB.getByText(eventTitle)).toBeVisible();
      await pageB.getByRole("button", { name: "报名" }).click();
      const statusContainerB = pageB.getByText("我的状态：").locator("..");
      await expect(statusContainerB.getByText("候补中", { exact: true })).toBeVisible();

      const allRegs4 = await e2eDb.db
        .select()
        .from(e2eDb.schema.registrations)
        .where(e2eDb.eq(e2eDb.schema.registrations.eventId, eventId));
      expect(allRegs4.length).toBe(2);
      const regB4 = allRegs4.find((r) => r.userId === userBId);
      const regA4 = allRegs4.find((r) => r.userId === userAId);
      expect(regB4?.status).toBe("waitlisted");
      expect(regA4?.status).toBe("confirmed");

      // 5. A 取消报名：page.on("dialog", d => d.accept()) 必须在点击之前注册；A 页面显示未报名。
      await page.goto(`/orgs/${orgId}/events/${eventId}`);
      const statusContainerA2 = page.getByText("我的状态：").locator("..");
      await expect(statusContainerA2.getByText("已确认", { exact: true })).toBeVisible();

      page.on("dialog", async (dialog) => {
        await dialog.accept();
      });
      await page.getByRole("button", { name: "取消报名" }).click();
      await expect(statusContainerA2.getByText("未报名", { exact: true })).toBeVisible();

      const regA5 = await e2eDb.db
        .select()
        .from(e2eDb.schema.registrations)
        .where(
          e2eDb.and(
            e2eDb.eq(e2eDb.schema.registrations.eventId, eventId),
            e2eDb.eq(e2eDb.schema.registrations.userId, userAId),
          ),
        );
      expect(regA5.length).toBe(1);
      expect(regA5[0].status).toBe("cancelled");
      expect(regA5[0].cancelledAt).not.toBeNull();

      // 6. B 刷新（reload），UI 显示“已确认”。查库：B 的行 confirmed，A 的行 cancelled，该活动 confirmed 条数 = 1 = 名额。
      await pageB.reload();
      const statusContainerB2 = pageB.getByText("我的状态：").locator("..");
      await expect(statusContainerB2.getByText("已确认", { exact: true })).toBeVisible();
      await expect(pageB.getByText("已确认 1/1")).toBeVisible();

      const allRegs6 = await e2eDb.db
        .select()
        .from(e2eDb.schema.registrations)
        .where(e2eDb.eq(e2eDb.schema.registrations.eventId, eventId));
      const regB6 = allRegs6.find((r) => r.userId === userBId);
      const regA6 = allRegs6.find((r) => r.userId === userAId);
      expect(regB6?.status).toBe("confirmed");
      expect(regA6?.status).toBe("cancelled");
      const confirmedCount = allRegs6.filter((r) => r.status === "confirmed").length;
      expect(confirmedCount).toBe(1);
    } finally {
      await contextB.close();
    }
  });
});
