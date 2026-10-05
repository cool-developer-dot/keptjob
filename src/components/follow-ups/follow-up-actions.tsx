"use client";

/**
 * Per-follow-up actions, reusable by the detail page (Prompt 8) and the
 * follow-ups page (Prompt 10):
 * - <CompleteFollowUpButton>   popover with an optional outcome note → completeFollowUp
 *                              (`nextAction` adds a button to the success toast)
 * - <RescheduleFollowUpButton> popover with a date input → rescheduleFollowUp
 * - <DeleteFollowUpButton>     alert-dialog confirm → deleteFollowUp
 * The actions revalidate the affected pages; `onDone` is for extra UI (e.g. a toast action).
 */
import { zodResolver } from "@hookform/resolvers/zod";
import { CalendarClockIcon, CheckIcon, Trash2Icon } from "lucide-react";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { formatDateString } from "@/lib/time";
import { followUpCompleteSchema, followUpRescheduleSchema } from "@/lib/validation/follow-ups";
import { completeFollowUp, deleteFollowUp, rescheduleFollowUp } from "@/server/actions/followUps";
import type { FollowUpRow } from "@/server/data/context";

type FollowUpRef = Pick<FollowUpRow, "id" | "note" | "due_date">;

const completeFormSchema = followUpCompleteSchema.pick({ note: true });
const rescheduleFormSchema = followUpRescheduleSchema.pick({ dueDate: true });

/** Optional button on the success toast, e.g. "Schedule next follow-up" (Prompt 10). */
export type FollowUpToastAction = {
  label: string;
  onClick: (completed: FollowUpRow) => void;
};

/** How long a success toast with an action stays up (time to click it). */
const ACTION_TOAST_MS = 10_000;

export function CompleteFollowUpButton({
  followUp,
  onDone,
  nextAction,
}: {
  followUp: FollowUpRef;
  onDone?: (completed: FollowUpRow) => void;
  nextAction?: FollowUpToastAction;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const form = useForm({
    resolver: zodResolver(completeFormSchema),
    defaultValues: { note: "" },
  });

  const onOpenChange = (next: boolean) => {
    if (pending) return;
    if (next) form.reset({ note: "" });
    setOpen(next);
  };

  const onSubmit = (values: { note?: string | null }) =>
    startTransition(async () => {
      const result = await completeFollowUp({
        followUpId: followUp.id,
        note: values.note,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const completed = result.data;
      toast.success(
        "Follow-up completed.",
        nextAction
          ? {
              duration: ACTION_TOAST_MS,
              action: {
                label: nextAction.label,
                onClick: () => nextAction.onClick(completed),
              },
            }
          : undefined,
      );
      setOpen(false);
      onDone?.(completed);
    });

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" aria-label={`Complete follow-up: ${followUp.note}`}>
          <CheckIcon aria-hidden />
          Complete
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-3">
            <p className="text-sm font-medium">Complete “{followUp.note}”</p>
            <FormField
              control={form.control}
              name="note"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Outcome (optional)</FormLabel>
                  <FormControl>
                    <Textarea rows={2} placeholder="What happened?" {...field} value={field.value ?? ""} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={pending}>
                {pending ? "Saving…" : "Mark complete"}
              </Button>
            </div>
          </form>
        </Form>
      </PopoverContent>
    </Popover>
  );
}

export function RescheduleFollowUpButton({
  followUp,
  onDone,
}: {
  followUp: FollowUpRef;
  onDone?: (updated: FollowUpRow) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const form = useForm({
    resolver: zodResolver(rescheduleFormSchema),
    defaultValues: { dueDate: followUp.due_date },
  });

  const onOpenChange = (next: boolean) => {
    if (pending) return;
    if (next) form.reset({ dueDate: followUp.due_date });
    setOpen(next);
  };

  const onSubmit = (values: { dueDate: string }) =>
    startTransition(async () => {
      if (values.dueDate === followUp.due_date) {
        setOpen(false);
        return;
      }
      const result = await rescheduleFollowUp({
        followUpId: followUp.id,
        dueDate: values.dueDate,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Rescheduled to ${formatDateString(result.data.due_date)}.`);
      setOpen(false);
      onDone?.(result.data);
    });

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={`Reschedule follow-up: ${followUp.note}`}>
          <CalendarClockIcon aria-hidden />
          Reschedule
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-3">
            <FormField
              control={form.control}
              name="dueDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>New due date</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={pending}>
                {pending ? "Saving…" : "Save date"}
              </Button>
            </div>
          </form>
        </Form>
      </PopoverContent>
    </Popover>
  );
}

export function DeleteFollowUpButton({ followUp, onDone }: { followUp: FollowUpRef; onDone?: () => void }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const confirm = (event: React.MouseEvent) => {
    event.preventDefault(); // keep the dialog open while deleting
    startTransition(async () => {
      const result = await deleteFollowUp({ followUpId: followUp.id });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Follow-up deleted.");
      setOpen(false);
      onDone?.();
    });
  };

  return (
    <AlertDialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Delete follow-up: ${followUp.note}`}>
          <Trash2Icon aria-hidden />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this follow-up?</AlertDialogTitle>
          <AlertDialogDescription>
            “{followUp.note}” (due {formatDateString(followUp.due_date)}) will be removed. This can&apos;t be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={confirm} disabled={pending}>
            {pending ? "Deleting…" : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
