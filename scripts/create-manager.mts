/**
 * Creates (or updates the role of) a CRM account. Meant for the FIRST manager
 * in a new environment (production has no seed users and public sign-up is
 * off) and for sales reps before SMTP works (`--link`). Safe to re-run: an
 * existing user only gets the requested role, nothing is duplicated.
 *
 *   npm run create-manager -- --email you@company.com --name "Your Name" \
 *     [--role manager|sales_rep] [--dotenv .env.production.local] [--link] [--yes]
 *   npm run create-user -- ...   (same script)
 *
 * Env (from the shell or --dotenv):
 *   SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL   project URL
 *   SUPABASE_SERVICE_ROLE_KEY                  service role key (bypasses RLS; never commit it)
 *   NEXT_PUBLIC_SITE_URL or SITE_URL           app URL, for the invite link (required with --link)
 *
 * The script never handles a password:
 *   default  sends the Supabase invite email; the person sets their own
 *            password through /auth/confirm → /set-password.
 *   --link   prints a one-time invite link instead of sending an email (use
 *            when SMTP isn't configured yet). Single use, expires with the
 *            project's email OTP expiry. Treat it like a password.
 * Existing users get app_metadata.role = <role> (default "manager"); their
 * password is untouched (they can use "Forgot password"). Demoting the last
 * manager is refused by the database.
 *
 * Runs with Node 22's built-in TypeScript type stripping: no build step.
 */
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";

import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { z } from "zod";

const ROLES = ["manager", "sales_rep"] as const;
type Role = (typeof ROLES)[number];
const ROLE_LABELS: Record<Role, string> = { manager: "manager", sales_rep: "sales rep" };

const USAGE = `Usage:
  npm run create-manager -- --email <email> --name "<Full Name>" [options]

Options:
  --email <email>       Email of the user (required)
  --name <full name>    Full name (required; on an existing user it is only set when they have none)
  --role <role>         manager (default) or sales_rep
  --dotenv <path>       Load env vars from a dotenv file (e.g. .env.production.local)
  --link                Print a one-time invite link instead of sending the invite email
  --yes                 Don't ask for confirmation on a non-local project
  --help                Show this help

Env: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY,
     NEXT_PUBLIC_SITE_URL (or SITE_URL) for the invite redirect / link.`;

class CliError extends Error {}

const argsSchema = z.object({
  email: z.string().trim().toLowerCase().email("--email must be a valid email address."),
  name: z.string().trim().min(1, "--name is required.").max(100, "--name: use at most 100 characters."),
  role: z.enum(ROLES, "--role must be manager or sales_rep."),
});

function readArgs() {
  let parsed;
  try {
    parsed = parseArgs({
      options: {
        email: { type: "string" },
        name: { type: "string" },
        role: { type: "string", default: "manager" },
        dotenv: { type: "string" },
        link: { type: "boolean", default: false },
        yes: { type: "boolean", default: false },
        help: { type: "boolean", default: false },
      },
      allowPositionals: false,
    });
  } catch (error) {
    throw new CliError(`${(error as Error).message}\n\n${USAGE}`);
  }
  const { values } = parsed;
  if (values.help) {
    console.log(USAGE);
    process.exit(0);
  }
  return values;
}

function loadEnv(envFile: string | undefined) {
  if (!envFile) return;
  try {
    process.loadEnvFile(envFile);
  } catch (error) {
    throw new CliError(`Could not read --dotenv ${envFile}: ${(error as Error).message}`);
  }
}

function readConfig() {
  const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL || "").trim().replace(/\/+$/, "");

  const missing: string[] = [];
  if (!url) missing.push("SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)");
  if (!serviceRoleKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (missing.length > 0) {
    throw new CliError(`Missing env: ${missing.join(", ")}. Set them in the shell or pass --dotenv <path>.`);
  }

  let host: string;
  try {
    host = new URL(url).host;
  } catch {
    throw new CliError(`SUPABASE_URL is not a valid URL: ${url}`);
  }
  if (siteUrl) {
    try {
      new URL(siteUrl);
    } catch {
      throw new CliError(`NEXT_PUBLIC_SITE_URL / SITE_URL is not a valid URL: ${siteUrl}`);
    }
  }
  return { url, host, serviceRoleKey, siteUrl };
}

function isLocalHost(host: string): boolean {
  const hostname = host.replace(/:\d+$/, "");
  return ["localhost", "127.0.0.1", "[::1]", "host.docker.internal"].includes(hostname);
}

async function confirmTarget(host: string, role: Role, skip: boolean) {
  if (isLocalHost(host) || skip) return;
  if (!process.stdin.isTTY) {
    throw new CliError(`Target ${host} is not local. Re-run with --yes to confirm in a non-interactive shell.`);
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`Create/update a ${ROLE_LABELS[role]} on ${host}? Type "yes" to continue: `);
  rl.close();
  if (answer.trim().toLowerCase() !== "yes") throw new CliError("Aborted.");
}

/** Friendly message for GoTrue / network errors. */
function describeError(action: string, error: { message?: string; status?: number; code?: string } | null): string {
  const status = error?.status;
  const code = error?.code ?? "";
  const message = error?.message ?? "unknown error";
  if (status === 401 || status === 403 || /invalid (api key|jwt)|not_admin|bad_jwt/i.test(`${code} ${message}`)) {
    return `${action}: the service role key was rejected (${message}). Check SUPABASE_SERVICE_ROLE_KEY matches the project URL.`;
  }
  if (status === 429 || code === "over_email_send_rate_limit") {
    return `${action}: email rate limit reached (${message}). Wait, raise the limit / configure SMTP, or use --link.`;
  }
  if (/fetch failed|ECONNREFUSED|ENOTFOUND|network/i.test(message)) {
    return `${action}: could not reach Supabase (${message}). Check SUPABASE_URL (local: is \`npx supabase start\` running?).`;
  }
  if (/smtp|sending (invite|email)|error sending/i.test(message)) {
    return `${action}: Supabase could not send the email (${message}). Configure SMTP in the dashboard or use --link.`;
  }
  return `${action} failed: ${message}${status ? ` (HTTP ${status})` : ""}${code ? ` [${code}]` : ""}`;
}

async function findUserByEmail(admin: SupabaseClient, email: string): Promise<User | null> {
  const perPage = 1000;
  for (let page = 1; page <= 100; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw new CliError(describeError("Looking up users", error));
    const match = data.users.find((u) => u.email?.toLowerCase() === email);
    if (match) return match;
    if (data.users.length < perPage) return null;
  }
  return null;
}

async function setRole(admin: SupabaseClient, user: User, role: Role) {
  const { error } = await admin.auth.admin.updateUserById(user.id, {
    app_metadata: { ...user.app_metadata, role },
  });
  return error;
}

/**
 * Users added in the Supabase dashboard have no name, so public.users.full_name
 * holds the trigger's fallback (the email's local part). Replace only that
 * placeholder (or an empty name); never overwrite a real name.
 */
async function fillMissingName(admin: SupabaseClient, user: User, name: string): Promise<boolean> {
  const { data, error } = await admin.from("users").select("full_name").eq("id", user.id).maybeSingle();
  if (error || !data) return false;
  const current = (data.full_name ?? "").trim();
  const placeholder = (user.email ?? "").split("@")[0];
  if (current !== "" && current !== placeholder) return false;
  if (current === name) return false;
  const meta = await admin.auth.admin.updateUserById(user.id, {
    user_metadata: { ...user.user_metadata, full_name: name },
  });
  if (meta.error) throw new CliError(describeError("Setting the user's name", meta.error));
  const update = await admin.from("users").update({ full_name: name }).eq("id", user.id);
  if (update.error) throw new CliError(`Setting the user's name failed: ${update.error.message}`);
  return true;
}

/** public.users.role is synced from app_metadata by a trigger; double-check it. */
async function checkPublicRole(admin: SupabaseClient, userId: string, role: Role) {
  const { data, error } = await admin.from("users").select("role").eq("id", userId).maybeSingle();
  if (error) {
    console.warn(`Warning: could not read public.users (${error.message}). Are the migrations applied?`);
    return;
  }
  if (data?.role !== role) {
    throw new CliError(
      `app_metadata.role is "${role}" but public.users.role is "${data?.role ?? "missing"}". ` +
        "Check that all migrations are applied (`npx supabase db push`).",
    );
  }
}

async function main() {
  const values = readArgs();
  loadEnv(values.dotenv);

  const input = argsSchema.safeParse({ email: values.email ?? "", name: values.name ?? "", role: values.role });
  if (!input.success) {
    throw new CliError(`${input.error.issues.map((i) => i.message).join("\n")}\n\n${USAGE}`);
  }
  const { email, name, role } = input.data;
  const label = ROLE_LABELS[role];
  const config = readConfig();
  if (values.link && !config.siteUrl) {
    throw new CliError("--link needs NEXT_PUBLIC_SITE_URL (or SITE_URL), e.g. https://crm.example.com");
  }

  console.log(`Supabase project: ${config.host}${isLocalHost(config.host) ? " (local)" : ""}`);
  await confirmTarget(config.host, role, values.yes);

  const admin = createClient(config.url, config.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });

  const existing = await findUserByEmail(admin, email);
  if (existing) {
    if (await fillMissingName(admin, existing, name)) console.log(`Set the name of ${email} to "${name}".`);
    if (existing.app_metadata?.role === role) {
      await checkPublicRole(admin, existing.id, role);
      console.log(`${email} is already a ${label} (user ${existing.id}). Nothing to do.`);
      return;
    }
    const error = await setRole(admin, existing, role);
    if (error) throw new CliError(describeError("Changing the user's role", error));
    await checkPublicRole(admin, existing.id, role);
    console.log(`Changed existing user ${email} (user ${existing.id}) to ${label}.`);
    console.log("Their password is unchanged; they can use \"Forgot password\" on the login page if needed.");
    return;
  }

  const redirectTo = config.siteUrl ? `${config.siteUrl}/auth/confirm` : undefined;
  let user: User;
  let inviteLink: string | null = null;

  if (values.link) {
    const { data, error } = await admin.auth.admin.generateLink({
      type: "invite",
      email,
      options: { data: { full_name: name }, redirectTo },
    });
    if (error || !data?.user || !data.properties?.hashed_token) {
      throw new CliError(describeError("Creating the invite link", error));
    }
    user = data.user;
    inviteLink = `${config.siteUrl}/auth/confirm?token_hash=${encodeURIComponent(data.properties.hashed_token)}&type=invite`;
  } else {
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { full_name: name },
      redirectTo,
    });
    if (error || !data?.user) throw new CliError(describeError("Sending the invite", error));
    user = data.user;
  }

  const roleError = await setRole(admin, user, role);
  if (roleError) {
    // Don't leave a half-configured account (with the default role) behind.
    await admin.auth.admin.deleteUser(user.id);
    throw new CliError(describeError(`Setting the ${label} role (the new user was removed again)`, roleError));
  }
  await checkPublicRole(admin, user.id, role);

  console.log(`Created ${label} ${name} <${email}> (user ${user.id}).`);
  if (inviteLink) {
    console.log("\nOne-time invite link (single use, expires; share it privately, then it's useless):");
    console.log(inviteLink);
    console.log("\nOpening it lets them set their password at /set-password.");
  } else {
    console.log("Invite email sent. The link in it opens /set-password on the app's Site URL.");
    if (!config.siteUrl) {
      console.log("Note: NEXT_PUBLIC_SITE_URL is not set; the link uses the Site URL configured in Supabase Auth.");
    }
  }
}

main().catch((error: unknown) => {
  if (error instanceof CliError) {
    console.error(`Error: ${error.message}`);
  } else {
    console.error("Unexpected error:", error);
  }
  process.exit(1);
});
