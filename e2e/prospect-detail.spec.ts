/**
 * Prospect detail page (Prompt 8). Needs local Supabase with the seed
 * (`npm run db:reset`) and `.env.local`. Test prospects are named
 * `e2e-detail-*`, created with the service role for Riley and deleted afterwards.
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
const SAM_PROSPECT = "22222222-2222-4222-8222-000000000006"; // Aisha Khan (Sam)
const PREFIX = `e2e-detail-${Date.now()}`;

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

async function createRileyProspect(name: string): Promise<string> {
  const { data, error } = await admin
    .from("prospects")
    .insert({ name: `${PREFIX} ${name}`, company: "Detail Co", owner_id: RILEY_ID, created_by: RILEY_ID })
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
  await expect(page).toHaveURL(new RegExp(`${next}$`));
}

const stageSelect = (page: Page) => page.getByRole("combobox", { name: "Stage" });
const timeline = (page: Page) => page.getByRole("list", { name: "Timeline" });

async function chooseStage(page: Page, label: string) {
  await expect(stageSelect(page)).toBeEnabled();
  await stageSelect(page).click();
  await page.getByRole("option", { name: label, exact: true }).click();
}

test.describe.configure({ mode: "serial" });

test.afterAll(async () => {
  await admin.from("prospects").delete().like("name", `${PREFIX}%`);
});

test("a rep gets a 404 for another rep's prospect and for invalid ids", async ({ page }) => {
  await login(page, REP, "/prospects");
  for (const id of [SAM_PROSPECT, "not-a-uuid", "99999999-9999-4999-8999-999999999999"]) {
    const response = await page.goto(`/prospects/${id}`);
    expect(response?.status(), id).toBe(404);
    await expect(page.getByRole("heading", { name: "Prospect not found" })).toBeVisible();
  }
  await expect(page.getByText("Aisha Khan")).toHaveCount(0);
});

test("rep edits details, moves stages, logs activity and manages follow-ups", async ({ page }) => {
  const id = await createRileyProspect("Rep flow");
  await login(page, REP, `/prospects/${id}`);
  await expect(page.getByRole("heading", { name: `${PREFIX} Rep flow`, level: 1 })).toBeVisible();
  // Reps: no reassign select, no overflow menu.
  await expect(page.getByRole("combobox", { name: "Owner" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "More actions" })).toHaveCount(0);

  // --- Details: validation, then save, persists after reload.
  await page.getByRole("button", { name: "Edit" }).click();
  const form = page.getByRole("form", { name: "Edit details" });
  await form.getByLabel("Email").fill("not-an-email");
  await form.getByRole("button", { name: "Save details" }).click();
  await expect(form.getByText("Enter a valid email address.")).toBeVisible();
  await form.getByLabel("Email").fill("detail@example.com");
  await form.getByLabel("Phone").fill("+1 555 0199");
  await form.getByLabel("Deal value").fill("12500");
  await form.getByRole("combobox", { name: "Decision maker" }).click();
  await page.getByRole("option", { name: "Yes", exact: true }).click();
  await form.getByRole("combobox", { name: "Objections" }).click();
  await page.getByRole("option", { name: "Budget" }).click();
  await page.keyboard.press("Escape");
  await form.getByLabel("Objection notes").fill("Budget frozen until Q1");
  await form.getByLabel("Conversation notes").fill("Spoke with the CFO.");
  await form.getByRole("button", { name: "Save details" }).click();
  await expect(page.getByText("Details saved.")).toBeVisible();
  await page.reload();
  const details = page.locator("[aria-labelledby=details-title]");
  await expect(details.getByText("detail@example.com")).toBeVisible();
  await expect(details.getByText("+1 555 0199")).toBeVisible();
  await expect(details.getByText("$12,500.00 (USD)")).toBeVisible();
  await expect(details.getByText("Budget", { exact: true })).toBeVisible();
  await expect(details.getByText("Budget frozen until Q1")).toBeVisible();
  await expect(details.getByText("Spoke with the CFO.")).toBeVisible();

  // --- Stages: forward, skip, backward, close lost (cancel first), reopen.
  await chooseStage(page, "Contacted");
  await expect(timeline(page).locator("[data-activity-type=stage_change]")).toHaveCount(1);
  await chooseStage(page, "Qualified");
  await expect(timeline(page).locator("[data-activity-type=stage_change]")).toHaveCount(2);
  await chooseStage(page, "Conversation");
  await expect(timeline(page).locator("[data-activity-type=stage_change]")).toHaveCount(3);

  await chooseStage(page, "Closed Lost");
  const closeDialog = page.getByRole("dialog");
  await expect(closeDialog).toContainText("Closed Lost");
  await closeDialog.getByRole("button", { name: "Cancel" }).click();
  await expect(closeDialog).toBeHidden();
  await expect(stageSelect(page)).toHaveText("Conversation");

  await chooseStage(page, "Closed Lost");
  await closeDialog.getByRole("combobox", { name: /Lost reason/ }).click();
  await page.getByRole("option", { name: "No budget" }).click();
  await closeDialog.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("note", { name: "Outcome" })).toContainText("Reason: No budget");
  await expect(timeline(page).locator("[data-activity-type=stage_change]").first()).toContainText(
    "Reason: No budget",
  );

  await chooseStage(page, "Follow-up");
  await expect(page.getByRole("note", { name: "Outcome" })).toHaveCount(0);
  const stageEntries = timeline(page).locator("[data-activity-type=stage_change]");
  await expect(stageEntries).toHaveCount(5);
  await expect(stageEntries.first()).toContainText("Closed Lost");
  await expect(stageEntries.first()).toContainText("Follow-up");
  await expect(stageEntries.first()).toContainText("by Riley Rep");
  await expect(timeline(page).locator("[data-activity-type=created]")).toHaveCount(1);

  // --- Log activity (org-tz time, default now).
  await page.getByRole("button", { name: "Log activity" }).click();
  const activityForm = page.getByRole("form", { name: "Log activity" });
  await activityForm.getByRole("combobox", { name: "Type" }).click();
  await page.getByRole("option", { name: "Note", exact: true }).click();
  await activityForm.getByLabel("What happened?").fill("Left a voicemail");
  await activityForm.getByRole("button", { name: "Save activity" }).click();
  await expect(timeline(page).locator("[data-activity-type=note]")).toContainText("Left a voicemail");
  await expect(timeline(page).locator("li").first()).toContainText("Left a voicemail");

  // --- Follow-ups: add (overdue), reschedule, complete, delete.
  const panel = page.locator("#follow-ups");
  await panel.getByRole("button", { name: "Add follow-up" }).click();
  await panel.getByLabel("Due date").fill("2020-01-15");
  await panel.getByLabel("Task").fill("Send revised quote");
  await panel.getByRole("button", { name: "Add follow-up" }).click();
  await expect(panel.getByText("Send revised quote")).toBeVisible();
  await expect(panel.getByText("Overdue")).toBeVisible();

  await panel.getByRole("button", { name: "Reschedule follow-up: Send revised quote" }).click();
  await page.getByLabel("New due date").fill("2099-03-01");
  await page.getByRole("button", { name: "Save date" }).click();
  await expect(panel.getByText("Mar 1, 2099")).toBeVisible();
  await expect(panel.getByText("Overdue")).toHaveCount(0);

  await panel.getByRole("button", { name: "Complete follow-up: Send revised quote" }).click();
  await page.getByLabel("Outcome (optional)").fill("Quote sent");
  await page.getByRole("button", { name: "Mark complete" }).click();
  await expect(panel.getByText("Completed", { exact: true })).toBeVisible();
  await expect(timeline(page).locator("[data-activity-type=follow_up]")).toContainText("Quote sent");

  await panel.getByRole("button", { name: "Delete follow-up: Send revised quote" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await expect(panel.getByText("Send revised quote")).toHaveCount(0);
});

test("manager reassigns (owner_change in the timeline) and deletes a prospect", async ({ page }) => {
  const id = await createRileyProspect("Manager flow");
  await login(page, MANAGER, `/prospects/${id}`);

  await page.getByRole("combobox", { name: "Owner" }).click();
  await page.getByRole("option", { name: /^Sam Rep/ }).click();
  await expect(page.getByText(/Reassigned .* to Sam Rep\./)).toBeVisible();
  const ownerChange = timeline(page).locator("[data-activity-type=owner_change]");
  await expect(ownerChange).toContainText("Riley Rep");
  await expect(ownerChange).toContainText("Sam Rep");
  await expect(ownerChange).toContainText("by Morgan Manager");

  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Delete prospect" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete prospect" }).click();
  await expect(page).toHaveURL(/\/prospects$/);
  await expect(page.getByText(`${PREFIX} Manager flow was deleted.`)).toBeVisible();

  const { data } = await admin.from("prospects").select("id").eq("id", id);
  expect(data).toEqual([]);
});
