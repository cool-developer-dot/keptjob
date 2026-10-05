/**
 * Prospects list (Prompt 7). Needs local Supabase with the seed (`npm run db:reset`:
 * Riley owns Jordan Lee / Marcus Chen (stale) …, Sam owns Aisha Khan …) and
 * `.env.local`. Prospects created here are named `e2e-prospect-*` and deleted
 * afterwards with the service role.
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
const SAM_ID = "11111111-1111-4111-8111-000000000003";
const NAME = `e2e-prospect-${Date.now()}`;

async function login(page: Page, email: string, next = "/prospects") {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(new RegExp(`${next.replace(/[?]/g, "\\?")}$`));
}

const table = (page: Page) => page.getByRole("table");
const rowLink = (page: Page, name: string) => table(page).getByRole("link", { name, exact: true });

test.describe.configure({ mode: "serial" });

test.afterAll(async () => {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  await admin.from("prospects").delete().like("name", "e2e-prospect-%");
});

test("rep sees only their own prospects, no owner column/filter, owner param ignored", async ({ page }) => {
  await login(page, REP, `/prospects?owner=${SAM_ID}`);
  await expect(page.getByRole("heading", { name: "Prospects" })).toBeVisible();
  await expect(rowLink(page, "Jordan Lee")).toBeVisible();
  await expect(rowLink(page, "Aisha Khan")).toHaveCount(0);
  await expect(page.getByRole("columnheader", { name: "Owner" })).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Owner" })).toHaveCount(0);
  await expect(table(page).getByText("Overdue").first()).toBeVisible();
});

test("rep creates a prospect, then searches, filters and sorts", async ({ page }) => {
  await login(page, REP);

  await page.getByRole("button", { name: "New prospect" }).click();
  const dialog = page.getByRole("dialog", { name: "New prospect" });
  await expect(dialog.getByRole("combobox", { name: "Owner" })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Create prospect" }).click();
  await expect(dialog.getByText("Enter the prospect's name.")).toBeVisible();

  await dialog.getByLabel("Name").fill(NAME);
  await dialog.getByLabel("Company").fill("E2E, Inc.");
  await dialog.getByLabel("Deal value (USD)").fill("2500");
  await dialog.getByRole("combobox", { name: "Objections" }).click();
  await page.getByRole("option", { name: "Price" }).click();
  await page.keyboard.press("Escape");
  await expect(dialog.getByRole("combobox", { name: "Objections" })).toContainText("Price");
  await dialog.getByRole("button", { name: "Create prospect" }).click();
  await expect(page.getByText(`${NAME} was added.`)).toBeVisible();
  await expect(dialog).toBeHidden();
  await expect(rowLink(page, NAME)).toBeVisible();

  // Debounced search → URL.
  await page.getByRole("searchbox", { name: "Search prospects" }).fill("e2e, inc");
  await expect(page).toHaveURL(/q=e2e%2C\+inc/);
  await expect(rowLink(page, NAME)).toBeVisible();
  await expect(rowLink(page, "Jordan Lee")).toHaveCount(0);
  await expect(page.getByText("Showing 1–1 of 1 prospect")).toBeVisible();

  // Stage filter keeps it (new prospects start at "Prospect"); objection filter too.
  await page.getByRole("combobox", { name: "Stage" }).click();
  await page.getByRole("option", { name: "Qualified" }).click();
  await expect(page).toHaveURL(/stage=qualified/);
  await expect(page.getByText("No prospects match your filters")).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page).toHaveURL(/\/prospects$/);
  await expect(page.getByRole("searchbox", { name: "Search prospects" })).toHaveValue("");

  // Stale toggle.
  await page.getByRole("button", { name: "Stale" }).click();
  await expect(page).toHaveURL(/stale=1/);
  await expect(rowLink(page, "Marcus Chen")).toBeVisible();
  await expect(rowLink(page, NAME)).toHaveCount(0);
  await page.getByRole("button", { name: "Stale" }).click();

  // Sort by name (asc, then desc).
  await page.getByRole("link", { name: /^Name/ }).click();
  await expect(page).toHaveURL(/sort=name$/);
  await expect(page.getByRole("columnheader", { name: /^Name/ })).toHaveAttribute("aria-sort", "ascending");
  await page.getByRole("link", { name: /^Name/ }).click();
  await expect(page).toHaveURL(/sort=name&dir=desc/);
  await expect(page.getByRole("columnheader", { name: /^Name/ })).toHaveAttribute("aria-sort", "descending");
});

test("manager sees the team with owner column + filter; row click opens details", async ({ page }) => {
  await login(page, MANAGER);
  await expect(page.getByRole("columnheader", { name: "Owner" })).toBeVisible();
  await expect(rowLink(page, "Jordan Lee")).toBeVisible();
  await expect(rowLink(page, "Aisha Khan")).toBeVisible();

  await page.getByRole("combobox", { name: "Owner" }).click();
  await page.getByRole("option", { name: "Sam Rep" }).click();
  await expect(page).toHaveURL(new RegExp(`owner=${SAM_ID}`));
  await expect(rowLink(page, "Aisha Khan")).toBeVisible();
  await expect(rowLink(page, "Jordan Lee")).toHaveCount(0);

  await table(page).getByRole("row").filter({ hasText: "Aisha Khan" }).getByText("Adventure Works").click();
  await expect(page).toHaveURL(/\/prospects\/22222222-2222-4222-8222-000000000006$/);
});
