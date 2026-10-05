/**
 * Settings (Prompt 4): org settings, team invites (Mailpit), role changes.
 * Needs local Supabase with the seed (`npm run db:reset`) and `.env.local`.
 * Invited test users (e2e-invite-*@example.com) are deleted afterwards.
 */
import { createClient } from "@supabase/supabase-js";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

try {
  process.loadEnvFile(".env.local");
} catch {
  // CI provides env vars directly.
}

const PASSWORD = "Password123!";
const INVITEE_PASSWORD = "InvitePass123!";
const MANAGER = "morgan.manager@example.com";
const REP = "riley.rep@example.com";
const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";
const INVITE_PREFIX = "e2e-invite-";

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase env (.env.local).");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function deleteInvitedUsers() {
  const admin = adminClient();
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  for (const user of data.users) {
    if (user.email?.startsWith(INVITE_PREFIX)) await admin.auth.admin.deleteUser(user.id);
  }
}

async function login(page: Page, email: string, password = PASSWORD) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

async function chooseOption(page: Page, combobox: string, option: string) {
  await page.getByRole("combobox", { name: combobox, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

async function latestLink(request: APIRequestContext, to: string, since: number, type: string) {
  let link: string | undefined;
  await expect(async () => {
    const res = await request.get(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`);
    const { messages } = (await res.json()) as { messages: { ID: string; Created: string }[] };
    const latest = messages.find((m) => new Date(m.Created).getTime() >= since - 1000);
    expect(latest).toBeTruthy();
    const msg = await (await request.get(`${MAILPIT}/api/v1/message/${latest!.ID}`)).json();
    link = new RegExp(`href="([^"]*/auth/confirm\\?[^"]*type=${type})"`).exec(msg.HTML as string)?.[1];
    expect(link).toBeTruthy();
  }).toPass({ timeout: 15_000 });
  return link!.replaceAll("&amp;", "&");
}

test.describe.configure({ mode: "serial" });

test.beforeAll(deleteInvitedUsers);
test.afterAll(deleteInvitedUsers);

test("organization settings: validation, save, persisted, restored", async ({ page }) => {
  await login(page, MANAGER);
  await page.goto("/settings");
  await expect(
    page.getByText("Applies to new prospects; existing prospects keep their currency."),
  ).toBeVisible();

  const staleDays = page.getByLabel("Stale after (days)");
  await staleDays.fill("400");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("Use at most 365 days.")).toBeVisible();

  await staleDays.fill("30");
  await chooseOption(page, "Timezone", "Central Time (Chicago)");
  await chooseOption(page, "Default currency", "EUR · Euro");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("Settings saved.")).toBeVisible();

  await page.reload();
  await expect(page.getByLabel("Stale after (days)")).toHaveValue("30");
  await expect(page.getByRole("combobox", { name: "Timezone" })).toHaveText(/Chicago/);
  await expect(page.getByRole("combobox", { name: "Default currency" })).toHaveText(/EUR/);

  // Restore the defaults.
  await page.getByLabel("Stale after (days)").fill("14");
  await chooseOption(page, "Timezone", "Eastern Time (New York)");
  await chooseOption(page, "Default currency", "USD · US dollar");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("Settings saved.")).toBeVisible();
});

test("team: role change and the last-manager rule", async ({ page }) => {
  const { data: managers } = await adminClient().from("users").select("id").eq("role", "manager");
  test.skip((managers?.length ?? 0) !== 1, "needs the seeded single-manager state");

  await login(page, MANAGER);
  await page.goto("/settings?tab=team");
  await expect(page.getByRole("tab", { name: "Team", selected: true })).toBeVisible();
  await expect(page.getByTestId(`team-row-${REP}`)).toContainText("Riley Rep");

  // Demoting the only manager is refused by the database; the select reverts.
  await chooseOption(page, "Role for Morgan Manager", "Sales Rep");
  await expect(page.getByText("At least one manager must remain.")).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Role for Morgan Manager" })).toHaveText(
    "Admin/Manager",
  );

  // A normal role change, then back.
  await chooseOption(page, "Role for Sam Rep", "Admin/Manager");
  await expect(page.getByText("Sam Rep is now Admin/Manager.")).toBeVisible();
  await chooseOption(page, "Role for Sam Rep", "Sales Rep");
  await expect(page.getByText("Sam Rep is now Sales Rep.")).toBeVisible();
  const { data: sam } = await adminClient().from("users").select("role").eq("email", "sam.rep@example.com").single();
  expect(sam?.role).toBe("sales_rep");
});

test("invite a manager: Mailpit email → set password → login with the right role", async ({
  page,
  request,
}) => {
  const email = `${INVITE_PREFIX}${Date.now()}@example.com`;
  await login(page, MANAGER);
  await page.goto("/settings?tab=team");

  // Existing email → friendly error.
  await page.getByRole("button", { name: "Invite user" }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("Full name").fill("Riley Again");
  await dialog.getByLabel("Email").fill(REP);
  await dialog.getByRole("button", { name: "Send invite" }).click();
  await expect(page.getByText("A user with this email already exists.")).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();

  const since = Date.now();
  await page.getByRole("button", { name: "Invite user" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Full name").fill("Ivy Invited");
  await dialog.getByLabel("Email").fill(email);
  await chooseOption(page, "Role", "Admin/Manager");
  await dialog.getByRole("button", { name: "Send invite" }).click();
  await expect(page.getByText(`Invitation sent to ${email}.`)).toBeVisible();
  await expect(page.getByTestId(`team-row-${email}`)).toContainText("Ivy Invited");

  // Role is in app_metadata and mirrored to public.users.
  const admin = adminClient();
  const { data: row } = await admin.from("users").select("id, role").eq("email", email).single();
  expect(row?.role).toBe("manager");
  const { data: authUser } = await admin.auth.admin.getUserById(row!.id);
  expect(authUser.user?.app_metadata.role).toBe("manager");

  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login$/);

  const link = await latestLink(request, email, since, "invite");
  await page.goto(link);
  await expect(page).toHaveURL(/\/set-password$/);
  await page.getByLabel("New password").fill(INVITEE_PASSWORD);
  await page.getByLabel("Confirm password").fill(INVITEE_PASSWORD);
  await page.getByRole("button", { name: "Save password" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await login(page, email, INVITEE_PASSWORD);
  await expect(page.getByTestId("current-user-name")).toHaveText("Ivy Invited");
  await expect(page.getByTestId("current-user-role")).toHaveText("Admin/Manager");
  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page).toHaveURL(/\/settings$/);
});

test("invite a sales rep: logs in as a rep without Settings", async ({ page, request }) => {
  const email = `${INVITE_PREFIX}rep-${Date.now()}@example.com`;
  await login(page, MANAGER);
  await page.goto("/settings?tab=team");

  const since = Date.now();
  await page.getByRole("button", { name: "Invite user" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Full name").fill("Rex Rep");
  await dialog.getByLabel("Email").fill(email);
  await dialog.getByRole("button", { name: "Send invite" }).click();
  await expect(page.getByText(`Invitation sent to ${email}.`)).toBeVisible();
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login$/);

  await page.goto(await latestLink(request, email, since, "invite"));
  await page.getByLabel("New password").fill(INVITEE_PASSWORD);
  await page.getByLabel("Confirm password").fill(INVITEE_PASSWORD);
  await page.getByRole("button", { name: "Save password" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByTestId("current-user-role")).toHaveText("Sales Rep");
  await expect(page.getByRole("link", { name: "Settings" })).toHaveCount(0);
});
