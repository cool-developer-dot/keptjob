"use client";

import { Loader2Icon, SearchIcon, XIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  hasActivePipelineFilters,
  parsePipelineParams,
  pipelineHref,
  type PipelineParams,
} from "@/lib/validation/pipeline";
import { SEARCH_MAX_LENGTH } from "@/lib/validation/prospect-list";
import type { TeamMember } from "@/server/data/prospect-detail";

const ALL = "all";
const SEARCH_DEBOUNCE_MS = 300;

const normalize = (value: string) => value.replace(/\s+/g, " ").trim().slice(0, SEARCH_MAX_LENGTH).trim();

/** Latest board state from the address bar (props may lag behind a pending navigation). */
function currentParams(): PipelineParams {
  return parsePipelineParams(new URLSearchParams(window.location.search));
}

/** Search (debounced, replaces history) + owner filter (managers; pushes history). URL is the state. */
export function PipelineFilters({ params, owners }: { params: PipelineParams; owners: TeamMember[] | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Synced from the URL when it changes externally (back button, Clear filters),
  // but not when the change is our own debounced replace.
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

  const navigate = (overrides: Partial<PipelineParams>, mode: "push" | "replace" = "push") => {
    const href = pipelineHref(currentParams(), overrides);
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
    navigate({ q: "", owner: null });
  };

  const ownerLabel = owners?.find((owner) => owner.id === params.owner)?.full_name ?? "All owners";

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2" role="search" aria-label="Filter pipeline">
      <div className="relative w-full sm:w-72">
        <SearchIcon
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          type="search"
          aria-label="Search pipeline"
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

      {owners && (
        <Select
          value={params.owner ?? ALL}
          onValueChange={(next) => navigate({ owner: next === ALL ? null : next })}
        >
          <SelectTrigger aria-label="Owner" className="w-full sm:w-auto" data-active={params.owner ? "" : undefined}>
            {/* Explicit children: rendered on the server too. */}
            <SelectValue>{ownerLabel}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All owners</SelectItem>
            {owners.map((owner) => (
              <SelectItem key={owner.id} value={owner.id}>
                {owner.full_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {hasActivePipelineFilters(params) && (
        <Button type="button" variant="ghost" size="sm" onClick={clearAll}>
          <XIcon aria-hidden />
          Clear filters
        </Button>
      )}
      {pending && <Loader2Icon aria-label="Loading" role="status" className="size-4 animate-spin text-muted-foreground" />}
    </div>
  );
}
