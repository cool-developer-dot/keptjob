# AI Sales CRM: V1 Specification

The source of truth for V1. If a prompt conflicts with this file, this file wins.

## 1. Product

A simple AI-assisted sales CRM for an internal sales team. Leads/customers have no platform access in V1; only sales reps and managers use the CRM.

**Main goal.** The salesperson should always know:
1. Who to contact
2. What happened in the last conversation
3. What the main objection is
4. What the next follow-up is
5. What the AI recommends doing next
6. Which deals need attention

## 2. Pipeline

Stage order (enum values in brackets):

Prospect `prospect` → Contacted `contacted` → Conversation `conversation` → Qualified `qualified` → Demo Booked `demo_booked` → Demo Attended `demo_attended` → Follow-up `follow_up` → Closed Won `closed_won` / Closed Lost `closed_lost`

- Prospects can move **forward, backward or skip stages**. The pipeline is never strictly linear.
- **Every** stage change is recorded in `stage_history` with the user and a timestamp.
- Moving to Closed Won / Closed Lost **requires** a structured close reason (optional notes).
- Moving a prospect out of a closed stage (reopening) clears the current close reason, notes and closed_at. History keeps the old values.

## 3. Prospect fields

Name, company, email, phone · current stage · decision-maker status (Yes / No / Unknown) · objections (multiple) + optional objection notes · conversation notes · next follow-up date · demo date/time · outcome (close reason + close notes + closed_at) · deal value (optional) + currency · owner (sales rep) · created/updated timestamps · last activity timestamp · full activity history.

**Objection categories** (multi-select): Price `price`, Timing `timing`, Competitor `competitor`, Budget `budget`, No authority `no_authority`, Not interested `not_interested`, Other `other`.

**Closed Lost reasons:** Price `price`, Timing `timing`, Competitor `competitor`, No budget `no_budget`, No response `no_response`, Not a fit `not_a_fit`, Other `other`.

**Closed Won reasons** (proposed defaults; the client can change them): Product fit `product_fit`, Price/value `price_value`, Relationship `relationship`, Urgent need `urgent_need`, Other `other`.

**Next follow-up date** on a prospect is *derived*: it equals the earliest pending follow-up's due date. It is managed through follow-ups, not edited directly.

## 4. Users, roles, permissions

- Roles: **Admin/Manager** (`manager`) and **Sales Rep** (`sales_rep`).
- Sales reps see and manage **only their own** prospects (and the related activities, follow-ups, history and AI insights).
- Managers see the **entire team's** prospects and can **reassign** prospects between reps. A reassignment is logged in the activity history and moves pending follow-ups to the new owner.
- Only managers can delete prospects. Activities, stage history and AI insights are append-only.
- **No public sign-up.** Managers invite users from a minimal Settings → Team page (name, email, role). Invited users set their password through the invite link.
- Login is standard email + password, with "forgot password".
- The role lives in `raw_app_meta_data` / `public.users.role`. It is never taken from user-editable metadata.
- At least one manager must always exist.

## 5. Organization settings (one row, editable by managers)

- `default_currency`: ISO 4217 code, default `USD`. New prospects take this currency, so it isn't hardcoded anywhere.
- `timezone`: default `America/New_York`. Allowed: America/New_York, America/Chicago, America/Denver, America/Phoenix, America/Los_Angeles, America/Anchorage, Pacific/Honolulu.
- `stale_days`: default `14`.

## 6. Time

- All timestamps are stored in UTC (`timestamptz`).
- The **org timezone** is used for: follow-ups due today, overdue follow-ups, dashboard dates, activity timestamp display, and demo date/time entry and display.
- "Today" = the current date in the org timezone (SQL: `org_today()`, TS: `src/lib/time.ts`).
- The org timezone is never hardcoded outside the settings default.

## 7. Activities (timeline)

Types: call, conversation, note, demo, follow_up, stage_change, owner_change, ai_insight. Each is linked to a prospect, with author and `occurred_at`.

`last_activity_at` is updated by human sales activity only: call, conversation, note, demo, follow_up, stage_change. **Not** by ai_insight or owner_change.

## 8. Follow-ups

Each follow-up has: prospect, owner, due date, note/task, status (pending/completed), completed_at, completed_by.

Views: due today, overdue (pending and due before today), upcoming, completed. Completing a follow-up logs a `follow_up` activity.

## 9. Workflow automation (rule-based, no AI)

1. Record every stage change in `stage_history` (database trigger).
2. Moving to **Demo Booked**: prompt for the demo date/time and follow-up details (Save / Skip / Cancel).
3. Moving to **Demo Attended**: prompt for demo notes and the next follow-up (Save / Skip / Cancel).
4. Flag follow-ups as **due today / overdue** (org timezone).
5. Moving to **Closed Won / Closed Lost**: close reason **required**, plus optional notes. Offer to complete the remaining pending follow-ups.
6. Flag open deals (not closed) with no activity for `stale_days` (14) as **stale**. This is a warning only and never changes the stage.
7. **Never** automatically send messages or emails, or change stages.

## 10. AI insights

- One OpenAI model via the **Responses API** with structured output. The model is set by the `OPENAI_MODEL` env var.
- **Manual only:** a "Generate AI Insights" button and "Regenerate" after new information. There is no automatic call when notes change.
- Input: prospect fields, objections, notes, recent activities, stage history, org "today".
- Output: `summary`, `decision_maker_status` (yes/no/unknown), `main_objection`, `recommended_next_step`, `deal_health` (high/medium/low).
- Shown on the Prospect Detail page. The AI **never writes prospect fields** on its own. The user must click "Apply" (e.g. decision-maker status) or "Create follow-up from next step".
- Stored in `ai_insights`, with history.

## 11. Pages

1. Login (+ accept invite / set password, forgot password)
2. Dashboard
3. Pipeline (Kanban)
4. Prospects (list)
5. Prospect Details
6. Follow-ups
7. Reports
8. Settings (managers only: organization settings + team invites/roles). This is the minimum needed for decisions 4, 5 and 12; it is not a large admin system.

## 12. Reporting

Total prospects · prospects by current stage · counts for contacted, conversations, qualified, demos booked, demos attended, follow-ups, closed won, closed lost · pipeline value · conversion rates · win rate · overdue follow-ups.

- **Funnel:** Prospects → Contacted → Conversation → Qualified → Demo Booked → Demo Attended → Closed Won. Funnel count for stage X = distinct prospects whose **highest stage ever reached** (from `stage_history`, using the order in §2 with `closed_lost` unranked) is ≥ X. This keeps the funnel correct when stages are skipped or reversed.
- **Conversion rate** between consecutive funnel steps = next ÷ current. Overall = Closed Won ÷ Prospects.
- **Win rate** = closed_won ÷ (closed_won + closed_lost), for prospects closed in the selected period.
- **Pipeline value** = sum of `deal_value` of open (non-closed) prospects, grouped by currency. Prospects without a deal value are **ignored**, and the count of open prospects without a value is shown next to the total.
- Date filters: the funnel uses prospects created in the period; win rate and won value use prospects closed in the period; pipeline value and overdue counts are always "now".
- Managers can filter by rep; reps only ever see their own numbers.

## 13. Stack

TypeScript · Next.js (App Router) + React · Tailwind CSS · shadcn/ui · Next.js server actions/route handlers · Supabase (Postgres, Auth, RLS, Realtime) · Zod · Recharts · @dnd-kit · @date-fns/tz · OpenAI Responses API · Vercel · GitHub.

## 14. Out of scope for V1 (do NOT add)

Customer portal · invoicing · payments · inventory · support ticketing · marketing automation · WhatsApp automation · complex email automation (only Supabase auth emails exist) · multiple AI agents · large admin systems · automatic messages/emails · automatic stage changes · multi-currency conversion.
