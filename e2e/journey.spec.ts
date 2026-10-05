/**
 * End-to-end journeys (Prompt 14). Needs local Supabase with the seed
 * (`npm run db:reset`) and `.env.local`; the dev server runs with AI_FAKE=1
 * (playwright.config.ts webServer) so AI insights use the deterministic fake
 * client. Every test creates its own `e2e-journey-*` fixtures (deleted in
 * afterAll with the service role) and restores what it changes (org timezone),
 * so the specs are independent and repeatable.
 */
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Browser, type Page } from "@playwright/test";

import {
  addDaysToDateString,
  followUpViewBucket,
  orgLocalToUtc,
  orgToday,
  type FollowUpViewBucket,
} from "../src/lib/time";

try {
  process.loadEnvFile(".env.local");
} catch {
  // CI provides env vars directly.
}

const PASSWORD = "Password123!";
const MANAGER = "morgan.manager@example.com";
const REP = "riley.rep@example.com";
const REP_B = "sam.rep@example.com";
const RILEY_ID = "11111111-1111-4111-8111-000000000002";
const SAM_ID = "11111111-1111-4111-8111-000000000003";
const PREFIX = `e2e-journey-${Date.now()}`;
const NEW_YORK = "America/New_York";
const HONOLULU = "Pacific/Honolulu";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

let timezone = NEW_YORK;

async function login(page: Page, email: string, next: string) {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL((url) => `${url.pathname}${url.search}` === next);
}

async function newPage(browser: Browser, email: string, next: string): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await login(page, email, next);
  return page;
}

async function createRileyProspect(name: string): Promise<string> {
  const { data, error } = await admin
    .from("prospects")
    .insert({ name: `${PREFIX} ${name}`, company: "Journey Co", owner_id: RILEY_ID, created_by: RILEY_ID })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

async function setOrgTimezone(tz: string) {
  const { error } = await admin.from("org_settings").update({ timezone: tz }).eq("id", true);
  if (error) throw error;
}

/** Dashboard KPI values (open, due today, won in the 90-day win-rate window). */
async function dashboardNumbers(page: Page) {
  await page.goto("/dashboard");
  const value = async (id: string) => Number((await page.locator(`[data-kpi="${id}"] [data-kpi-value]`).innerText()).trim());
  const winRate = await page.locator('[data-kpi="win-rate"]').innerText();
  return {
    open: await value("open"),
    dueToday: await value("due-today"),
    won: Number(/(\d+) won · \d+ lost/.exec(winRate)?.[1] ?? 0),
  };
}

const column = (page: Page, label: string) => page.getByRole("region", { name: label, exact: true });

/** Keyboard drag on the Kanban: Space picks up, each arrow jumps one column, Space drops. */
async function keyboardDrag(page: Page, cardName: string, rightArrows: number) {
  const card = page.getByRole("button", { name: new RegExp(`^${cardName},`) });
  await expect(card).toBeEnabled();
  await expect(card).not.toHaveAttribute("aria-busy", "true");
  await card.focus();
  await page.keyboard.press("Space");
  for (let i = 0; i < rightArrows; i += 1) {
    await page.waitForTimeout(150);
    await page.keyboard.press("ArrowRight");
  }
  await page.waitForTimeout(150);
  await page.keyboard.press("Space");
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const { data } = await admin.from("org_settings").select("timezone").single();
  if (data?.timezone) timezone = data.timezone;
});

test.afterAll(async () => {
  // Safety net: the timezone test restores the setting itself.
  await setOrgTimezone(timezone);
  await admin.from("prospects").delete().like("name", `${PREFIX}%`);
});

test("rep journey: create → call → AI insight → demo booked → demo attended → closed won → complete follow-up → dashboard", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const name = `${PREFIX} Acme Buyer`;
  const today = orgToday(timezone);

  await login(page, REP, "/dashboard");
  const start = await dashboardNumbers(page);

  // --- Create the prospect (list page dialog).
  await page.goto("/prospects");
  await page.getByRole("button", { name: "New prospect" }).click();
  const dialog = page.getByRole("dialog", { name: "New prospect" });
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByLabel("Company").fill("Acme Journeys");
  await dialog.getByLabel("Deal value (USD)").fill("18000");
  await dialog.getByRole("button", { name: "Create prospect" }).click();
  await expect(page.getByText(`${name} was added.`)).toBeVisible();
  await page.getByRole("table").getByRole("link", { name, exact: true }).click();
  await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
  const id = /\/prospects\/([0-9a-f-]{36})$/.exec(page.url())?.[1];
  expect(id).toBeTruthy();

  expect((await dashboardNumbers(page)).open).toBe(start.open + 1);

  // --- Log a call.
  await page.goto(`/prospects/${id}`);
  const timeline = page.getByRole("list", { name: "Timeline" });
  await page.getByRole("button", { name: "Log activity" }).click();
  const activityForm = page.getByRole("form", { name: "Log activity" });
  await activityForm.getByRole("combobox", { name: "Type" }).click();
  await page.getByRole("option", { name: "Call", exact: true }).click();
  await activityForm.getByLabel("What happened?").fill("Discovery call: 12 reps, wants a demo next week.");
  await activityForm.getByRole("button", { name: "Save activity" }).click();
  await expect(timeline.locator("[data-activity-type=call]")).toContainText("Discovery call: 12 reps");

  // --- AI insight (fake client, manual click only).
  const aiCard = page.locator('[data-slot="ai-insights"]');
  await aiCard.getByRole("button", { name: "Generate AI Insights" }).click();
  await expect(aiCard.getByTestId("ai-insights-error"), "start the dev server with AI_FAKE=1").toHaveCount(0);
  await expect(aiCard.getByTestId("ai-insight-latest")).toContainText(`[Fake AI] ${name}`);
  await expect(timeline).toContainText("AI insight generated");

  // --- Pipeline: Prospect → Demo Booked (demo dialog: date/time + follow-up).
  await page.goto(`/pipeline?q=${encodeURIComponent(name)}`);
  await expect(column(page, "Prospect").getByRole("button", { name: new RegExp(`^${name},`) })).toBeVisible();
  const demoDate = addDaysToDateString(today, 3);
  await keyboardDrag(page, name, 4);
  const stageDialog = page.getByRole("dialog");
  await expect(stageDialog).toContainText("Demo Booked");
  await stageDialog.getByLabel(/^Demo date/).fill(demoDate);
  await stageDialog.getByLabel(/^Time/).fill("14:30");
  await expect(stageDialog.getByLabel("Due date")).toHaveValue(addDaysToDateString(demoDate, 1));
  await stageDialog.getByLabel("Follow-up note").fill(`${PREFIX} send the demo recap`);
  await stageDialog.getByRole("button", { name: "Save" }).click();
  await expect(stageDialog).toBeHidden();
  await expect(column(page, "Demo Booked").getByRole("button", { name: new RegExp(`^${name},`) })).toBeVisible();

  // --- Demo Booked → Demo Attended (notes + follow-up due today).
  await keyboardDrag(page, name, 1);
  await expect(stageDialog).toContainText("Demo Attended");
  await stageDialog.getByLabel("Demo notes").fill("Great demo; they want pricing for 12 seats.");
  await stageDialog.getByLabel("Due date").fill(today);
  await stageDialog.getByLabel("Follow-up note").fill(`${PREFIX} call back with pricing`);
  await stageDialog.getByRole("button", { name: "Save" }).click();
  await expect(stageDialog).toBeHidden();
  await expect(column(page, "Demo Attended").getByRole("button", { name: new RegExp(`^${name},`) })).toBeVisible();

  expect((await dashboardNumbers(page)).dueToday).toBe(start.dueToday + 1);

  // --- Demo Attended → Closed Won: Save is blocked until a reason is chosen.
  await page.goto(`/pipeline?q=${encodeURIComponent(name)}`);
  await keyboardDrag(page, name, 2);
  await expect(stageDialog).toContainText("Closed Won");
  const save = stageDialog.getByRole("button", { name: "Save" });
  await expect(save).toBeDisabled();
  const completeAll = stageDialog.getByRole("checkbox", { name: "Mark 2 pending follow-ups as completed" });
  await expect(completeAll).toBeChecked();
  await completeAll.uncheck(); // keep them: one is completed from the Follow-ups page below
  await stageDialog.getByRole("combobox", { name: /Won reason/ }).click();
  await page.getByRole("option", { name: "Product fit" }).click();
  await expect(save).toBeEnabled();
  await save.click();
  await expect(stageDialog).toBeHidden();
  await expect(column(page, "Closed Won").getByRole("button", { name: new RegExp(`^${name},`) })).toBeVisible();

  // Persisted: stage, reason, demo time (org timezone), history, activities.
  const { data: prospect } = await admin
    .from("prospects")
    .select("stage, close_reason, closed_at, demo_at, deal_value, currency")
    .eq("id", id!)
    .single();
  expect(prospect).toMatchObject({ stage: "closed_won", close_reason: "product_fit", deal_value: 18000, currency: "USD" });
  expect(prospect?.closed_at).toBeTruthy();
  expect(new Date(prospect!.demo_at!).toISOString()).toBe(orgLocalToUtc(demoDate, "14:30", timezone).toISOString());
  const { data: history } = await admin
    .from("stage_history")
    .select("from_stage, to_stage, changed_by, close_reason")
    .eq("prospect_id", id!)
    .order("changed_at");
  expect(history?.map((row) => [row.from_stage, row.to_stage, row.close_reason])).toEqual([
    [null, "prospect", null],
    ["prospect", "demo_booked", null],
    ["demo_booked", "demo_attended", null],
    ["demo_attended", "closed_won", "product_fit"],
  ]);
  expect(history?.every((row) => row.changed_by === RILEY_ID)).toBe(true);
  const { data: activities } = await admin.from("activities").select("type").eq("prospect_id", id!);
  expect(activities?.map((row) => row.type).sort()).toEqual(["ai_insight", "call", "demo", "stage_change", "stage_change", "stage_change"]);

  // --- Complete the follow-up due today (Follow-ups page).
  await page.goto("/follow-ups?tab=today");
  const row = page.getByRole("listitem").filter({ hasText: `${PREFIX} call back with pricing` });
  await row.getByRole("button", { name: `Complete follow-up: ${PREFIX} call back with pricing` }).click();
  await page.getByLabel("Outcome (optional)").fill("Sent the 12-seat pricing.");
  await page.getByRole("button", { name: "Mark complete" }).click();
  await expect(row).toHaveCount(0);
  const { data: followUps } = await admin
    .from("follow_ups")
    .select("note, status, completed_by")
    .eq("prospect_id", id!)
    .order("due_date");
  expect(followUps).toEqual([
    { note: `${PREFIX} call back with pricing`, status: "completed", completed_by: RILEY_ID },
    { note: `${PREFIX} send the demo recap`, status: "pending", completed_by: null },
  ]);

  // --- Dashboard: the deal left the open pipeline, the win counts, nothing extra is due today.
  const end = await dashboardNumbers(page);
  expect(end).toEqual({ open: start.open, dueToday: start.dueToday, won: start.won + 1 });
  await expect(page.getByRole("region", { name: "Recent activity" })).toContainText(name);
});

test("rep B gets a 404 on rep A's prospect", async ({ page }) => {
  const id = await createRileyProspect("Private deal");
  await login(page, REP_B, "/prospects");
  const response = await page.goto(`/prospects/${id}`);
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Prospect not found" })).toBeVisible();
  await expect(page.getByText(`${PREFIX} Private deal`)).toHaveCount(0);
});

test("manager reassigns a prospect: owner_change entry, follow-ups move, old owner loses access", async ({
  page,
  browser,
}) => {
  const id = await createRileyProspect("Handover");
  const { error } = await admin
    .from("follow_ups")
    .insert({ prospect_id: id, due_date: addDaysToDateString(orgToday(timezone), 2), note: `${PREFIX} handover call` });
  expect(error).toBeNull();

  await login(page, MANAGER, `/prospects/${id}`);
  await page.getByRole("combobox", { name: "Owner" }).click();
  await page.getByRole("option", { name: /^Sam Rep/ }).click();
  await expect(page.getByText(/Reassigned .* to Sam Rep\./)).toBeVisible();
  const ownerChange = page.getByRole("list", { name: "Timeline" }).locator("[data-activity-type=owner_change]");
  await expect(ownerChange).toHaveCount(1);
  await expect(ownerChange).toContainText("Riley Rep");
  await expect(ownerChange).toContainText("Sam Rep");
  await expect(ownerChange).toContainText("by Morgan Manager");

  const { data } = await admin.from("follow_ups").select("owner_id").eq("prospect_id", id);
  expect(data).toEqual([{ owner_id: SAM_ID }]);

  const riley = await newPage(browser, REP, "/dashboard");
  expect((await riley.goto(`/prospects/${id}`))?.status()).toBe(404);
  await riley.context().close();
  const sam = await newPage(browser, REP_B, `/prospects/${id}`);
  await expect(sam.getByRole("heading", { name: `${PREFIX} Handover`, level: 1 })).toBeVisible();
  await sam.context().close();
});

test("manager changes the org timezone and follow-ups move between buckets", async ({ page }) => {
  // Server time can't be frozen (Postgres now() drives org_today()), so the
  // fixture is built from the current instant to guarantee a bucket change at
  // any hour: when New York and Honolulu already disagree on the date
  // (00:00–05/06:00 ET), a follow-up due on New York's today leaves "Today";
  // otherwise one completed at 02:00 ET on New York's today − 29 (= the
  // previous evening in Honolulu) leaves the 30-day "Completed" window.
  const now = new Date();
  const todayNy = orgToday(NEW_YORK, now);
  const completedAt = orgLocalToUtc(addDaysToDateString(todayNy, -29), "02:00", NEW_YORK).toISOString();
  const id = await createRileyProspect("Timezone");
  const dueNote = `${PREFIX} due on New York's today`;
  const doneNote = `${PREFIX} completed at 02:00 ET`;
  const { error } = await admin.from("follow_ups").insert([
    // Bulk inserts need the same keys on every row (missing ones become null).
    { prospect_id: id, due_date: todayNy, note: dueNote, status: "pending", completed_at: null, completed_by: null },
    {
      prospect_id: id,
      due_date: addDaysToDateString(todayNy, -30),
      note: doneNote,
      status: "completed",
      completed_at: completedAt,
      completed_by: RILEY_ID,
    },
  ]);
  expect(error).toBeNull();

  const fixture = [
    { note: dueNote, status: "pending" as const, dueDate: todayNy, completedAt: null },
    { note: doneNote, status: "completed" as const, dueDate: addDaysToDateString(todayNy, -30), completedAt },
  ];
  const expected = (tz: string) => fixture.map((f) => followUpViewBucket(f, tz, now));
  const inNewYork = expected(NEW_YORK);
  const inHonolulu = expected(HONOLULU);
  expect(inNewYork).toEqual(["today", "completed"]);
  expect(inHonolulu).not.toEqual(inNewYork); // a change is guaranteed at any time of day

  /** Asserts which tab lists each fixture follow-up (manager view: everyone's). */
  async function expectTabs(buckets: (FollowUpViewBucket | null)[]) {
    for (const tab of ["today", "upcoming", "completed"] as const) {
      await page.goto(`/follow-ups?tab=${tab}`);
      await expect(page.getByRole("navigation", { name: "Follow-up views" })).toBeVisible();
      for (const [i, f] of fixture.entries()) {
        await expect(
          page.getByRole("listitem").filter({ hasText: f.note }),
          `${f.note} in ${tab}`,
        ).toHaveCount(buckets[i] === tab ? 1 : 0);
      }
    }
  }

  await setOrgTimezone(NEW_YORK);
  try {
    await login(page, MANAGER, "/follow-ups?tab=today");
    await expectTabs(inNewYork);

    await page.goto("/settings");
    await page.getByRole("combobox", { name: "Timezone", exact: true }).click();
    await page.getByRole("option", { name: "Hawaii Time (Honolulu)", exact: true }).click();
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.getByText("Settings saved.")).toBeVisible();
    await expectTabs(inHonolulu);
    if (orgToday(HONOLULU, now) !== todayNy) {
      // Night window: the "today" bucket itself moved (New York's today is Honolulu's tomorrow).
      expect(inHonolulu[0]).toBe("upcoming");
    }

    await page.goto("/settings");
    await page.getByRole("combobox", { name: "Timezone", exact: true }).click();
    await page.getByRole("option", { name: "Eastern Time (New York)", exact: true }).click();
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.getByText("Settings saved.")).toBeVisible();
    await expectTabs(inNewYork);
  } finally {
    await setOrgTimezone(timezone);
  }
});

test("invite flow: the invite dialog renders and validates; invalid invite links are handled", async ({ page }) => {
  await login(page, MANAGER, "/settings?tab=team");
  await page.getByRole("button", { name: "Invite user" }).click();
  const dialog = page.getByRole("dialog", { name: "Invite user" });
  await expect(dialog.getByLabel("Full name")).toBeVisible();
  await expect(dialog.getByLabel("Email")).toBeVisible();
  await expect(dialog.getByRole("combobox", { name: "Role" })).toHaveText("Sales Rep");
  await dialog.getByRole("button", { name: "Send invite" }).click();
  await expect(dialog.getByText("Enter the full name.")).toBeVisible();
  await expect(dialog.getByText("Enter a valid email address.")).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();

  // An expired / tampered invite link never reaches /set-password.
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/auth/confirm?token_hash=nope&type=invite");
  await expect(page).toHaveURL(/\/login\?error=invalid_link$/);
  await expect(page.getByRole("alert").filter({ hasText: "invalid or has expired" })).toBeVisible();
  // Without the session an invite link creates, /set-password sends you to login.
  await page.goto("/set-password");
  await expect(page).toHaveURL(/\/login(\?|$)/);
  await expect(page.getByRole("button", { name: "Log in" })).toBeVisible();
});
