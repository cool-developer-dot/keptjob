/**
 * Kanban pipeline (Prompt 9). Needs local Supabase with the seed
 * (`npm run db:reset`) and `.env.local`. Test prospects are named
 * `e2e-pipe-*`, created for Riley with the service role and deleted afterwards.
 * Drags use the keyboard sensor (Space, ←/→, Space) and the mouse.
 */
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Browser, type Page } from "@playwright/test";

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
const PREFIX = `e2e-pipe-${Date.now()}`;

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

async function createRileyProspect(name: string, extra: Record<string, unknown> = {}): Promise<string> {
  const { data, error } = await admin
    .from("prospects")
    .insert({ name: `${PREFIX} ${name}`, company: "Pipe Co", owner_id: RILEY_ID, created_by: RILEY_ID, ...extra })
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
  await expect(page).toHaveURL((url) => `${url.pathname}${url.search}` === next);
}

async function newPage(browser: Browser, email: string, next: string): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await login(page, email, next);
  return page;
}

const column = (page: Page, label: string) => page.getByRole("region", { name: label, exact: true });
const card = (page: Page, name: string) => page.getByRole("button", { name: new RegExp(`^${PREFIX} ${name},`) });

/** Keyboard drag: Space picks up, each arrow jumps one column, Space drops. */
async function keyboardDrag(page: Page, name: string, arrows: ("ArrowLeft" | "ArrowRight")[]) {
  const target = card(page, name);
  await expect(target).toBeEnabled();
  await expect(target).not.toHaveAttribute("aria-busy", "true");
  await target.focus();
  await page.keyboard.press("Space");
  for (const arrow of arrows) {
    await page.waitForTimeout(150);
    await page.keyboard.press(arrow);
  }
  await page.waitForTimeout(150);
  await page.keyboard.press("Space");
}

const right = (n: number) => Array<"ArrowRight">(n).fill("ArrowRight");
const left = (n: number) => Array<"ArrowLeft">(n).fill("ArrowLeft");

async function stageOf(id: string): Promise<string> {
  const { data } = await admin.from("prospects").select("stage").eq("id", id).single();
  return data?.stage as string;
}

test.describe.configure({ mode: "serial" });

test.afterAll(async () => {
  await admin.from("prospects").delete().like("name", `${PREFIX}%`);
});

test("columns, card badges and per-currency totals", async ({ page }) => {
  await createRileyProspect("Totals USD", { deal_value: 1000, currency: "USD", decision_maker_status: "yes" });
  await createRileyProspect("Totals EUR", { deal_value: 250, currency: "EUR" });
  await createRileyProspect("Totals none");
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, REP, `/pipeline?q=${PREFIX}`);

  const headings = page.getByRole("region").locator("h2");
  await expect(headings).toHaveText([
    "Prospect",
    "Contacted",
    "Conversation",
    "Qualified",
    "Demo Booked",
    "Demo Attended",
    "Follow-up",
    "Closed Won",
    "Closed Lost",
  ]);
  const prospectColumn = column(page, "Prospect");
  await expect(prospectColumn.getByTestId("column-count")).toHaveText("3");
  await expect(prospectColumn.getByTestId("column-total")).toHaveText("€250 · $1,000");
  await expect(card(page, "Totals USD")).toContainText("DM: Yes");
  // Reps don't get owner initials or an owner filter.
  await expect(page.getByTestId("owner-initials")).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Owner" })).toHaveCount(0);

  // Narrow screens: the board scrolls inside its container, never the page.
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(column(page, "Prospect")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});

test("drag forward, skip, backward, close (cancel, then save), demo booked (skip), reopen — persisted with history", async ({
  page,
}) => {
  const id = await createRileyProspect("Mover");
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, REP, `/pipeline?q=${encodeURIComponent(`${PREFIX} Mover`)}`);
  await expect(column(page, "Prospect").getByRole("button", { name: /Mover/ })).toBeVisible();

  // Same column: nothing happens.
  await keyboardDrag(page, "Mover", []);
  await expect(column(page, "Prospect").getByRole("button", { name: /Mover/ })).toBeVisible();

  // Forward: Prospect → Contacted.
  await keyboardDrag(page, "Mover", right(1));
  await expect(column(page, "Contacted").getByRole("button", { name: /Mover/ })).toBeVisible();
  await expect.poll(() => stageOf(id)).toBe("contacted");

  // Skip: Contacted → Qualified.
  await keyboardDrag(page, "Mover", right(2));
  await expect(column(page, "Qualified").getByRole("button", { name: /Mover/ })).toBeVisible();
  await expect.poll(() => stageOf(id)).toBe("qualified");

  // Backward: Qualified → Conversation.
  await keyboardDrag(page, "Mover", left(1));
  await expect(column(page, "Conversation").getByRole("button", { name: /Mover/ })).toBeVisible();
  await expect.poll(() => stageOf(id)).toBe("conversation");

  // Close lost: Cancel snaps back and writes nothing.
  await keyboardDrag(page, "Mover", right(6));
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Closed Lost");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(column(page, "Conversation").getByRole("button", { name: /Mover/ })).toBeVisible();
  expect(await stageOf(id)).toBe("conversation");

  // Close lost with a reason.
  await keyboardDrag(page, "Mover", right(6));
  await dialog.getByRole("combobox", { name: /Lost reason/ }).click();
  await page.getByRole("option", { name: "No budget" }).click();
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toBeHidden();
  await expect(column(page, "Closed Lost").getByRole("button", { name: /Mover/ })).toBeVisible();
  await expect.poll(() => stageOf(id)).toBe("closed_lost");

  // Reopen with the mouse onto Demo Booked → demo dialog → Skip.
  const source = card(page, "Mover");
  const target = column(page, "Demo Booked");
  await target.scrollIntoViewIfNeeded();
  await source.scrollIntoViewIfNeeded();
  const from = (await source.boundingBox())!;
  const to = (await target.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 - 20, from.y + from.height / 2, { steps: 5 });
  await page.mouse.move(to.x + to.width / 2, to.y + 80, { steps: 15 });
  await page.mouse.up();
  await expect(dialog).toContainText("Demo Booked");
  await dialog.getByRole("button", { name: "Skip" }).click();
  await expect(dialog).toBeHidden();
  await expect(column(page, "Demo Booked").getByRole("button", { name: /Mover/ })).toBeVisible();
  await expect.poll(() => stageOf(id)).toBe("demo_booked");
  await expect(page).toHaveURL(/\/pipeline/); // the drag didn't open the card

  // Persisted after reload.
  await page.reload();
  await expect(column(page, "Demo Booked").getByRole("button", { name: /Mover/ })).toBeVisible();

  // One stage_history row + one stage_change activity per move, by Riley.
  const { data: history } = await admin
    .from("stage_history")
    .select("from_stage, to_stage, changed_by")
    .eq("prospect_id", id)
    .order("changed_at", { ascending: true });
  expect(history?.map((h) => [h.from_stage, h.to_stage])).toEqual([
    [null, "prospect"],
    ["prospect", "contacted"],
    ["contacted", "qualified"],
    ["qualified", "conversation"],
    ["conversation", "closed_lost"],
    ["closed_lost", "demo_booked"],
  ]);
  expect(history?.slice(1).every((h) => h.changed_by === RILEY_ID)).toBe(true);
  const { data: activities } = await admin
    .from("activities")
    .select("user_id, metadata")
    .eq("prospect_id", id)
    .eq("type", "stage_change");
  expect(activities).toHaveLength(5);
  expect(activities?.every((a) => a.user_id === RILEY_ID)).toBe(true);

  // Click opens the prospect; its timeline shows the moves.
  await card(page, "Mover").click();
  await expect(page).toHaveURL(new RegExp(`/prospects/${id}$`));
  await expect(page.getByRole("list", { name: "Timeline" }).locator("[data-activity-type=stage_change]")).toHaveCount(5);
});

test("Realtime: another user's move and a reassignment show up without a reload", async ({ browser }) => {
  const id = await createRileyProspect("Live");
  const query = `/pipeline?q=${encodeURIComponent(`${PREFIX} Live`)}`;
  const rep = await newPage(browser, REP, query);
  const manager = await newPage(browser, MANAGER, query);
  await expect(column(rep, "Prospect").getByRole("button", { name: /Live/ })).toBeVisible();
  // Managers see owner initials and the owner filter.
  await expect(card(manager, "Live").getByTestId("owner-initials")).toHaveText("RR");
  await expect(manager.getByRole("combobox", { name: "Owner" })).toBeVisible();
  await rep.waitForTimeout(1500); // let the Realtime subscription join

  // Manager moves Riley's card → Riley's board updates live.
  await keyboardDrag(manager, "Live", right(3));
  await expect(column(manager, "Qualified").getByRole("button", { name: /Live/ })).toBeVisible();
  await expect(column(rep, "Qualified").getByRole("button", { name: /Live/ })).toBeVisible({ timeout: 10_000 });

  // Reassigned away from Riley → the card disappears from Riley's board.
  const { error } = await admin.from("prospects").update({ owner_id: SAM_ID }).eq("id", id);
  expect(error).toBeNull();
  await expect(card(rep, "Live")).toHaveCount(0, { timeout: 10_000 });
  // The manager still sees it (now Sam's).
  await expect(card(manager, "Live").getByTestId("owner-initials")).toHaveText("SR", { timeout: 10_000 });

  await rep.context().close();
  await manager.context().close();
});
