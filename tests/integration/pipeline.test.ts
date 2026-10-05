/**
 * Kanban (Prompt 9) against local Supabase: the board query (RLS, filters,
 * latest AI deal health) and **Realtime RLS** — postgres_changes reach only
 * subscribers who can see the row, and a reassignment notifies the previous
 * owner on their private `user:<id>` broadcast topic. As Riley (rep A), Sam
 * (rep B) and Morgan (manager M). Run: `npm run test:integration`.
 */
import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Database } from "@/lib/supabase/database.types";
import type { ActionResult } from "@/server/actions/types";
import type { DataContext } from "@/server/data/context";
import { listPipelineData } from "@/server/data/pipeline";
import { createProspectData, moveProspectStageData, reassignProspectData } from "@/server/data/prospects";

try {
  process.loadEnvFile(".env.local");
} catch {
  // CI provides env vars directly.
}

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const PASSWORD = "Password123!";
const USERS = {
  M: { id: "11111111-1111-4111-8111-000000000001", email: "morgan.manager@example.com", role: "manager" },
  A: { id: "11111111-1111-4111-8111-000000000002", email: "riley.rep@example.com", role: "sales_rep" },
  B: { id: "11111111-1111-4111-8111-000000000003", email: "sam.rep@example.com", role: "sales_rep" },
} as const;
const PREFIX = `itest-pipe-${Date.now()}`;

async function signIn(key: keyof typeof USERS): Promise<DataContext> {
  const supabase = createClient<Database>(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await supabase.auth.signInWithPassword({ email: USERS[key].email, password: PASSWORD });
  if (error) throw new Error(`sign in ${key}: ${error.message}`);
  return { supabase: supabase as SupabaseClient<Database>, user: { id: USERS[key].id, role: USERS[key].role } };
}

function expectOk<T>(result: ActionResult<T>): T {
  if (!result.ok) throw new Error(`expected ok, got error: ${result.error}`);
  return result.data;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(check: () => boolean, timeoutMs = 8000, poke?: () => Promise<void>): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (check()) return true;
    if (poke) {
      await poke();
      await sleep(900);
    }
    await sleep(100);
  }
  return check();
}

/** Subscribes and resolves with the final join status (SUBSCRIBED / CHANNEL_ERROR / TIMED_OUT). */
function join(channel: RealtimeChannel): Promise<string> {
  return new Promise((resolve) => {
    channel.subscribe((status) => {
      if (status !== "CLOSED") resolve(status);
    });
  });
}

type Change = { eventType: string; id: string | undefined };

let A: DataContext;
let B: DataContext;
let M: DataContext;
const created: string[] = [];

beforeAll(async () => {
  [A, B, M] = await Promise.all([signIn("A"), signIn("B"), signIn("M")]);
  for (const ctx of [A, B, M]) await ctx.supabase.realtime.setAuth();
});

afterAll(async () => {
  for (const ctx of [A, B, M]) await ctx.supabase.removeAllChannels();
  if (created.length) await M.supabase.from("prospects").delete().in("id", created);
});

describe("listPipelineData", () => {
  let prospectId: string;

  beforeAll(async () => {
    prospectId = expectOk(
      await createProspectData(A, { name: `${PREFIX} Board`, company: "Pipe Co", dealValue: 1200 }),
    ).id;
    created.push(prospectId);
  });

  it("reps get only their own cards; managers get everyone's", async () => {
    const a = expectOk(await listPipelineData(A, { q: "", owner: null }));
    expect(a.cards.every((card) => card.owner_id === USERS.A.id)).toBe(true);
    expect(a.cards.some((card) => card.id === prospectId)).toBe(true);

    const b = expectOk(await listPipelineData(B, { q: "", owner: null }));
    expect(b.cards.every((card) => card.owner_id === USERS.B.id)).toBe(true);
    expect(b.cards.some((card) => card.id === prospectId)).toBe(false);

    const m = expectOk(await listPipelineData(M, { q: "", owner: null }));
    expect(new Set(m.cards.map((card) => card.owner_id))).toEqual(new Set([USERS.A.id, USERS.B.id]));
    expect(m.truncated).toBe(false);
  });

  it("search + owner filter (owner ignored for reps)", async () => {
    const search = expectOk(await listPipelineData(M, { q: PREFIX, owner: null }));
    expect(search.cards.map((card) => card.id)).toEqual([prospectId]);
    expect(search.cards[0]).toMatchObject({ name: `${PREFIX} Board`, company: "Pipe Co", deal_value: 1200, stage: "prospect" });

    const managerB = expectOk(await listPipelineData(M, { q: "", owner: USERS.B.id }));
    expect(managerB.cards.length).toBeGreaterThan(0);
    expect(managerB.cards.every((card) => card.owner_id === USERS.B.id)).toBe(true);

    // A rep passing someone else's owner id still gets only their own rows.
    const repSpoof = expectOk(await listPipelineData(A, { q: "", owner: USERS.B.id }));
    expect(repSpoof.cards.every((card) => card.owner_id === USERS.A.id)).toBe(true);
    expect(repSpoof.cards.length).toBeGreaterThan(0);
  });

  it("ai_health is the latest insight's deal_health (null without insights)", async () => {
    const before = expectOk(await listPipelineData(A, { q: PREFIX, owner: null }));
    expect(before.cards[0].ai_health).toBeNull();

    const insight = {
      prospect_id: prospectId,
      summary: "s",
      decision_maker_status: "unknown" as const,
      main_objection: "o",
      recommended_next_step: "n",
      model: "test",
    };
    expect((await A.supabase.from("ai_insights").insert({ ...insight, deal_health: "low" })).error).toBeNull();
    await sleep(20);
    expect((await A.supabase.from("ai_insights").insert({ ...insight, deal_health: "high" })).error).toBeNull();

    const after = expectOk(await listPipelineData(A, { q: PREFIX, owner: null }));
    expect(after.cards[0].ai_health).toBe("high");
    expect(expectOk(await listPipelineData(M, { q: PREFIX, owner: null })).cards[0].ai_health).toBe("high");
  });
});

describe("Realtime respects RLS", () => {
  it("postgres_changes: owner and manager receive a rep's changes, the other rep does not", async () => {
    const events: Record<"A" | "B" | "M", Change[]> = { A: [], B: [], M: [] };
    const statuses = await Promise.all(
      (["A", "B", "M"] as const).map((key) => {
        const ctx = { A, B, M }[key];
        const channel = ctx.supabase
          .channel(`itest-pipe-changes-${key}-${Date.now()}`)
          .on("postgres_changes", { event: "*", schema: "public", table: "prospects" }, (payload) => {
            const row = (payload.eventType === "DELETE" ? payload.old : payload.new) as { id?: string };
            events[key].push({ eventType: payload.eventType, id: row.id });
          });
        return join(channel);
      }),
    );
    expect(statuses).toEqual(["SUBSCRIBED", "SUBSCRIBED", "SUBSCRIBED"]);

    // Warm-up: the first postgres_changes subscription after a reset starts the
    // replication stream asynchronously (SUBSCRIBED comes earlier). Touch a probe
    // row until the owner sees an UPDATE, so the real events below aren't missed.
    const probe = expectOk(await createProspectData(A, { name: `${PREFIX} Probe` })).id;
    created.push(probe);
    const warm = await waitFor(() => events.A.some((event) => event.id === probe && event.eventType === "UPDATE"), 20_000, async () => {
      await A.supabase.from("prospects").update({ notes: `warm-up ${Date.now()}` }).eq("id", probe);
    });
    expect(warm).toBe(true);

    const id = expectOk(await createProspectData(A, { name: `${PREFIX} Live` })).id;
    created.push(id);
    expectOk(await moveProspectStageData(A, { prospectId: id, toStage: "qualified" }));

    const seen = (key: "A" | "B" | "M", type: string) => () =>
      events[key].some((event) => event.id === id && event.eventType === type);
    expect(await waitFor(seen("A", "INSERT"))).toBe(true);
    expect(await waitFor(seen("A", "UPDATE"))).toBe(true);
    expect(await waitFor(seen("M", "INSERT"))).toBe(true);
    expect(await waitFor(seen("M", "UPDATE"))).toBe(true);
    await sleep(1000);
    expect(events.B.filter((event) => event.id === id)).toEqual([]);
  }, 60_000);

  it("reassignment: the previous owner gets a private broadcast, the new owner the UPDATE; others can't join that topic", async () => {
    const id = expectOk(await createProspectData(A, { name: `${PREFIX} Reassign` })).id;
    created.push(id);

    const broadcasts: unknown[] = [];
    const aTopic = A.supabase
      .channel(`user:${USERS.A.id}`, { config: { private: true } })
      .on("broadcast", { event: "prospect_owner_changed" }, ({ payload }) => broadcasts.push(payload));
    expect(await join(aTopic)).toBe("SUBSCRIBED");

    // Rep B may not join rep A's private topic.
    const spy = B.supabase.channel(`user:${USERS.A.id}`, { config: { private: true } });
    expect(await join(spy)).toBe("CHANNEL_ERROR");

    const bUpdates: string[] = [];
    const bChanges = B.supabase
      .channel(`itest-pipe-b-${Date.now()}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "prospects" }, (payload) => {
        bUpdates.push((payload.new as { id: string }).id);
      });
    expect(await join(bChanges)).toBe("SUBSCRIBED");
    await sleep(1000);

    expectOk(await reassignProspectData(M, { prospectId: id, ownerId: USERS.B.id }));

    expect(await waitFor(() => broadcasts.some((p) => (p as { prospect_id?: string }).prospect_id === id))).toBe(true);
    expect(await waitFor(() => bUpdates.includes(id))).toBe(true);
  }, 30_000);
});
