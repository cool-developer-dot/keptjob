"use client";

/**
 * Reusable "add follow-up" form → createFollowUp (owner = the prospect's owner,
 * set by the data layer). Due date is an org-local "YYYY-MM-DD" (default: org
 * today + 1). Used by the prospect detail page (Prompt 8); Prompt 10 ("Schedule
 * next follow-up") and Prompt 11 ("Create follow-up from next step", pass
 * `defaultNote`) reuse it.
 */
import { zodResolver } from "@hookform/resolvers/zod";
import { useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { useOrgSettings } from "@/components/org-settings-provider";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { addDaysToDateString, formatDateString, orgToday, type DateString } from "@/lib/time";
import { followUpInputSchema, type FollowUpInput } from "@/lib/validation/follow-ups";
import { createFollowUp } from "@/server/actions/followUps";
import type { FollowUpRow } from "@/server/data/context";

type Props = {
  prospectId: string;
  /** Org-local "YYYY-MM-DD"; default org today + 1. */
  defaultDueDate?: DateString;
  defaultNote?: string;
  submitLabel?: string;
  /** Called after a successful create (e.g. close a dialog / popover). */
  onDone?: (followUp: FollowUpRow) => void;
  onCancel?: () => void;
};

export function FollowUpForm({
  prospectId,
  defaultDueDate,
  defaultNote = "",
  submitLabel = "Add follow-up",
  onDone,
  onCancel,
}: Props) {
  const { timezone } = useOrgSettings();
  const [pending, startTransition] = useTransition();
  const form = useForm<FollowUpInput>({
    resolver: zodResolver(followUpInputSchema),
    defaultValues: {
      dueDate: defaultDueDate ?? addDaysToDateString(orgToday(timezone), 1),
      note: defaultNote,
    },
  });

  const onSubmit = (values: FollowUpInput) =>
    startTransition(async () => {
      const result = await createFollowUp({ prospectId, ...values });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Follow-up added for ${formatDateString(result.data.due_date)}.`);
      form.reset({ dueDate: values.dueDate, note: "" });
      onDone?.(result.data);
    });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3" noValidate aria-label="Add follow-up">
        <FormField
          control={form.control}
          name="dueDate"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Due date</FormLabel>
              <FormControl>
                <Input type="date" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="note"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Task</FormLabel>
              <FormControl>
                <Textarea rows={2} placeholder="e.g. Send the proposal" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="flex justify-end gap-2">
          {onCancel && (
            <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={pending}>
              Cancel
            </Button>
          )}
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Saving…" : submitLabel}
          </Button>
        </div>
      </form>
    </Form>
  );
}
