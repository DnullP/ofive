/**
 * @module e2e/calendar-task-link
 * @description 日历与任务看板联动回归：任务 start/end 和 every 周期应进入日历日期详情。
 * @dependencies
 *   - @playwright/test
 *   - ./helpers/mockVault
 */

import { expect, test, type Locator, type Page } from "@playwright/test";
import { gotoMockVaultPage } from "./helpers/mockVault";

type LocatorBox = NonNullable<Awaited<ReturnType<Locator["boundingBox"]>>>;

async function waitForLayoutReady(page: Page): Promise<void> {
    await page.getByRole("main", { name: "Dockview Main Area" }).waitFor({ state: "visible" });
}

async function injectCalendarTaskScenario(page: Page): Promise<void> {
    await page.evaluate(async () => {
        const { loadBrowserMockMarkdownContents } = await import("/src/api/vaultBrowserMockFixtures.ts");
        const contents = await loadBrowserMockMarkdownContents();
        contents["test-resources/notes/calendar-task-overlap-e2e.md"] = [
            "---",
            "title: Calendar Task Overlay",
            "date: 2026-03-24",
            "---",
            "# Calendar Task Overlay",
            "",
            "- [ ] Overlap planning start:2026-03-24 13:00 end:2026-03-26 14:00 !medium",
            "- [ ] Same day focus block start:2026-03-24 15:00 end:2026-03-24 16:00 !low",
            "- [ ] Weekly Tuesday review start:2026-03-24 08:00 every:weekly-tue !medium",
            "- [ ] Monthly sync end:2026-03-24 17:00 every:monthly-24 !low",
        ].join("\n");
    });
}

async function primeCalendarState(page: Page, dayKey: string): Promise<void> {
    await page.evaluate(async (selectedDayKey) => {
        const module = await import("/src/plugins/calendar/calendarViewState.ts");
        module.setCalendarViewState("calendar", {
            anchorDayKey: "2026-03-01",
            selectedDayKey,
        });
    }, dayKey);
}

function getCalendarDay(calendarTab: Locator, dayNumber: number): Locator {
    return calendarTab
        .locator(".calendar-tab__day:not(.calendar-tab__day--outside) .calendar-tab__day-number")
        .filter({ hasText: new RegExp(`^${String(dayNumber)}$`) })
        .locator("xpath=ancestor::button[contains(@class, 'calendar-tab__day')][1]")
        .first();
}

async function readBackgroundColor(locator: Locator): Promise<string> {
    return locator.evaluate((element) => getComputedStyle(element).backgroundColor);
}

async function requireBox(locator: Locator, label: string): Promise<LocatorBox> {
    const box = await locator.boundingBox();
    expect(box, `${label} should have a visible bounding box`).not.toBeNull();
    return box as LocatorBox;
}

function boxesOverlap(left: LocatorBox, right: LocatorBox): boolean {
    return left.x < right.x + right.width
        && left.x + left.width > right.x
        && left.y < right.y + right.height
        && left.y + left.height > right.y;
}

test.describe("日历任务联动", () => {
    test("应在开始结束日期和周期实例中展示任务", async ({ page }) => {
        await gotoMockVaultPage(page, "calendar-task-link");
        await waitForLayoutReady(page);
        await injectCalendarTaskScenario(page);
        await primeCalendarState(page, "2026-03-24");

        await page.getByTestId("activity-bar-item-calendar").click();
        const calendarTab = page.locator(".layout-v2-tab-section__card--active .calendar-tab");
        await expect(calendarTab.locator(".calendar-tab__calendar-surface")).toBeVisible();

        const day24 = getCalendarDay(calendarTab, 24);
        const day25 = getCalendarDay(calendarTab, 25);
        const day26 = getCalendarDay(calendarTab, 26);
        const noteBadge = day24.locator(".calendar-tab__day-badge--note");
        const taskBadge = day24.locator(".calendar-tab__day-badge--task");
        await expect(noteBadge).toHaveText("1");
        await expect(taskBadge).toHaveText("3");
        const [noteBadgeColor, taskBadgeColor] = await Promise.all([
            readBackgroundColor(noteBadge),
            readBackgroundColor(taskBadge),
        ]);
        expect(noteBadgeColor).not.toBe(taskBadgeColor);

        const taskBars = calendarTab.locator(".calendar-tab__task-bar");
        const verifyBars = taskBars.filter({ hasText: "Verify task board flow" });
        const overlapBar = taskBars.filter({ hasText: "Overlap planning" }).first();
        const sameDayBar = taskBars.filter({ hasText: "Same day focus block" }).first();
        await expect(verifyBars).toHaveCount(0);
        await expect(overlapBar).toBeVisible();
        await expect(sameDayBar).toBeVisible();
        await expect(taskBars.filter({ hasText: "Weekly Tuesday review" })).toHaveCount(0);
        await expect(taskBars.filter({ hasText: "Monthly sync" })).toHaveCount(0);

        const day24Box = await requireBox(day24, "day 24");
        const day26Box = await requireBox(day26, "day 26");
        const overlapBox = await requireBox(overlapBar, "overlap task bar");
        const sameDayBox = await requireBox(sameDayBar, "same day task bar");

        expect(overlapBox.x).toBeGreaterThanOrEqual(day24Box.x);
        expect(overlapBox.x).toBeLessThan(day24Box.x + 16);
        expect(overlapBox.x + overlapBox.width).toBeGreaterThan(day26Box.x + day26Box.width - 16);
        expect(boxesOverlap(overlapBox, sameDayBox)).toBe(false);

        const details = calendarTab.locator(".calendar-tab__details");
        await expect(details).toContainText("Verify task board flow");
        await expect(details).toContainText("Overlap planning");
        await expect(details).toContainText("Same day focus block");
        await expect(details).toContainText("Weekly Tuesday review");
        await expect(details).toContainText("Monthly sync");
        await expect(details).toContainText(/Task|任务/);
        await expect(details).toContainText(/weekly-tue|每/);

        await day25.click();
        await expect(details).toContainText("Overlap planning");
        await expect(details).not.toContainText("Verify task board flow");

        await getCalendarDay(calendarTab, 31).click();
        await expect(details).toContainText("Verify task board flow");
        await expect(details).toContainText("Weekly Tuesday review");
        await expect(details).not.toContainText("Monthly sync");
    });

    test("任务看板保存时间后已打开日历应实时刷新", async ({ page }) => {
        await gotoMockVaultPage(page, "calendar-task-live-update");
        await waitForLayoutReady(page);
        await primeCalendarState(page, "2026-03-24");

        await page.getByTestId("activity-bar-item-calendar").click();
        const calendarTab = page.locator(".layout-v2-tab-section__card--active .calendar-tab");
        await expect(calendarTab.locator(".calendar-tab__calendar-surface")).toBeVisible();
        const details = calendarTab.locator(".calendar-tab__details");
        await expect(details).toContainText("Verify task board flow");

        await page.getByTestId("activity-bar-item-task-board").click();
        await expect(page.locator(".task-board")).toBeVisible();
        const targetCard = page.locator(".task-board__task-card", { hasText: "Verify task board flow" });
        await targetCard.getByRole("button", { name: /Edit|编辑/ }).click();

        const popover = page.locator(".task-board__popover.is-positioned");
        await expect(popover).toBeVisible();
        await popover.locator(".task-board__input").first().fill("2026-03-26T09:00");
        await popover.locator(".task-board__input").last().fill("2026-03-26T11:00");
        await popover.getByRole("button").filter({ hasText: /Save|保存/ }).click();
        await expect(popover).toHaveCount(0);

        await page.locator(".layout-v2-tab-section__tab-main", { hasText: /Calendar|日历/ }).click();
        await getCalendarDay(calendarTab, 24).click();
        await expect(details).not.toContainText("Verify task board flow");
        await getCalendarDay(calendarTab, 26).click();
        await expect(details).toContainText("Verify task board flow");
    });
});
