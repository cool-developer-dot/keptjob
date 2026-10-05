/**
 * Reports (Prompt 13). Needs local Supabase with the seed and `.env.local`.
 * Two `e2e-reports-*` prospects for Riley are created with the service role
 * in June 2022 (a period nothing else uses) — one moved prospect → contacted
 * → closed won (real stage updates → stage_history), one left at prospect —
 * and deleted afterwards. Exact metric values are covered by pgTAP
 * (supabase/tests/reports.test.sql) and tests/integration/reports.test.ts.
 */
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

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
const PREFIX = `e2e-reports-${Date.now()}`;
const JUNE = "/reports?range=custom&from=2022-06-01&to=2022-06-30";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

async function login(page: Page, email: string) {
  await page.goto("/login?next=%2Freports");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/reports$/);
}

const stepRow = (page: Page, stage: string) => page.locator(`[data-testid="conversion-table"] [data-step="${stage}"]`);

async function expectJuneFunnel(page: Page) {
  await expect(stepRow(page, "prospect").locator("td").nth(1)).toHaveText("2");
  await expect(stepRow(page, "contacted").locator("td").nth(1)).toHaveText("1");
  await expect(stepRow(page, "contacted").locator('[data-cell="step"]')).toHaveText("50%");
  await expect(stepRow(page, "closed_won").locator("td").nth(1)).toHaveText("1");
  await expect(page.getByTestId("overall-conversion")).toHaveText("50%");
  await expect(page.getByTestId("win-rate")).toHaveText("100%");
  await expect(page.locator('[data-kpi="new-prospects"] [data-kpi-value]')).toHaveText("2");
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const { data, error } = await admin
    .from("prospects")
    .insert([
      { name: `${PREFIX} Won`, owner_id: RILEY_ID, created_by: RILEY_ID, deal_value: 5000, created_at: "2022-06-10T16:00:00Z" },
      { name: `${PREFIX} New`, owner_id: RILEY_ID, created_by: RILEY_ID, created_at: "2022-06-11T16:00:00Z" },
    ])
    .select("id, name");
  if (error) throw error;
  const won = data.find((row) => row.name.endsWith("Won"))!;
  for (const update of [
    { stage: "contacted" as const },
    { stage: "closed_won" as const, close_reason: "product_fit" },
  ]) {
    const { error: moveError } = await admin.from("prospects").update(update).eq("id", won.id);
    if (moveError) throw moveError;
  }
  const { error: closeError } = await admin
    .from("prospects")
    .update({ closed_at: "2022-06-20T16:00:00Z" })
    .eq("id", won.id);
  if (closeError) throw closeError;
});

test.afterAll(async () => {
  await admin.from("prospects").delete().like("name", `${PREFIX}%`);
});

test("rep: tiles, charts and table render; presets and custom range in the URL; owner param ignored", async ({ page }) => {
  await login(page, REP);
  await expect(page.getByRole("heading", { level: 1, name: "Reports" })).toBeVisible();
  await expect(page.locator("[data-kpi]")).toHaveCount(8);
  await expect(page.getByRole("combobox", { name: "Owner" })).toHaveCount(0);
  for (const name of ["Counts", "Funnel", "Conversion rates", "Prospects by stage", "Lost reasons"]) {
    await expect(page.getByRole("region", { name })).toBeVisible();
  }
  await expect(page.getByRole("figure", { name: "Prospects by current stage" })).toBeVisible();

  await page.getByRole("combobox", { name: "Period" }).click();
  await page.getByRole("option", { name: "Last 90 days" }).click();
  await expect(page).toHaveURL(/\/reports\?range=last_90$/);

  await page.goto(JUNE);
  await expect(page.getByText(/Jun 1 – Jun 30, 2022/)).toBeVisible();
  await expectJuneFunnel(page);
  await expect(page.getByRole("region", { name: "Lost reasons" }).getByText("No deals lost in this period")).toBeVisible();

  // A rep's owner param is ignored (still Riley's numbers).
  await page.goto(`${JUNE}&owner=${SAM_ID}`);
  await expect(page.getByText("Your numbers")).toBeVisible();
  await expectJuneFunnel(page);
});

test("rep: custom range validation", async ({ page }) => {
  await login(page, REP);
  await page.getByRole("combobox", { name: "Period" }).click();
  await page.getByRole("option", { name: "Custom range" }).click();
  await page.getByRole("textbox", { name: "From", exact: true }).fill("2022-06-30");
  await page.getByRole("textbox", { name: "To", exact: true }).fill("2022-06-01");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByRole("form", { name: "Custom range" }).getByRole("alert")).toHaveText("The start date must be on or before the end date.");
  await expect(page).toHaveURL(/\/reports$/);

  await page.getByRole("textbox", { name: "From", exact: true }).fill("2022-06-01");
  await page.getByRole("textbox", { name: "To", exact: true }).fill("2022-06-30");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page).toHaveURL(/range=custom&from=2022-06-01&to=2022-06-30/);
  await expectJuneFunnel(page);
});

test("manager: owner filter in the URL; another rep's period is empty", async ({ page }) => {
  await login(page, MANAGER);
  await expect(page.getByText("The whole team")).toBeVisible();
  await page.goto(JUNE);
  await expectJuneFunnel(page);

  await page.getByRole("combobox", { name: "Owner" }).click();
  await page.getByRole("option", { name: "Sam Rep" }).click();
  await expect(page).toHaveURL(new RegExp(`range=custom&from=2022-06-01&to=2022-06-30&owner=${SAM_ID}`));
  await expect(page.getByText("Showing Sam Rep")).toBeVisible();
  await expect(page.getByRole("region", { name: "Funnel" }).getByText("No prospects created in this period")).toBeVisible();

  await page.getByRole("combobox", { name: "Owner" }).click();
  await page.getByRole("option", { name: "Riley Rep" }).click();
  await expect(page).toHaveURL(new RegExp(`owner=${RILEY_ID}`));
  await expectJuneFunnel(page);
});
