/**
 * Loads a SMALL demo dataset into a project (a few prospects per sales rep,
 * each rep with their own follow-up schedule), or removes it again. Meant for
 * a fresh production project so the CRM isn't empty on day one. The full test
 * seed (supabase/seed.sql) is local-only and never pushed.
 *
 *   npm run demo-data -- --dotenv .env.production.local [--clear] [--yes]
 *
 * - Uses the first two sales reps (by creation date); create them first with
 *   `npm run create-user -- --role sales_rep ...`.
 * - Every demo prospect has a fixed id (dddddddd-dddd-4ddd-8ddd-…), so
 *   re-running replaces the demo rows and --clear removes exactly them
 *   (activities, follow-ups, stage history and AI insights cascade).
 * - Prospects are created "today" at their current stage (attributed to the
 *   rep); calls/notes are back-dated activities, follow-ups use org-local dates.
 *
 * Env (from the shell or --dotenv): SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL,
 * SUPABASE_SERVICE_ROLE_KEY. Runs with Node 22's built-in type stripping.
 */
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";

import { TZDate } from "@date-fns/tz";
import { createClient } from "@supabase/supabase-js";

class CliError extends Error {}

const USAGE = `Usage:
  npm run demo-data -- --dotenv <file> [--clear] [--yes]

Options:
  --dotenv <path>   Load env vars from a dotenv file (e.g. .env.production.local)
  --clear           Remove the demo prospects instead of (re)loading them
  --yes             Don't ask for confirmation on a non-local project
  --help            Show this help`;

const demoId = (n: number) => `dddddddd-dddd-4ddd-8ddd-${String(n).padStart(12, "0")}`;

type Activity = { type: "call" | "conversation" | "note" | "demo"; at: [days: number, time: string]; content: string };
type FollowUp = { dueInDays: number; note: string };
type DemoProspect = {
  n: number;
  name: string;
  company: string;
  email: string;
  phone: string;
  stage: string;
  decisionMaker: "yes" | "no" | "unknown";
  objections: string[];
  objectionNotes?: string;
  notes: string;
  dealValue: number | null;
  demoAt?: [days: number, time: string];
  closeReason?: string;
  closeNotes?: string;
  activities: Activity[];
  followUps: FollowUp[];
};

// Slot 0 = first sales rep, slot 1 = second sales rep. Different follow-up
// calendars: rep 1 has today/overdue/+3 days, rep 2 has +1/+5 days.
const DEMO: DemoProspect[][] = [
  [
    {
      n: 1,
      name: "Daniel Brooks",
      company: "Brightline Logistics",
      email: "daniel.brooks@example.com",
      phone: "+1 (555) 010-2001",
      stage: "contacted",
      decisionMaker: "unknown",
      objections: ["timing"],
      objectionNotes: "Wants to revisit after their Q4 budget review.",
      notes: "Inbound from LinkedIn. Interested in route-planning automation for 40 drivers.",
      dealValue: 12000,
      activities: [
        { type: "call", at: [-2, "10:30"], content: "Reached Daniel after a voicemail. Interested; asked for a short overview deck." },
      ],
      followUps: [{ dueInDays: 0, note: "Send overview deck and propose a discovery call" }],
    },
    {
      n: 2,
      name: "Olivia Chen",
      company: "Harbor Health Clinics",
      email: "olivia.chen@example.com",
      phone: "+1 (555) 010-2002",
      stage: "qualified",
      decisionMaker: "yes",
      objections: ["price", "competitor"],
      objectionNotes: "Currently on a competitor contract that renews in 3 months.",
      notes: "COO, owns the budget. 6 locations; pain point is missed patient follow-ups.",
      dealValue: 28500,
      activities: [
        { type: "conversation", at: [-6, "14:00"], content: "Discovery call: 6 clinics, ~30 staff. Main pain is manual follow-up tracking." },
        { type: "note", at: [-1, "16:15"], content: "Asked for a price comparison against their current vendor." },
      ],
      followUps: [{ dueInDays: -2, note: "Send pricing comparison vs. current vendor" }],
    },
    {
      n: 3,
      name: "Marcus Reed",
      company: "Summit Fitness Group",
      email: "marcus.reed@example.com",
      phone: "+1 (555) 010-2003",
      stage: "demo_booked",
      decisionMaker: "no",
      objections: ["no_authority"],
      notes: "Operations manager; the finance director signs off on purchases.",
      dealValue: 9800,
      demoAt: [2, "11:00"],
      activities: [
        { type: "conversation", at: [-3, "11:00"], content: "Booked a demo. Marcus will try to bring the finance director." },
      ],
      followUps: [{ dueInDays: 3, note: "Confirm attendees, including the finance director" }],
    },
  ],
  [
    {
      n: 4,
      name: "Sophia Martinez",
      company: "Crestview Realty",
      email: "sophia.martinez@example.com",
      phone: "+1 (555) 010-2004",
      stage: "conversation",
      decisionMaker: "unknown",
      objections: ["budget"],
      notes: "Small brokerage (12 agents). Budget not confirmed yet.",
      dealValue: null,
      activities: [
        { type: "call", at: [-4, "09:45"], content: "Good first conversation; wants to see how other small brokerages use it." },
      ],
      followUps: [{ dueInDays: 1, note: "Share a case study for small brokerages" }],
    },
    {
      n: 5,
      name: "Ethan Walker",
      company: "Northpeak Manufacturing",
      email: "ethan.walker@example.com",
      phone: "+1 (555) 010-2005",
      stage: "demo_attended",
      decisionMaker: "yes",
      objections: ["timing"],
      objectionNotes: "Worried about rolling out during peak season (Nov–Dec).",
      notes: "VP Operations. Ops team liked the dashboards in the demo.",
      dealValue: 42000,
      demoAt: [-1, "15:00"],
      activities: [
        { type: "demo", at: [-1, "15:00"], content: "Demo went well; asked for a phased rollout plan starting in January." },
      ],
      followUps: [{ dueInDays: 5, note: "Send phased rollout plan and proposal" }],
    },
    {
      n: 6,
      name: "Grace Kim",
      company: "Lumen Dental Partners",
      email: "grace.kim@example.com",
      phone: "+1 (555) 010-2006",
      stage: "closed_won",
      decisionMaker: "yes",
      objections: [],
      notes: "Practice owner. Fast decision after a reference call.",
      dealValue: 15600,
      closeReason: "product_fit",
      closeNotes: "Signed an annual plan.",
      activities: [
        { type: "conversation", at: [-5, "13:30"], content: "Reference call went well; agreed on the annual plan." },
      ],
      followUps: [],
    },
  ],
];

const ALL_IDS = DEMO.flat().map((p) => demoId(p.n));

function readArgs() {
  try {
    const { values } = parseArgs({
      options: {
        dotenv: { type: "string" },
        clear: { type: "boolean", default: false },
        yes: { type: "boolean", default: false },
        help: { type: "boolean", default: false },
      },
      allowPositionals: false,
    });
    if (values.help) {
      console.log(USAGE);
      process.exit(0);
    }
    return values;
  } catch (error) {
    throw new CliError(`${(error as Error).message}\n\n${USAGE}`);
  }
}

function isLocalHost(host: string): boolean {
  return ["localhost", "127.0.0.1", "[::1]", "host.docker.internal"].includes(host.replace(/:\d+$/, ""));
}

async function confirmTarget(host: string, action: string, skip: boolean) {
  if (isLocalHost(host) || skip) return;
  if (!process.stdin.isTTY) throw new CliError(`Target ${host} is not local. Re-run with --yes to confirm.`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`${action} on ${host}? Type "yes" to continue: `);
  rl.close();
  if (answer.trim().toLowerCase() !== "yes") throw new CliError("Aborted.");
}

/** "YYYY-MM-DD" in `tz`, `days` from today. */
function orgDate(tz: string, days: number): string {
  const today = new TZDate(Date.now(), tz);
  const d = new TZDate(today.getFullYear(), today.getMonth(), today.getDate() + days, tz);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** UTC ISO instant for org-local `days` from today at "HH:mm" (never in the future for activities). */
function orgInstant(tz: string, [days, time]: [number, string], notAfterNow = false): string {
  const today = new TZDate(Date.now(), tz);
  const [h, m] = time.split(":").map(Number);
  const at = new TZDate(today.getFullYear(), today.getMonth(), today.getDate() + days, h, m, tz);
  const ms = notAfterNow ? Math.min(at.getTime(), Date.now() - 60_000) : at.getTime();
  return new Date(ms).toISOString();
}

async function main() {
  const values = readArgs();
  if (values.dotenv) {
    try {
      process.loadEnvFile(values.dotenv);
    } catch (error) {
      throw new CliError(`Could not read --dotenv ${values.dotenv}: ${(error as Error).message}`);
    }
  }
  const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !key) throw new CliError("Missing SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) / SUPABASE_SERVICE_ROLE_KEY.");
  const host = new URL(url).host;
  console.log(`Supabase project: ${host}${isLocalHost(host) ? " (local)" : ""}`);
  await confirmTarget(host, values.clear ? "Remove the demo data" : "Load the demo data", values.yes);

  const db = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

  const del = await db.from("prospects").delete().in("id", ALL_IDS).select("id");
  if (del.error) throw new CliError(`Removing demo prospects failed: ${del.error.message}`);
  if (values.clear) {
    console.log(`Removed ${del.data.length} demo prospect(s).`);
    return;
  }

  const settings = await db.from("org_settings").select("timezone").maybeSingle();
  if (settings.error || !settings.data) {
    throw new CliError(`Could not read org_settings (${settings.error?.message ?? "no row"}). Are the migrations applied?`);
  }
  const tz = settings.data.timezone as string;

  const reps = await db.from("users").select("id, full_name, email").eq("role", "sales_rep").order("created_at").limit(2);
  if (reps.error) throw new CliError(`Could not read users: ${reps.error.message}`);
  if (reps.data.length === 0) {
    throw new CliError("No sales reps yet. Create them first: npm run create-user -- --role sales_rep --email … --name … --link");
  }

  let prospects = 0;
  let followUps = 0;
  for (const [slot, rep] of reps.data.entries()) {
    for (const p of DEMO[slot]) {
      const id = demoId(p.n);
      const ins = await db.from("prospects").insert({
        id,
        name: p.name,
        company: p.company,
        email: p.email,
        phone: p.phone,
        stage: p.stage,
        decision_maker_status: p.decisionMaker,
        objections: p.objections,
        objection_notes: p.objectionNotes ?? null,
        notes: p.notes,
        deal_value: p.dealValue,
        demo_at: p.demoAt ? orgInstant(tz, p.demoAt) : null,
        close_reason: p.closeReason ?? null,
        close_notes: p.closeNotes ?? null,
        owner_id: rep.id,
        created_by: rep.id,
      });
      if (ins.error) throw new CliError(`Inserting ${p.name} failed: ${ins.error.message}`);
      prospects++;

      if (p.activities.length > 0) {
        const acts = await db.from("activities").insert(
          p.activities.map((a) => ({
            prospect_id: id,
            user_id: rep.id,
            type: a.type,
            content: a.content,
            occurred_at: orgInstant(tz, a.at, true),
          })),
        );
        if (acts.error) throw new CliError(`Inserting activities for ${p.name} failed: ${acts.error.message}`);
      }

      if (p.followUps.length > 0) {
        const fus = await db.from("follow_ups").insert(
          p.followUps.map((f) => ({
            prospect_id: id,
            due_date: orgDate(tz, f.dueInDays),
            note: f.note,
            created_by: rep.id,
          })),
        );
        if (fus.error) throw new CliError(`Inserting follow-ups for ${p.name} failed: ${fus.error.message}`);
        followUps += p.followUps.length;
      }
    }
    console.log(`  ${rep.full_name || rep.email}: ${DEMO[slot].length} prospects`);
  }
  console.log(`Loaded ${prospects} demo prospects and ${followUps} follow-ups (timezone ${tz}).`);
  console.log("Remove them before going live with: npm run demo-data -- --dotenv <file> --clear");
}

main().catch((error: unknown) => {
  console.error(error instanceof CliError ? `Error: ${error.message}` : error);
  process.exit(1);
});
