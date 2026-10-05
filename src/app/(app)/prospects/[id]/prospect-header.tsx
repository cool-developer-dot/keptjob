"use client";

/**
 * Detail page header: name, company, stage select (Prompt 6 useStageChange
 * flow), owner (managers: reassign select), deal value, stale / overdue badges,
 * close outcome, demo date/time (org tz) and the manager-only overflow menu
 * with "Delete prospect".
 */
import { ArrowLeftIcon, CalendarIcon, EllipsisVerticalIcon, Trash2Icon, TrophyIcon, CircleXIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { useOrgSettings } from "@/components/org-settings-provider";
import { OverdueBadge, StaleBadge } from "@/components/prospects/prospect-badges";
import { useStageChange } from "@/components/stage-change/useStageChange";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  PIPELINE_STAGES,
  ROLE_LABELS,
  STAGE_LABELS,
  closeReasonLabel,
  isClosedStage,
  type PipelineStage,
} from "@/lib/constants";
import { formatMoney } from "@/lib/money";
import { formatOrgDate, formatOrgDateTime, timeZoneAbbreviation } from "@/lib/time";
import { deleteProspect, reassignProspect } from "@/server/actions/prospects";
import type { ProspectDetail, TeamMember } from "@/server/data/prospect-detail";

type Optimistic<T> = { from: T; to: T } | null;

/**
 * Value shown by a server-backed select: the optimistic target while a change
 * is in flight (or until the server value arrives), otherwise the server value.
 * The optimistic state is dropped whenever the server value changes.
 */
function useOptimisticValue<T>(serverValue: T) {
  const [optimistic, setOptimistic] = useState<Optimistic<T>>(null);
  const [lastServerValue, setLastServerValue] = useState(serverValue);
  if (lastServerValue !== serverValue) {
    setLastServerValue(serverValue);
    setOptimistic(null);
  }
  const value = optimistic && optimistic.from === serverValue ? optimistic.to : serverValue;
  return { value, setOptimistic };
}

export function ProspectHeader({
  prospect,
  team,
  isManager,
}: {
  prospect: ProspectDetail;
  team: TeamMember[];
  isManager: boolean;
}) {
  const { timezone } = useOrgSettings();
  const owner = team.find((member) => member.id === prospect.owner_id);
  const closed = isClosedStage(prospect.stage);
  const reason = closeReasonLabel(prospect.stage, prospect.close_reason);

  return (
    <header className="space-y-4">
      <Link
        href="/prospects"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeftIcon aria-hidden className="size-4" />
        Prospects
      </Link>

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight break-words">{prospect.name}</h1>
          <p className="text-sm text-muted-foreground">{prospect.company ?? "No company"}</p>
          <div className="flex flex-wrap gap-1.5 pt-1">
            {prospect.is_stale && <StaleBadge />}
            {prospect.has_overdue_follow_up && <OverdueBadge />}
          </div>
        </div>
        {isManager && <ProspectActionsMenu prospect={prospect} />}
      </div>

      <div className="grid gap-4 rounded-lg border p-4 sm:grid-cols-2 lg:grid-cols-4">
        <StageControl prospect={prospect} />
        <div className="space-y-1.5">
          {isManager ? (
            <OwnerControl prospect={prospect} team={team} />
          ) : (
            <>
              <p className="text-sm font-medium">Owner</p>
              <p className="flex h-8 items-center text-sm">{owner?.full_name ?? "Unknown"}</p>
            </>
          )}
        </div>
        <div className="space-y-1.5">
          <p className="text-sm font-medium">Deal value</p>
          <p className="flex h-8 items-center text-sm">
            {prospect.deal_value == null ? (
              <span className="text-muted-foreground">No deal value</span>
            ) : (
              <span className="font-medium tabular-nums">{formatMoney(prospect.deal_value, prospect.currency)}</span>
            )}
          </p>
        </div>
        <div className="space-y-1.5">
          <p className="text-sm font-medium">Demo</p>
          <p className="flex min-h-8 items-center gap-1.5 text-sm">
            {prospect.demo_at ? (
              <>
                <CalendarIcon aria-hidden className="size-4 text-muted-foreground" />
                <span data-testid="demo-at">
                  {formatOrgDateTime(prospect.demo_at, timezone)} {timeZoneAbbreviation(timezone, prospect.demo_at)}
                </span>
              </>
            ) : (
              <span className="text-muted-foreground">Not scheduled</span>
            )}
          </p>
        </div>
      </div>

      {closed && (
        <div
          role="note"
          aria-label="Outcome"
          className={
            prospect.stage === "closed_won"
              ? "flex gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm dark:border-emerald-500/30 dark:bg-emerald-500/10"
              : "flex gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm dark:border-red-500/30 dark:bg-red-500/10"
          }
        >
          {prospect.stage === "closed_won" ? (
            <TrophyIcon aria-hidden className="size-5 shrink-0 text-emerald-700 dark:text-emerald-300" />
          ) : (
            <CircleXIcon aria-hidden className="size-5 shrink-0 text-red-700 dark:text-red-300" />
          )}
          <div className="min-w-0 space-y-1">
            <p className="font-medium">
              {STAGE_LABELS[prospect.stage]}
              {reason && <> · Reason: {reason}</>}
              {prospect.closed_at && (
                <span className="font-normal text-muted-foreground"> · {formatOrgDate(prospect.closed_at, timezone)}</span>
              )}
            </p>
            {prospect.close_notes && <p className="break-words whitespace-pre-wrap">{prospect.close_notes}</p>}
          </div>
        </div>
      )}
    </header>
  );
}

function StageControl({ prospect }: { prospect: ProspectDetail }) {
  const { requestStageChange, dialog, isBusy } = useStageChange();
  const { value, setOptimistic } = useOptimisticValue<PipelineStage>(prospect.stage);

  const onChange = async (next: string) => {
    const toStage = next as PipelineStage;
    if (toStage === prospect.stage) return;
    setOptimistic({ from: prospect.stage, to: toStage });
    const result = await requestStageChange(prospect, toStage);
    // "moved": keep showing the target until the server value arrives; otherwise revert.
    if (result !== "moved") setOptimistic(null);
  };

  return (
    <div className="space-y-1.5">
      <Label htmlFor="prospect-stage">Stage</Label>
      <Select value={value} onValueChange={onChange} disabled={isBusy}>
        <SelectTrigger id="prospect-stage" className="w-full" aria-busy={isBusy}>
          <SelectValue>{STAGE_LABELS[value]}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {PIPELINE_STAGES.map((stage) => (
            <SelectItem key={stage} value={stage}>
              {STAGE_LABELS[stage]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {dialog}
    </div>
  );
}

function OwnerControl({ prospect, team }: { prospect: ProspectDetail; team: TeamMember[] }) {
  const [pending, startTransition] = useTransition();
  const { value, setOptimistic } = useOptimisticValue<string>(prospect.owner_id);
  const current = team.find((member) => member.id === value);

  const onChange = (ownerId: string) => {
    if (ownerId === prospect.owner_id) return;
    const target = team.find((member) => member.id === ownerId);
    setOptimistic({ from: prospect.owner_id, to: ownerId });
    startTransition(async () => {
      const result = await reassignProspect({ prospectId: prospect.id, ownerId });
      if (!result.ok) {
        setOptimistic(null);
        toast.error(result.error);
        return;
      }
      toast.success(`Reassigned ${prospect.name} to ${target?.full_name ?? "the new owner"}.`);
    });
  };

  return (
    <>
      <Label htmlFor="prospect-owner">Owner</Label>
      <Select value={value} onValueChange={onChange} disabled={pending}>
        <SelectTrigger id="prospect-owner" className="w-full" aria-busy={pending}>
          <SelectValue>{current?.full_name ?? "Unknown"}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {team.map((member) => (
            <SelectItem key={member.id} value={member.id}>
              {member.full_name}
              <span className="text-xs text-muted-foreground">{ROLE_LABELS[member.role]}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );
}

function ProspectActionsMenu({ prospect }: { prospect: ProspectDetail }) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const onDelete = (event: React.MouseEvent) => {
    event.preventDefault(); // keep the dialog open while deleting
    startTransition(async () => {
      const result = await deleteProspect({ prospectId: prospect.id });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`${prospect.name} was deleted.`);
      router.replace("/prospects");
    });
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon" aria-label="More actions">
            <EllipsisVerticalIcon aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem variant="destructive" onSelect={() => setConfirmOpen(true)}>
            <Trash2Icon aria-hidden />
            Delete prospect
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirmOpen} onOpenChange={(next) => !pending && setConfirmOpen(next)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {prospect.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the prospect with its activities, follow-ups, stage history and AI insights.
              This can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={onDelete} disabled={pending}>
              {pending ? "Deleting…" : "Delete prospect"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
