/**
 * Auth + app shell (Prompt 3). Needs local Supabase running with the seed
 * (`npm run db:reset`) and `.env.local`. Mailpit: http://127.0.0.1:54324.
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
const RESET_USER = "sam.rep@example.com";
const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";

async function login(page: Page, email: string, password = PASSWORD) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
}

test.describe.configure({ mode: "serial" });

test("unauthenticated users are sent to /login with a safe next", async ({ page }) => {
  await page.goto("/prospects");
  await expect(page).toHaveURL(/\/login\?next=%2Fprospects$/);
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
});

test("invalid password shows an error toast", async ({ page }) => {
  await login(page, REP, "wrong-password");
  await expect(page.getByText("Invalid email or password.")).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test("rep: login honours next, no Settings nav, /settings and /login redirect, logout", async ({ page }) => {
  await page.goto("/follow-ups");
  await page.getByLabel("Email").fill(REP);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/follow-ups$/);

  await expect(page.getByTestId("current-user-name")).toHaveText("Riley Rep");
  await expect(page.getByTestId("current-user-role")).toHaveText("Sales Rep");
  const nav = page.getByRole("navigation", { name: "Main" });
  for (const label of ["Dashboard", "Pipeline", "Prospects", "Follow-ups", "Reports"]) {
    await expect(nav.getByRole("link", { name: label })).toBeVisible();
  }
  await expect(page.getByRole("link", { name: "Settings" })).toHaveCount(0);

  await page.goto("/settings");
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto("/login");
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login\?next=%2Fdashboard$/);
});

test("open redirect: unsafe next falls back to /dashboard", async ({ page }) => {
  await page.goto("/login?next=//evil.example.com");
  await page.getByLabel("Email").fill(REP);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL("/dashboard");
});

test("manager sees Settings", async ({ page }) => {
  await login(page, MANAGER);
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
});

test("mobile: nav sheet opens and closes on navigation", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await login(page, REP);
  await page.getByRole("button", { name: "Open menu" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("link", { name: "Reports" }).click();
  await expect(page).toHaveURL(/\/reports$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("invalid confirm link shows a message", async ({ page }) => {
  await page.goto("/auth/confirm?token_hash=nope&type=recovery");
  await expect(page).toHaveURL(/\/login\?error=invalid_link$/);
  await expect(page.getByRole("alert").filter({ hasText: "invalid or has expired" })).toBeVisible();
});

test.describe("forgot password", () => {
  const NEW_PASSWORD = "NewPassword456!";

  test.afterAll(async () => {
    // Restore the seeded password so the suite is repeatable.
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return;
    const admin = createClient(url, key, { auth: { persistSession: false } });
    const { data } = await admin.auth.admin.listUsers();
    const user = data.users.find((u) => u.email === RESET_USER);
    if (user) await admin.auth.admin.updateUserById(user.id, { password: PASSWORD });
  });

  test("recovery email → /set-password → /dashboard, new password works", async ({ page, request }) => {
    const since = Date.now();
    await page.goto("/forgot-password");
    await page.getByLabel("Email").fill(RESET_USER);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByRole("status")).toContainText("a reset link is on its way");

    let link: string | undefined;
    await expect(async () => {
      const res = await request.get(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${RESET_USER}`)}`);
      const { messages } = (await res.json()) as { messages: { ID: string; Created: string }[] };
      const latest = messages.find((m) => new Date(m.Created).getTime() >= since - 1000);
      expect(latest).toBeTruthy();
      const msg = await (await request.get(`${MAILPIT}/api/v1/message/${latest!.ID}`)).json();
      link = /href="([^"]*\/auth\/confirm\?[^"]*type=recovery)"/.exec(msg.HTML as string)?.[1];
      expect(link).toBeTruthy();
    }).toPass({ timeout: 15_000 });

    await page.goto(link!.replaceAll("&amp;", "&"));
    await expect(page).toHaveURL(/\/set-password$/);

    await page.getByLabel("New password").fill("short");
    await page.getByLabel("Confirm password").fill("different");
    await page.getByRole("button", { name: "Save password" }).click();
    await expect(page.getByText("Use at least 8 characters.")).toBeVisible();
    await expect(page.getByText("Passwords don't match.")).toBeVisible();

    await page.getByLabel("New password").fill(NEW_PASSWORD);
    await page.getByLabel("Confirm password").fill(NEW_PASSWORD);
    await page.getByRole("button", { name: "Save password" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await login(page, RESET_USER, NEW_PASSWORD);
    await expect(page).toHaveURL(/\/dashboard$/);
  });
});
