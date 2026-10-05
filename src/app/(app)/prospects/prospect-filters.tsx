"use client";

import { CheckIcon, Loader2Icon, SearchIcon, XIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import type { OwnerOption } from "@/components/prospects/new-prospect-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DECISION_MAKER_STATUS_OPTIONS,
  OBJECTION_OPTIONS,
  STAGE_OPTIONS,
} from "@/lib/constants";
import {
  clearFiltersHref,
  hasActiveFilters,
  parseProspectListParams,
  prospectListHref,
  SEARCH_MAX_LENGTH,
  type ProspectListParams,
} from "@/lib/validation/prospect-list";

const ALL = "all";
const SEARCH_DEBOUNCE_MS = 300;

const normalize = (value: string) => value.replace(/\s+/g, " ").trim().slice(0, SEARCH_MAX_LENGTH).trim();

/** Latest list state from the address bar (props may lag behind a pending navigation). */
function currentParams(): ProspectListParams {
  return parseProspectListParams(new URLSearchParams(window.location.search));
}

/**
 * Search (debounced, replaces history) + filters (push history). All state is
 * in the URL; every change resets to page 1.
 */
export function ProspectFilters({
  params,
  owners,
}: {
  params: ProspectListParams;
  /** Managers only (owner filter); null for reps. */
  owners: OwnerOption[] | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Search box state, synced from the URL when it changes externally (back
  // button, Clear filters) but not when the change is our own debounced push.
  const [value, setValue] = useState(params.q);
  const [seenQ, setSeenQ] = useState(params.q);
  const [ownQ, setOwnQ] = useState<string | null>(null);
  if (params.q !== seenQ) {
    setSeenQ(params.q);
    if (params.q !== ownQ) setValue(params.q);
  }

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const navigate = (overrides: Partial<ProspectListParams>, mode: "push" | "replace" = "push") => {
    const href = prospectListHref(currentParams(), overrides);
    startTransition(() => {
      if (mode === "replace") router.replace(href, { scroll: false });
      else router.push(href, { scroll: false });
    });
  };

  const onSearchChange = (next: string) => {
    setValue(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const q = normalize(next);
      if (q === currentParams().q) return;
      setOwnQ(q);
      navigate({ q }, "replace");
    }, SEARCH_DEBOUNCE_MS);
  };

  const clearSearch = () => {
    if (timer.current) clearTimeout(timer.current);
    setValue("");
    if (currentParams().q) navigate({ q: "" }, "replace");
  };

  const clearAll = () => {
    if (timer.current) clearTimeout(timer.current);
    setValue("");
    startTransition(() => router.push(clearFiltersHref(currentParams()), { scroll: false }));
  };

  return (
    <div className="mb-4 space-y-3" role="search" aria-label="Filter prospects">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <SearchIcon
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            aria-label="Search prospects"
            placeholder="Search name, company or email"
            className="pr-8 pl-8 [&::-webkit-search-cancel-button]:hidden"
            value={value}
            maxLength={SEARCH_MAX_LENGTH}
            onChange={(event) => onSearchChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && value) {
                event.preventDefault();
                clearSearch();
              }
            }}
          />
          {value && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={clearSearch}
              className="absolute top-1/2 right-2 -translate-y-1/2 rounded-sm text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <XIcon className="size-4" aria-hidden />
            </button>
          )}
        </div>

        <FilterSelect
          label="Stage"
          allLabel="All stages"
          value={params.stage}
          options={STAGE_OPTIONS}
          onChange={(stage) => navigate({ stage: stage as ProspectListParams["stage"] })}
        />
        {owners && (
          <FilterSelect
            label="Owner"
            allLabel="All owners"
            value={params.owner}
            options={owners.map((owner) => ({ value: owner.id, label: owner.full_name }))}
            onChange={(owner) => navigate({ owner })}
          />
        )}
        <FilterSelect
          label="Decision maker"
          allLabel="Any decision maker"
          value={params.dm}
          options={DECISION_MAKER_STATUS_OPTIONS.map((o) => ({ value: o.value, label: `Decision maker: ${o.label}` }))}
          onChange={(dm) => navigate({ dm: dm as ProspectListParams["dm"] })}
        />
        <FilterSelect
          label="Objection"
          allLabel="Any objection"
          value={params.objection}
          options={OBJECTION_OPTIONS}
          onChange={(objection) => navigate({ objection: objection as ProspectListParams["objection"] })}
        />
        <ToggleFilter
          label="Overdue follow-up"
          pressed={params.overdue}
          onToggle={() => navigate({ overdue: !params.overdue })}
        />
        <ToggleFilter label="Stale" pressed={params.stale} onToggle={() => navigate({ stale: !params.stale })} />
        {hasActiveFilters(params) && (
          <Button type="button" variant="ghost" size="sm" onClick={clearAll}>
            <XIcon aria-hidden />
            Clear filters
          </Button>
        )}
        {pending && (
          <Loader2Icon aria-label="Loading" role="status" className="size-4 animate-spin text-muted-foreground" />
        )}
      </div>
    </div>
  );
}

function FilterSelect({
  label,
  allLabel,
  value,
  options,
  onChange,
}: {
  label: string;
  allLabel: string;
  value: string | null;
  options: readonly { value: string; label: string }[];
  onChange: (value: string | null) => void;
}) {
  // Explicit SelectValue children: rendered on the server too (no empty trigger before hydration).
  const selectedLabel = options.find((option) => option.value === value)?.label ?? allLabel;
  return (
    <Select value={value ?? ALL} onValueChange={(next) => onChange(next === ALL ? null : next)}>
      <SelectTrigger aria-label={label} className="w-full sm:w-auto" data-active={value ? "" : undefined}>
        <SelectValue>{selectedLabel}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{allLabel}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ToggleFilter({ label, pressed, onToggle }: { label: string; pressed: boolean; onToggle: () => void }) {
  return (
    <Button
      type="button"
      variant={pressed ? "secondary" : "outline"}
      aria-pressed={pressed}
      onClick={onToggle}
    >
      {pressed && <CheckIcon aria-hidden />}
      {label}
    </Button>
  );
}
