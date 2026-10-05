"use client";

/**
 * The one stage-change flow (SPEC §9), shared by the detail page, list and
 * Kanban:
 *
 *   const { requestStageChange, dialog, isBusy } = useStageChange();
 *   const result = await requestStageChange(prospect, "demo_booked");
 *   // result: "moved" | "unchanged" | "cancelled" | "failed"
 *   return <>{…}{dialog}</>;
 *
 * decideStageFlow() picks the prompt: same stage → "unchanged" (no call);
 * other non-dialog targets → moveProspectStage right away; Demo Booked / Demo
 * Attended → Save / Skip / Cancel; Closed Won / Lost → reason required, Save /
 * Cancel. Save always moves the stage first, then saves the extras; if an extra
 * fails the move still counts ("moved" + error toast). If the move itself fails
 * the dialog stays open for a retry. Nothing is ever sent or moved automatically.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { useOrgSettings } from "@/components/org-settings-provider";
import { STAGE_LABELS, isClosedStage, type PipelineStage } from "@/lib/constants";
import {
  toCloseStageInput,
  toLogDemoAttendedInput,
  toSetDemoDetailsInput,
} from "@/lib/validation/stage-change";
import { decideStageFlow } from "@/lib/workflow";
import { logDemoAttended, setDemoDetails } from "@/server/actions/demo";
import { getPendingFollowUpCount } from "@/server/actions/followUps";
import { completeAllPendingFollowUps, moveProspectStage } from "@/server/actions/prospects";

import {
  StageChangeDialog,
  type StageChangeProspect,
  type StageChangeRequest,
  type StageChangeSubmission,
} from "./StageChangeDialog";

export type { StageChangeProspect };

export type StageChangeResult = "moved" | "unchanged" | "cancelled" | "failed";

export type RequestStageChangeOptions = {
  /** Pending follow-up count, if the caller knows it (else fetched for close targets). */
  pendingFollowUps?: number;
};

const GENERIC_ERROR = "Something went wrong. Please try again.";

async function loadPendingCount(prospectId: string): Promise<number> {
  try {
    const result = await getPendingFollowUpCount({ prospectId });
    return result.ok ? result.data.count : 0;
  } catch {
    return 0;
  }
}

export function useStageChange() {
  const { timezone } = useOrgSettings();
  const [request, setRequest] = useState<StageChangeRequest | null>(null);
  const [saving, setSaving] = useState(false);
  const [inFlight, setInFlight] = useState(0);
  const resolverRef = useRef<((result: StageChangeResult) => void) | null>(null);
  const keyRef = useRef(0);

  const settle = useCallback((result: StageChangeResult) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setRequest(null);
    resolve?.(result);
  }, []);

  // A pending prompt never leaves its caller hanging.
  useEffect(() => () => resolverRef.current?.("cancelled"), []);

  const requestStageChange = useCallback(
    async (
      prospect: StageChangeProspect,
      toStage: PipelineStage,
      options: RequestStageChangeOptions = {},
    ): Promise<StageChangeResult> => {
      if (prospect.stage === toStage) return "unchanged";

      setInFlight((n) => n + 1);
      try {
        let pending = options.pendingFollowUps;
        if (pending === undefined && isClosedStage(toStage)) pending = await loadPendingCount(prospect.id);
        const flow = decideStageFlow(prospect.stage, toStage, pending ?? 0);

        if (flow.kind === "noop") return "unchanged";

        if (flow.kind === "immediate") {
          const result = await moveProspectStage({ prospectId: prospect.id, toStage });
          if (!result.ok) {
            toast.error(result.error);
            return "failed";
          }
          if (!result.data.changed) return "unchanged";
          toast.success(`Moved ${prospect.name} to ${STAGE_LABELS[toStage]}.`);
          return "moved";
        }

        // Dialog stages: wait for Save / Skip / Cancel. A newer request cancels an open one.
        resolverRef.current?.("cancelled");
        return await new Promise<StageChangeResult>((resolve) => {
          resolverRef.current = resolve;
          keyRef.current += 1;
          setRequest({ key: keyRef.current, prospect, toStage, flow });
        });
      } catch {
        toast.error(GENERIC_ERROR);
        return "failed";
      } finally {
        setInFlight((n) => n - 1);
      }
    },
    [],
  );

  const submit = useCallback(
    async (submission: StageChangeSubmission) => {
      if (!request) return;
      const { prospect, toStage, flow } = request;
      const stageLabel = STAGE_LABELS[toStage];
      setSaving(true);
      let moved = false;
      try {
        // 1. Move first.
        const move = await moveProspectStage(
          submission.kind === "close" && flow.kind === "close"
            ? toCloseStageInput(prospect.id, flow.outcome, submission.values)
            : { prospectId: prospect.id, toStage },
        );
        if (!move.ok) {
          toast.error(move.error); // keep the dialog open: retry or Cancel
          return;
        }
        moved = true;

        // 2. Then the extras. A failure here does not undo the move.
        let extraError: string | null = null;
        let extraNote = "";
        if (submission.kind === "demo_booked") {
          const result = await setDemoDetails(toSetDemoDetailsInput(prospect.id, submission.values));
          if (!result.ok) extraError = `the demo details weren't saved: ${result.error}`;
        } else if (submission.kind === "demo_attended") {
          const result = await logDemoAttended(toLogDemoAttendedInput(prospect.id, submission.values));
          if (!result.ok) extraError = `the demo notes weren't saved: ${result.error}`;
        } else if (
          submission.kind === "close" &&
          flow.kind === "close" &&
          flow.offerCompleteFollowUps &&
          submission.values.completePendingFollowUps
        ) {
          const result = await completeAllPendingFollowUps({ prospectId: prospect.id });
          if (!result.ok) extraError = `the follow-ups weren't completed: ${result.error}`;
          else if (result.data.completed > 0) {
            extraNote = ` Completed ${result.data.completed} follow-up${result.data.completed === 1 ? "" : "s"}.`;
          }
        }

        if (extraError) toast.error(`Moved ${prospect.name} to ${stageLabel}, but ${extraError}`);
        else toast.success(`Moved ${prospect.name} to ${stageLabel}.${extraNote}`);
        settle("moved");
      } catch {
        toast.error(moved ? `Moved ${prospect.name} to ${stageLabel}, but something went wrong.` : GENERIC_ERROR);
        if (moved) settle("moved");
      } finally {
        setSaving(false);
      }
    },
    [request, settle],
  );

  const cancel = useCallback(() => settle("cancelled"), [settle]);

  const dialog = useMemo(
    () => (
      <StageChangeDialog
        request={request}
        timezone={timezone}
        saving={saving}
        onSubmit={submit}
        onCancel={cancel}
      />
    ),
    [request, timezone, saving, submit, cancel],
  );

  return { requestStageChange, dialog, isBusy: saving || inFlight > 0 || request !== null };
}
