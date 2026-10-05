/**
 * Pure Kanban helpers (Prompt 9): column grouping + totals, owner initials and
 * the optimistic-move overrides that keep a dragged card in its new column
 * while the move is in flight (and until the server agrees).
 */
import {
  PIPELINE_STAGES,
  type DealHealth,
  type DecisionMakerStatus,
  type PipelineStage,
} from "@/lib/constants";
import type { DateString } from "@/lib/time";

/** One Kanban card (prospects_with_flags + the latest AI deal health). */
export type PipelineCard = {
  id: string;
  name: string;
  company: string | null;
  stage: PipelineStage;
  owner_id: string;
  decision_maker_status: DecisionMakerStatus;
  follow_up_date: DateString | null;
  deal_value: number | null;
  currency: string;
  demo_at: string | null;
  is_stale: boolean;
  has_overdue_follow_up: boolean;
  last_activity_at: string;
  ai_health: DealHealth | null;
};

export type CurrencyTotal = { currency: string; total: number };

export type ColumnSummary = {
  count: number;
  /** Sum of deal values per currency (never summed across currencies), sorted by code. */
  totals: CurrencyTotal[];
};

/** Count + per-currency total of the cards that have a deal value (others are ignored). */
export function summarizeColumn(cards: readonly Pick<PipelineCard, "deal_value" | "currency">[]): ColumnSummary {
  const cents = new Map<string, number>();
  for (const card of cards) {
    if (card.deal_value === null || !Number.isFinite(card.deal_value)) continue;
    const currency = card.currency.trim().toUpperCase();
    cents.set(currency, (cents.get(currency) ?? 0) + Math.round(card.deal_value * 100));
  }
  const totals = [...cents.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, sum]) => ({ currency, total: sum / 100 }));
  return { count: cards.length, totals };
}

/** Cards per stage, every stage present (SPEC order), input order kept within a column. */
export function groupByStage<T extends { stage: PipelineStage }>(cards: readonly T[]): Record<PipelineStage, T[]> {
  const columns = Object.fromEntries(PIPELINE_STAGES.map((stage) => [stage, [] as T[]])) as Record<
    PipelineStage,
    T[]
  >;
  for (const card of cards) columns[card.stage].push(card);
  return columns;
}

/** "Riley Rep" → "RR", "madonna" → "MA", "" → "?". */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

// ---------------------------------------------------------------------------
// Optimistic moves
// ---------------------------------------------------------------------------

/**
 * A card dragged from `from` to `to`. Unsettled = the stage change is still in
 * flight (dialog open or request pending): it always wins over server data.
 * Settled = the move succeeded: it wins until the server shows the card
 * somewhere other than `from` (normally `to`).
 */
export type StageOverride = { from: PipelineStage; to: PipelineStage; settled: boolean };
export type StageOverrides = Readonly<Record<string, StageOverride>>;

/** Server cards with the optimistic stages applied. */
export function applyOverrides<T extends { id: string; stage: PipelineStage }>(
  cards: readonly T[],
  overrides: StageOverrides,
): T[] {
  return cards.map((card) => {
    const override = overrides[card.id];
    return override && override.to !== card.stage ? { ...card, stage: override.to } : card;
  });
}

/**
 * Drops overrides that a new server snapshot made obsolete: the card is gone
 * (deleted / filtered / reassigned away), or the move settled and the server no
 * longer shows the old stage. Returns the same object when nothing changed.
 */
export function reconcileOverrides(
  cards: readonly { id: string; stage: PipelineStage }[],
  overrides: StageOverrides,
): StageOverrides {
  const ids = Object.keys(overrides);
  if (ids.length === 0) return overrides;
  const stages = new Map(cards.map((card) => [card.id, card.stage]));
  let changed = false;
  const next: Record<string, StageOverride> = {};
  for (const id of ids) {
    const override = overrides[id];
    const serverStage = stages.get(id);
    const obsolete = serverStage === undefined || (override.settled && serverStage !== override.from);
    if (obsolete) changed = true;
    else next[id] = override;
  }
  return changed ? next : overrides;
}
