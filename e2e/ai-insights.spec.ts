/**
 * AI insights card (Prompt 11) with the deterministic fake AI client: the
 * Playwright webServer starts `npm run dev` with AI_FAKE=1 (playwright.config.ts).
 * If you reuse an already running dev server, start it with `AI_FAKE=1 npm run dev`.
 * Needs local Supabase with the seed and `.env.local`. Test prospects are named
 * `e2e-ai-*` (service role, owner Riley) and deleted afterwards (cascades the insights).
 */
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

try {
  process.loadEnvFile(".env.local");
} catch {
  // CI provides env vars directly.
}

const PASSWORD = "Password123!";
const REP = "riley.rep@example.com";
const RILEY_ID = "11111111-1111-4111-8111-000000000002";
const PREFIX = `e2e-ai-${Date.now()}`;

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

async function login(page: Page, email: string, next: string) {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(new RegExp(`${next}$`));
}

async function prospectRow(id: string) {
  const { data, error } = await admin
    .from("prospects")
    .select("decision_maker_status, last_activity_at, updated_at")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data;
}

test.describe.configure({ mode: "serial" });

test.afterAll(async () => {
  await admin.from("prospects").delete().like("name", `${PREFIX}%`);
});

test("generate, regenerate, history, dismiss, apply and follow-up from next step", async ({ page }) => {
  const { data: created, error } = await admin
    .from("prospects")
    .insert({
      name: `${PREFIX} Pilot`,
      company: "AI Co",
      objections: ["price"],
      decision_maker_status: "unknown",
      owner_id: RILEY_ID,
      created_by: RILEY_ID,
    })
    .select("id")
    .single();
  if (error) throw error;
  const id = created.id as string;
  const before = await prospectRow(id);

  await login(page, REP, `/prospects/${id}`);
  const card = page.locator('[data-slot="ai-insights"]');
  await expect(card.getByText("No AI insights yet.")).toBeVisible();

  // --- Generate (manual click only).
  await card.getByRole("button", { name: "Generate AI Insights" }).click();
  const errorBox = card.getByTestId("ai-insights-error");
  const latest = card.getByTestId("ai-insight-latest");
  await expect(latest.or(errorBox)).toBeVisible();
  await expect(errorBox, "start the dev server with AI_FAKE=1 (see playwright.config.ts)").toHaveCount(0);
  await expect(latest).toContainText(`[Fake AI] ${PREFIX} Pilot`);
  await expect(latest).toContainText("Deal health: Medium");
  await expect(latest).toContainText("Generated just now by Riley Rep");
  await expect(latest).toContainText("Price");
  await expect(page.getByRole("list", { name: "Timeline" })).toContainText("AI insight generated");

  const { data: insights } = await admin.from("ai_insights").select("id, model, created_by").eq("prospect_id", id);
  expect(insights).toEqual([expect.objectContaining({ model: "fake-ai", created_by: RILEY_ID })]);
  // Generating never writes the prospect (incl. last_activity_at).
  expect(await prospectRow(id)).toEqual(before);

  // --- Dismiss: hides the suggestion, nothing written.
  const suggestion = card.getByTestId("ai-dm-suggestion");
  await expect(suggestion).toContainText("AI suggests decision maker: Yes");
  await suggestion.getByRole("button", { name: "Dismiss" }).click();
  await expect(suggestion).toHaveCount(0);
  expect((await prospectRow(id)).decision_maker_status).toBe("unknown");

  // --- Regenerate → previous insight in the collapsible history; the new insight suggests again.
  const firstId = await latest.getAttribute("data-insight-id");
  await card.getByRole("button", { name: "Regenerate" }).click();
  await expect(latest).not.toHaveAttribute("data-insight-id", firstId!);
  const historyToggle = card.getByRole("button", { name: "Previous insights (1)" });
  await expect(historyToggle).toBeVisible();
  await historyToggle.click();
  await expect(card.getByTestId("ai-insight-history").locator(`[data-insight-id="${firstId}"]`)).toBeVisible();

  // --- Apply: writes the decision-maker status only on click.
  await expect(suggestion).toBeVisible();
  await suggestion.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByText("Decision maker set to Yes.")).toBeVisible();
  await expect(suggestion).toHaveCount(0);
  expect((await prospectRow(id)).decision_maker_status).toBe("yes");

  // --- Create follow-up from next step: dialog prefilled with the recommended next step.
  await card.getByRole("button", { name: "Create follow-up from next step" }).click();
  const dialog = page.getByRole("dialog", { name: "Create follow-up from next step" });
  const nextStep = `Call ${PREFIX} Pilot to confirm the decision process and agree on a next meeting date.`;
  await expect(dialog.getByLabel("Task")).toHaveValue(nextStep);
  await dialog.getByRole("button", { name: "Schedule follow-up" }).click();
  await expect(dialog).toBeHidden();
  const { data: followUps } = await admin.from("follow_ups").select("note, status").eq("prospect_id", id);
  expect(followUps).toEqual([{ note: nextStep, status: "pending" }]);
});
