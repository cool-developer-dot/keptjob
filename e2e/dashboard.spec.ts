/**
 * Dashboard (Prompt 12). Needs local Supabase with the seed (`npm run
 * db:reset`) and `.env.local`. A test prospect `e2e-dash-*` with an overdue
 * follow-up is created for Riley with the service role and deleted afterwards.
 * Numbers are asserted relative to the first render (seed-independent); the
 * exact values are covered by tests/integration/dashboard.test.ts.
 */
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

import { addDaysToDateString, formatOrgDate, orgToday } from "../src/lib/time";

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
const PREFIX = `e2e-dash-${Date.now()}`;

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

let timezone = "America/New_York";

async function login(page: Page, email: string) {
  await page.goto("/login?next=%2Fdashboard");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

async function kpi(page: Page, id: string): Promise<string> {
  return (await page.locator(`[data-kpi="${id}"] [data-kpi-value]`).innerText()).trim();
}

const contactToday = (page: Page) => page.getByRole("region", { name: "Contact today" });

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const { data } = await admin.from("org_settings").select("timezone").single();
  if (data?.timezone) timezone = data.timezone;
});

test.afterAll(async () => {
  await admin.from("prospects").delete().like("name", `${PREFIX}%`);
});

let rileyOverdue = 0;

test("rep: greeting in the org timezone, KPIs and sections update; owner param ignored", async ({ page }) => {
  await login(page, REP);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^Good (morning|afternoon|evening), Riley$/);
  await expect(page.getByText(formatOrgDate(new Date(), timezone, "EEEE, MMMM d, yyyy"))).toBeVisible();
  await expect(page.locator("[data-kpi]")).toHaveCount(6);
  await expect(page.getByRole("combobox", { name: "Owner" })).toHaveCount(0);
  for (const name of ["Contact today", "Deals needing attention", "Latest AI recommendations", "Recent activity"]) {
    await expect(page.getByRole("region", { name })).toBeVisible();
  }

  const overdueBefore = Number(await kpi(page, "overdue"));
  const openBefore = Number(await kpi(page, "open"));

  const { data: prospect, error } = await admin
    .from("prospects")
    .insert({ name: `${PREFIX} Overdue`, company: "Dash Co", owner_id: RILEY_ID, created_by: RILEY_ID, objections: ["timing"] })
    .select("id")
    .single();
  if (error) throw error;
  await admin
    .from("follow_ups")
    .insert({ prospect_id: prospect.id, due_date: addDaysToDateString(orgToday(timezone), -5), note: "Dashboard chase" });

  await page.reload();
  expect(Number(await kpi(page, "overdue"))).toBe(overdueBefore + 1);
  expect(Number(await kpi(page, "open"))).toBe(openBefore + 1);
  rileyOverdue = overdueBefore + 1;

  const row = contactToday(page).getByRole("listitem").filter({ hasText: `${PREFIX} Overdue` });
  await expect(row).toContainText("5 days overdue");
  await expect(row).toContainText("Dashboard chase");
  await expect(row).toContainText("Timing");
  // Most overdue first: the -5 day follow-up leads the list.
  await expect(contactToday(page).locator("li[data-follow-up-id]").first()).toContainText(`${PREFIX} Overdue`);
  // Overdue follow-up → rank 1 in "Deals needing attention".
  const attention = page.getByRole("region", { name: "Deals needing attention" });
  await expect(attention.locator(`li[data-prospect-id="${prospect.id}"]`)).toHaveAttribute("data-attention-rank", "1");

  await page.goto(`/dashboard?owner=${SAM_ID}`);
  expect(Number(await kpi(page, "overdue"))).toBe(rileyOverdue);
  await expect(contactToday(page)).toContainText(`${PREFIX} Overdue`);
});

test("manager: owner filter in the URL", async ({ page }) => {
  await login(page, MANAGER);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/, Morgan$/);
  const owner = page.getByRole("combobox", { name: "Owner" });
  await expect(owner).toHaveText("All owners");
  const teamOverdue = Number(await kpi(page, "overdue"));
  expect(teamOverdue).toBeGreaterThanOrEqual(rileyOverdue);
  await expect(contactToday(page)).toContainText("Riley Rep");

  await owner.click();
  await page.getByRole("option", { name: "Riley Rep" }).click();
  await expect(page).toHaveURL(new RegExp(`/dashboard\\?owner=${RILEY_ID}$`));
  await expect(owner).toHaveText("Riley Rep");
  await expect(page.getByText("Showing Riley Rep")).toBeVisible();
  await expect(page.locator('[data-kpi="overdue"] [data-kpi-value]')).toHaveText(String(rileyOverdue));

  await owner.click();
  await page.getByRole("option", { name: "All owners" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.locator('[data-kpi="overdue"] [data-kpi-value]')).toHaveText(String(teamOverdue));
});
