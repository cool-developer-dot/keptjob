/**
 * Follow-ups page (Prompt 10). Needs local Supabase with the seed
 * (`npm run db:reset`) and `.env.local`. Test prospects are named
 * `e2e-fu-*`, created with the service role for Riley and deleted afterwards.
 * Counts are asserted relative to what the page shows first, so the spec
 * doesn't depend on the exact seed.
 */
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Locator, type Page } from "@playwright/test";

import { addDaysToDateString, orgToday } from "../src/lib/time";

try {
  process.loadEnvFile(".env.local");
} catch {
  // CI provides env vars directly.
}

const PASSWORD = "Password123!";
const MANAGER = "morgan.manager@example.com";
const REP = "riley.rep@example.com";
const RILEY_ID = "11111111-1111-4111-8111-000000000002";
const SAM_ID = "11111111-1111-4111-8111-000000000003";
const PREFIX = `e2e-fu-${Date.now()}`;

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

let timezone = "America/New_York";

async function createRileyProspect(name: string): Promise<string> {
  const { data, error } = await admin
    .from("prospects")
    .insert({ name: `${PREFIX} ${name}`, company: "Follow Co", owner_id: RILEY_ID, created_by: RILEY_ID })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

async function login(page: Page, email: string, next: string) {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(new RegExp(`${next.replace(/[?]/g, "\\?")}$`));
}

const tabLink = (page: Page, label: string) =>
  page.getByRole("navigation", { name: "Follow-up views" }).getByRole("link", { name: new RegExp(`^${label}`) });

async function tabCount(page: Page, label: string): Promise<number> {
  return Number(await tabLink(page, label).locator("[data-count]").getAttribute("data-count"));
}

/** Sidebar badge count (0 when hidden). */
async function badgeCount(page: Page): Promise<number> {
  const badge = page.locator('[data-nav-badge="/follow-ups"]');
  if ((await badge.count()) === 0) return 0;
  return Number.parseInt(await badge.innerText(), 10);
}

const row = (page: Page, name: string): Locator => page.getByRole("listitem").filter({ hasText: `${PREFIX} ${name}` });

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const { data } = await admin.from("org_settings").select("timezone").single();
  if (data?.timezone) timezone = data.timezone;
});

test.afterAll(async () => {
  await admin.from("prospects").delete().like("name", `${PREFIX}%`);
});

test("rep: tabs, complete → schedule next, reschedule, badge", async ({ page }) => {
  const today = orgToday(timezone);
  const id = await createRileyProspect("Overdue deal");
  await admin.from("follow_ups").insert({
    prospect_id: id,
    owner_id: RILEY_ID,
    due_date: addDaysToDateString(today, -2),
    note: `${PREFIX} send pricing`,
  });
  await admin.from("activities").insert({
    prospect_id: id,
    user_id: RILEY_ID,
    type: "call",
    content: "Discussed the pricing tiers with their finance lead.",
  });

  await login(page, REP, "/follow-ups");
  await expect(tabLink(page, "Overdue")).toHaveAttribute("aria-current", "page");
  // Reps have no owner filter / owner column.
  await expect(page.getByRole("combobox", { name: "Owner" })).toHaveCount(0);

  const overdue = await tabCount(page, "Overdue");
  const upcoming = await tabCount(page, "Upcoming");
  const todayCount = await tabCount(page, "Today");
  const badge = await badgeCount(page);
  expect(overdue).toBeGreaterThanOrEqual(1);
  expect(badge).toBe(overdue + todayCount);

  const item = row(page, "Overdue deal");
  await expect(item).toContainText("2 days overdue");
  await expect(item).toContainText("Last call");
  await expect(item).toContainText("Discussed the pricing tiers");

  // Complete → toast action → quick form prefilled for the prospect.
  await item.getByRole("button", { name: `Complete follow-up: ${PREFIX} send pricing` }).click();
  await page.getByLabel("Outcome (optional)").fill("Sent the pricing sheet");
  await page.getByRole("button", { name: "Mark complete" }).click();
  await page.getByRole("button", { name: "Schedule next follow-up" }).click();
  const dialog = page.getByRole("dialog", { name: "Schedule next follow-up" });
  await expect(dialog).toContainText(`${PREFIX} Overdue deal`);
  await expect(dialog.getByLabel("Due date")).toHaveValue(addDaysToDateString(today, 1));
  await dialog.getByPlaceholder("e.g. Send the proposal").fill(`${PREFIX} check in`);
  await dialog.getByRole("button", { name: "Schedule follow-up" }).click();
  await expect(dialog).toBeHidden();

  await expect(row(page, "Overdue deal")).toHaveCount(0);
  await expect.poll(() => tabCount(page, "Overdue")).toBe(overdue - 1);
  await expect.poll(() => tabCount(page, "Upcoming")).toBe(upcoming + 1);
  await expect.poll(() => badgeCount(page)).toBe(badge - 1);

  const { data: rows } = await admin
    .from("follow_ups")
    .select("note, status, due_date, completed_by")
    .eq("prospect_id", id)
    .order("created_at");
  expect(rows).toEqual([
    {
      note: `${PREFIX} send pricing`,
      status: "completed",
      due_date: addDaysToDateString(today, -2),
      completed_by: RILEY_ID,
    },
    { note: `${PREFIX} check in`, status: "pending", due_date: addDaysToDateString(today, 1), completed_by: null },
  ]);

  // Completed tab (URL state) shows it.
  await tabLink(page, "Completed").click();
  await expect(page).toHaveURL(/tab=completed/);
  await expect(row(page, "Overdue deal")).toContainText("by you");

  // Reschedule the new one from Upcoming to today → Today tab, badge + 1.
  await tabLink(page, "Upcoming").click();
  await expect(page).toHaveURL(/tab=upcoming/);
  const next = row(page, "Overdue deal");
  await next.getByRole("button", { name: `Reschedule follow-up: ${PREFIX} check in` }).click();
  await page.getByLabel("New due date").fill(today);
  await page.getByRole("button", { name: "Save date" }).click();
  await expect(next).toHaveCount(0);
  await expect.poll(() => tabCount(page, "Today")).toBe(todayCount + 1);
  await expect.poll(() => badgeCount(page)).toBe(badge);
  await tabLink(page, "Today").click();
  await expect(row(page, "Overdue deal")).toContainText("Due today");
});

test("rep: needs attention lists deals without a follow-up; adding one clears it", async ({ page }) => {
  await createRileyProspect("No next step");
  await login(page, REP, "/follow-ups?tab=attention");
  await expect(tabLink(page, "Needs attention")).toHaveAttribute("aria-current", "page");
  const before = await tabCount(page, "Needs attention");

  const item = row(page, "No next step");
  await expect(item.locator('[data-reason="no_follow_up"]')).toHaveText("No follow-up scheduled");
  await expect(item).toContainText("No conversation logged yet");
  // Seed: Marcus Chen is stale with no follow-up (oldest activity → listed first).
  await expect(page.getByRole("list", { name: "Deals that need attention" }).getByRole("link").first()).toHaveText(
    "Marcus Chen",
  );

  await item.getByRole("button", { name: `Add follow-up for ${PREFIX} No next step` }).click();
  const dialog = page.getByRole("dialog", { name: "Schedule follow-up" });
  await dialog.getByPlaceholder("e.g. Send the proposal").fill(`${PREFIX} intro email`);
  await dialog.getByRole("button", { name: "Schedule follow-up" }).click();
  await expect(dialog).toBeHidden();
  await expect(item).toHaveCount(0);
  await expect.poll(() => tabCount(page, "Needs attention")).toBe(before - 1);
});

test("manager: everyone's follow-ups with owner column + filter; badge is their own", async ({ page }) => {
  await login(page, MANAGER, "/follow-ups");
  const list = page.getByRole("list", { name: "overdue follow-ups" });
  await expect(list.locator("[data-owner]").filter({ hasText: "Sam Rep" }).first()).toBeVisible();
  expect(await badgeCount(page)).toBe(0); // Morgan owns no follow-ups

  await page.getByRole("combobox", { name: "Owner" }).click();
  await page.getByRole("option", { name: "Sam Rep" }).click();
  await expect(page).toHaveURL(new RegExp(`owner=${SAM_ID}`));
  const owners = await page.locator("[data-owner]").allInnerTexts();
  expect(owners.length).toBeGreaterThan(0);
  expect(new Set(owners)).toEqual(new Set(["Sam Rep"]));

  // The owner filter is kept when switching tabs.
  await tabLink(page, "Needs attention").click();
  await expect(page).toHaveURL(new RegExp(`tab=attention&owner=${SAM_ID}`));
  await expect(page.getByRole("list", { name: "Deals that need attention" })).toContainText("Aisha Khan");
});
