"use client";

/**
 * Kanban board: 9 droppable stage columns (SPEC order) with draggable cards.
 *
 * - Drop → optimistic override, then the Prompt 6 `useStageChange()` flow
 *   (dialog stages wait for Save / Skip / Cancel). "cancelled" / "failed" snap
 *   the card back (the hook toasts errors); "moved" / "unchanged" keep it until
 *   the server agrees (see reconcileOverrides in src/lib/pipeline.ts), so a
 *   Realtime refresh never overwrites an in-flight move.
 * - Sensors: mouse/pen pointer (6 px activation → plain clicks open the card),
 *   touch long-press, keyboard (Space picks up/drops, ←/→ jump one column,
 *   Escape cancels; Enter opens the card) with screen-reader announcements.
 * - Realtime: any visible prospect change → debounced router.refresh().
 */
import {
  DndContext,
  DragOverlay,
  KeyboardCode,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  pointerWithin,
  rectIntersection,
  useDndMonitor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
  type KeyboardCoordinateGetter,
} from "@dnd-kit/core";
import { cn } from "cn";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type PointerEvent } from "react";

import { useOrgSettings } from "@/components/org-settings-provider";
import { useProspectsRealtime } from "@/components/realtime/use-prospects-realtime";
import { useStageChange } from "@/components/stage-change/useStageChange";
import { PIPELINE_STAGES, STAGE_LABELS, type PipelineStage } from "@/lib/constants";
import { formatMoney } from "@/lib/money";
import {
  applyOverrides,
  groupByStage,
  reconcileOverrides,
  summarizeColumn,
  type PipelineCard,
  type StageOverrides,
} from "@/lib/pipeline";
import type { TeamMember } from "@/server/data/prospect-detail";

import { PipelineCardBody } from "./pipeline-card";

type CardData = { card: PipelineCard };

const isStage = (value: unknown): value is PipelineStage =>
  typeof value === "string" && (PIPELINE_STAGES as readonly string[]).includes(value);

const cardOf = (data: { current?: unknown } | null | undefined): PipelineCard | null =>
  (data?.current as CardData | undefined)?.card ?? null;

/** Mouse / pen only; touch uses the long-press TouchSensor so the board can still be scrolled. */
class MousePointerSensor extends PointerSensor {
  static activators = [
    {
      eventName: "onPointerDown" as const,
      handler: ({ nativeEvent: event }: PointerEvent) =>
        event.isPrimary && event.button === 0 && event.pointerType !== "touch",
    },
  ];
}

/** Keyboard: ←/→ jump to the previous/next column (by droppable position) instead of 25 px steps. */
const columnKeyboardCoordinates: KeyboardCoordinateGetter = (event, { context }) => {
  if (event.code !== KeyboardCode.Right && event.code !== KeyboardCode.Left) {
    if (event.code === KeyboardCode.Up || event.code === KeyboardCode.Down) event.preventDefault();
    return undefined;
  }
  event.preventDefault();
  const { collisionRect, droppableRects, droppableContainers } = context;
  if (!collisionRect) return undefined;
  const center = collisionRect.left + collisionRect.width / 2;
  const rects = droppableContainers
    .getEnabled()
    .map((container) => droppableRects.get(container.id))
    .filter((rect) => rect !== undefined)
    .sort((a, b) => a.left - b.left);
  const target =
    event.code === KeyboardCode.Right
      ? rects.find((rect) => rect.left > center)
      : rects.findLast((rect) => rect.left + rect.width < center);
  if (!target) return undefined;
  return { x: target.left + (target.width - collisionRect.width) / 2, y: collisionRect.top };
};

/** Pointer position first; keyboard drags (no pointer) and gaps fall back to rectangle overlap. */
const collisionDetection: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length > 0 ? hits : rectIntersection(args);
};

/** Column header dots: neutral greys through the open stages, green for won, red for lost. */
const STAGE_DOTS: Record<PipelineStage, string> = {
  prospect: "bg-slate-300",
  contacted: "bg-slate-400",
  conversation: "bg-slate-500",
  qualified: "bg-sky-400",
  demo_booked: "bg-sky-500",
  demo_attended: "bg-sky-600",
  follow_up: "bg-amber-400",
  closed_won: "bg-emerald-500",
  closed_lost: "bg-red-400",
};

const stageName = (id: unknown) => (isStage(id) ? STAGE_LABELS[id] : "a stage");

const announcements: Announcements = {
  onDragStart: ({ active }) => {
    const card = cardOf(active.data);
    return card ? `Picked up ${card.name} in ${STAGE_LABELS[card.stage]}.` : "Picked up a card.";
  },
  onDragOver: ({ active, over }) => {
    const name = cardOf(active.data)?.name ?? "The card";
    return over ? `${name} is over ${stageName(over.id)}.` : `${name} is not over a stage.`;
  },
  onDragEnd: ({ active, over }) => {
    const name = cardOf(active.data)?.name ?? "The card";
    return over ? `${name} dropped in ${stageName(over.id)}.` : `${name} was dropped outside the stages.`;
  },
  onDragCancel: ({ active }) => `Moving ${cardOf(active.data)?.name ?? "the card"} was cancelled.`,
};

const screenReaderInstructions = {
  draggable:
    "To move this prospect to another stage, press Space to pick it up, use the left and right arrow keys to choose a stage, then press Space to drop it, or Escape to cancel. Press Enter to open the prospect.",
};

export function PipelineBoard({
  cards,
  owners,
  userId,
  now,
}: {
  cards: PipelineCard[];
  /** Team (managers only → owner initials); null for reps. */
  owners: TeamMember[] | null;
  userId: string;
  /** Server render time (ISO), so follow-up buckets match the server. */
  now: string;
}) {
  const router = useRouter();
  const { timezone, staleDays } = useOrgSettings();
  const { requestStageChange, dialog } = useStageChange();
  const [, startTransition] = useTransition();

  const [overrides, setOverrides] = useState<StageOverrides>({});
  const [activeCard, setActiveCard] = useState<PipelineCard | null>(null);

  // New server snapshot → drop overrides it made obsolete (render-time adjustment).
  const [seenCards, setSeenCards] = useState(cards);
  if (seenCards !== cards) {
    setSeenCards(cards);
    const next = reconcileOverrides(cards, overrides);
    if (next !== overrides) setOverrides(next);
  }

  // Latest server cards for async handlers (settling after an awaited move).
  const cardsRef = useRef(cards);
  useEffect(() => {
    cardsRef.current = cards;
  }, [cards]);

  const refresh = useCallback(() => startTransition(() => router.refresh()), [router]);
  useProspectsRealtime({ userId, onChange: refresh });

  const sensors = useSensors(
    useSensor(MousePointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: columnKeyboardCoordinates,
      keyboardCodes: {
        start: [KeyboardCode.Space],
        cancel: [KeyboardCode.Esc],
        end: [KeyboardCode.Space, KeyboardCode.Enter],
      },
      scrollBehavior: "auto",
    }),
  );

  const displayCards = useMemo(() => applyOverrides(cards, overrides), [cards, overrides]);
  const columns = useMemo(() => groupByStage(displayCards), [displayCards]);
  const ownerNames = useMemo(
    () => (owners ? new Map(owners.map((owner) => [owner.id, owner.full_name])) : null),
    [owners],
  );
  const nowDate = useMemo(() => new Date(now), [now]);

  const ownerNameOf = (card: PipelineCard) => (ownerNames ? (ownerNames.get(card.owner_id) ?? "Unknown") : null);

  const onDragStart = ({ active }: DragStartEvent) => setActiveCard(cardOf(active.data));
  const onDragCancel = () => setActiveCard(null);

  const onDragEnd = async ({ active, over }: DragEndEvent) => {
    setActiveCard(null);
    const card = displayCards.find((c) => c.id === active.id);
    if (!card || !over || !isStage(over.id) || over.id === card.stage) return;
    const from = card.stage;
    const to = over.id;

    const override = { from, to, settled: false };
    setOverrides((prev) => ({ ...prev, [card.id]: override }));
    const result = await requestStageChange({ id: card.id, name: card.name, stage: from, demo_at: card.demo_at }, to);

    setOverrides((prev) => {
      if (prev[card.id] !== override) return prev; // replaced meanwhile
      const { [card.id]: _drop, ...rest } = prev;
      void _drop;
      if (result === "cancelled" || result === "failed") return rest; // snap back
      return reconcileOverrides(cardsRef.current, { ...rest, [card.id]: { ...override, settled: true } });
    });
    if (result === "unchanged") refresh();
  };

  return (
    <>
      <DndContext
        id="pipeline-board"
        sensors={sensors}
        collisionDetection={collisionDetection}
        accessibility={{ announcements, screenReaderInstructions }}
        onDragStart={onDragStart}
        onDragCancel={onDragCancel}
        onDragEnd={onDragEnd}
      >
        <div
          className="relative -mx-4 flex items-stretch gap-3 overflow-x-auto px-4 pb-4 md:mx-0 md:px-0"
          aria-label="Pipeline board"
          role="group"
        >
          {PIPELINE_STAGES.map((stage) => (
            <StageColumn key={stage} stage={stage} cards={columns[stage]}>
              {columns[stage].map((card) => (
                <DraggableCard key={card.id} card={card} pending={overrides[card.id]?.settled === false}>
                  <PipelineCardBody
                    card={card}
                    ownerName={ownerNameOf(card)}
                    timezone={timezone}
                    staleDays={staleDays}
                    now={nowDate}
                  />
                </DraggableCard>
              ))}
            </StageColumn>
          ))}
        </div>
        <DragOverlay dropAnimation={null}>
          {activeCard && (
            <div className="glass-strong w-68 rotate-[1.5deg] cursor-grabbing rounded-2xl p-3.5 ring-1 ring-[oklch(0.3_0.01_255/0.15)]">
              <PipelineCardBody
                card={activeCard}
                ownerName={ownerNameOf(activeCard)}
                timezone={timezone}
                staleDays={staleDays}
                now={nowDate}
              />
            </div>
          )}
        </DragOverlay>
      </DndContext>
      {dialog}
    </>
  );
}

function StageColumn({
  stage,
  cards,
  children,
}: {
  stage: PipelineStage;
  cards: PipelineCard[];
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  const summary = summarizeColumn(cards);
  const headingId = `pipeline-column-${stage}`;

  return (
    <section
      ref={setNodeRef}
      aria-labelledby={headingId}
      data-stage={stage}
      className={cn(
        "glass flex w-72 shrink-0 flex-col rounded-3xl transition-all duration-200",
        isOver && "ring-2 ring-[oklch(0.3_0.01_255/0.25)] [--glass-bg:oklch(1_0_0/0.78)] dark:ring-white/25 dark:[--glass-bg:oklch(0.32_0.006_255/0.6)]",
      )}
    >
      <header className="space-y-1 px-4 pt-4 pb-3">
        <div className="flex items-center justify-between gap-2">
          <h2 id={headingId} className="flex items-center gap-2 text-sm font-semibold tracking-tight">
            <span aria-hidden className={cn("size-2 rounded-full", STAGE_DOTS[stage])} />
            {STAGE_LABELS[stage]}
          </h2>
          <span
            className="rounded-full bg-white/70 px-2 text-xs leading-5 font-medium tabular-nums shadow-[inset_0_1px_0_0_oklch(1_0_0)] dark:bg-white/10 dark:shadow-none"
            aria-label={`${summary.count} prospect${summary.count === 1 ? "" : "s"}`}
            data-testid="column-count"
          >
            {summary.count}
          </span>
        </div>
        <p className="min-h-4 truncate pl-4 text-xs text-muted-foreground tabular-nums" data-testid="column-total">
          {summary.totals.map((t) => formatMoney(t.total, t.currency, { compact: true })).join(" · ")}
        </p>
      </header>
      <ul className="flex min-h-24 flex-1 flex-col gap-2.5 px-2.5 pb-2.5" aria-label={`${STAGE_LABELS[stage]} prospects`}>
        {cards.length === 0 ? (
          <li className="flex flex-1 items-center justify-center rounded-2xl border border-dashed border-[oklch(0.3_0.01_255/0.15)] p-4 text-xs text-muted-foreground dark:border-white/10">
            No prospects
          </li>
        ) : (
          children
        )}
      </ul>
    </section>
  );
}

function DraggableCard({
  card,
  pending,
  children,
}: {
  card: PipelineCard;
  /** Stage change in flight: not draggable until it settles. */
  pending: boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: card.id,
    data: { card } satisfies CardData,
    disabled: pending,
  });
  const href = `/prospects/${card.id}`;

  // A click that ends a drag must not open the card.
  const lastDragEnd = useRef(0);
  useDndMonitor({
    onDragEnd: ({ active }) => {
      if (active.id === card.id) lastDragEnd.current = Date.now();
    },
  });

  const open = (newTab: boolean) => {
    if (newTab) window.open(href, "_blank", "noopener");
    else router.push(href);
  };

  return (
    <li>
      <div
        ref={setNodeRef}
        {...attributes}
        {...listeners}
        aria-label={`${card.name}${card.company ? `, ${card.company}` : ""}, ${STAGE_LABELS[card.stage]}`}
        aria-busy={pending || undefined}
        data-prospect-id={card.id}
        onClick={(event) => {
          if (Date.now() - lastDragEnd.current < 300) return;
          open(event.metaKey || event.ctrlKey);
        }}
        onKeyDown={(event) => {
          listeners?.onKeyDown?.(event);
          if (event.key === "Enter" && !event.defaultPrevented && !isDragging) {
            event.preventDefault();
            open(event.metaKey || event.ctrlKey);
          }
        }}
        className={cn(
          "glass-tile cursor-pointer touch-manipulation rounded-2xl p-3.5 outline-none select-none transition-all duration-200 hover:-translate-y-px hover:bg-white/95 hover:shadow-[inset_0_1px_0_0_oklch(1_0_0),0_8px_20px_-10px_oklch(0.35_0.1_274/0.35)] focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-white/10",
          isDragging && "opacity-40",
          pending && "cursor-progress opacity-70",
        )}
      >
        {children}
      </div>
    </li>
  );
}
