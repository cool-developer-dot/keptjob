"use client";

/**
 * Quick "schedule a follow-up for prospect X" dialog around the reusable
 * <FollowUpForm> (default due: org today + 1). Used by the Follow-ups page
 * ("Schedule next follow-up" toast action, "Add follow-up" on needs-attention
 * rows); reusable by the Dashboard.
 *
 *   const { openScheduleFollowUp, dialog } = useScheduleFollowUp();
 *   openScheduleFollowUp({ prospectId, prospectName }, { title: "Schedule next follow-up" });
 *   return <>{rows}{dialog}</>; // render {dialog} once, above rows that may unmount
 */
import { useCallback, useState } from "react";

import { FollowUpForm } from "@/components/follow-ups/follow-up-form";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export type ScheduleFollowUpTarget = {
  prospectId: string;
  prospectName: string;
};

type OpenState = ScheduleFollowUpTarget & { title: string; key: number };

export function useScheduleFollowUp() {
  const [state, setState] = useState<OpenState | null>(null);
  const [open, setOpen] = useState(false);

  const openScheduleFollowUp = useCallback((target: ScheduleFollowUpTarget, options: { title?: string } = {}) => {
    // A fresh key per opening resets the form (new defaults, no stale input).
    setState({
      ...target,
      title: options.title ?? "Schedule follow-up",
      key: Date.now(),
    });
    setOpen(true);
  }, []);

  const close = useCallback(() => setOpen(false), []);

  const dialog = (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md">
        {state && (
          <>
            <DialogHeader>
              <DialogTitle>{state.title}</DialogTitle>
              <DialogDescription>For {state.prospectName}. Due dates are in the org timezone.</DialogDescription>
            </DialogHeader>
            <FollowUpForm
              key={state.key}
              prospectId={state.prospectId}
              submitLabel="Schedule follow-up"
              onDone={close}
              onCancel={close}
            />
          </>
        )}
      </DialogContent>
    </Dialog>
  );

  return { openScheduleFollowUp, dialog };
}
