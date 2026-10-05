"use client";

import { Loader2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MAX_REPORT_DAYS, REPORT_PRESET_LABELS, REPORT_PRESETS, type ReportPreset, type ReportRange } from "@/lib/reports";
import { isValidCustomRange, reportsHref, type ReportsParams } from "@/lib/validation/reports";

const ALL = "all";

/**
 * Period preset (this month / last 30 / last 90 / this quarter / custom) and,
 * for managers, the owner. The URL is the state; presets are resolved in the
 * org timezone on the server. "Custom range" shows two date inputs + Apply.
 */
export function ReportFilters({
  params,
  range,
  owners,
}: {
  params: ReportsParams;
  /** The period currently shown (prefills the custom inputs). */
  range: ReportRange;
  /** Managers only; omitted for reps (no owner filter). */
  owners?: { id: string; full_name: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [preset, setPreset] = useState<ReportPreset>(params.range);
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to);
  const [error, setError] = useState<string | null>(null);

  const navigate = (next: Partial<ReportsParams>) => {
    startTransition(() => {
      router.push(reportsHref(params, next), { scroll: false });
    });
  };

  const onPresetChange = (value: string) => {
    const next = value as ReportPreset;
    setPreset(next);
    setError(null);
    if (next !== "custom") navigate({ range: next, from: null, to: null });
  };

  const onApply = (event: React.FormEvent) => {
    event.preventDefault();
    if (!isValidCustomRange(from, to)) {
      setError(
        from && to && from > to
          ? "The start date must be on or before the end date."
          : `Pick a start and end date (at most ${MAX_REPORT_DAYS} days).`,
      );
      return;
    }
    setError(null);
    navigate({ range: "custom", from, to });
  };

  const ownerLabel = owners?.find((member) => member.id === params.owner)?.full_name ?? "All owners";

  return (
    <div className="mb-6 flex flex-wrap items-end gap-3" role="group" aria-label="Report filters">
      <div className="grid gap-1.5">
        <Label htmlFor="report-range" className="text-xs text-muted-foreground">
          Period
        </Label>
        <Select value={preset} onValueChange={onPresetChange}>
          <SelectTrigger id="report-range" aria-label="Period" className="w-40">
            <SelectValue>{REPORT_PRESET_LABELS[preset]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {REPORT_PRESETS.map((value) => (
              <SelectItem key={value} value={value}>
                {REPORT_PRESET_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {preset === "custom" && (
        <form onSubmit={onApply} className="flex flex-wrap items-end gap-3" aria-label="Custom range" noValidate>
          <div className="grid gap-1.5">
            <Label htmlFor="report-from" className="text-xs text-muted-foreground">
              From
            </Label>
            <Input
              id="report-from"
              type="date"
              value={from}
              max={to || undefined}
              onChange={(event) => setFrom(event.target.value)}
              className="w-40"
              aria-invalid={error ? true : undefined}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="report-to" className="text-xs text-muted-foreground">
              To
            </Label>
            <Input
              id="report-to"
              type="date"
              value={to}
              min={from || undefined}
              onChange={(event) => setTo(event.target.value)}
              className="w-40"
              aria-invalid={error ? true : undefined}
            />
          </div>
          <Button type="submit" variant="secondary" disabled={pending}>
            Apply
          </Button>
          {error && (
            <p role="alert" className="basis-full text-sm text-destructive">
              {error}
            </p>
          )}
        </form>
      )}

      {owners && (
        <div className="grid gap-1.5">
          <Label htmlFor="report-owner" className="text-xs text-muted-foreground">
            Owner
          </Label>
          <Select
            value={params.owner ?? ALL}
            onValueChange={(value) => navigate({ owner: value === ALL ? null : value })}
          >
            <SelectTrigger id="report-owner" aria-label="Owner" className="w-44">
              <SelectValue>{ownerLabel}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All owners</SelectItem>
              {owners.map((member) => (
                <SelectItem key={member.id} value={member.id}>
                  {member.full_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {pending && (
        <Loader2Icon aria-label="Loading" role="status" className="mb-2.5 size-4 animate-spin text-muted-foreground" />
      )}
    </div>
  );
}
