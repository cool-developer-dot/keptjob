"use client";

/**
 * "Log activity" (call / conversation / note / demo) → addActivity. The time is
 * entered in the org timezone (default: now, computed when the form opens — never
 * during SSR) and converted with orgLocalToUtc (SPEC §6).
 */
import { zodResolver } from "@hookform/resolvers/zod";
import { PlusIcon } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { useOrgSettings } from "@/components/org-settings-provider";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ACTIVITY_TYPE_LABELS, MANUAL_ACTIVITY_TYPES } from "@/lib/constants";
import { timeZoneAbbreviation, utcToOrgLocal } from "@/lib/time";
import {
  makeActivityFormSchema,
  toActivityCreateInput,
  type ActivityFormData,
  type ActivityFormInput,
} from "@/lib/validation/activities";
import { addActivity } from "@/server/actions/activities";

export function LogActivityForm({ prospectId }: { prospectId: string }) {
  const { timezone } = useOrgSettings();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const schema = useMemo(() => makeActivityFormSchema(timezone), [timezone]);
  const form = useForm<ActivityFormInput, unknown, ActivityFormData>({
    resolver: zodResolver(schema),
    defaultValues: { type: "call", content: "", date: "", time: "" },
  });
  const tzLabel = timeZoneAbbreviation(timezone);
  // The prefilled "now" (minute precision). Left unchanged → the server's now()
  // is used, so the entry keeps its exact time (and newest-first order).
  const [prefilled, setPrefilled] = useState<{ date: string; time: string } | null>(null);

  const openForm = () => {
    const now = utcToOrgLocal(new Date(), timezone);
    setPrefilled(now);
    form.reset({ type: "call", content: "", date: now.date, time: now.time });
    setOpen(true);
  };

  const onSubmit = (values: ActivityFormData) =>
    startTransition(async () => {
      const keptNow = values.date === prefilled?.date && values.time === prefilled?.time;
      const input = toActivityCreateInput(prospectId, values, timezone);
      const result = await addActivity(keptNow ? { ...input, occurredAt: undefined } : input);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`${ACTIVITY_TYPE_LABELS[values.type]} logged.`);
      setOpen(false);
    });

  if (!open) {
    return (
      <Button variant="outline" onClick={openForm}>
        <PlusIcon aria-hidden />
        Log activity
      </Button>
    );
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        noValidate
        aria-label="Log activity"
        className="space-y-4 rounded-lg border bg-muted/30 p-4"
        onKeyDown={(event) => {
          if (event.key === "Escape" && !pending) setOpen(false);
        }}
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <FormField
            control={form.control}
            name="type"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Type</FormLabel>
                <Select value={field.value} onValueChange={field.onChange} disabled={pending}>
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue>{ACTIVITY_TYPE_LABELS[field.value]}</SelectValue>
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {MANUAL_ACTIVITY_TYPES.map((type) => (
                      <SelectItem key={type} value={type}>
                        {ACTIVITY_TYPE_LABELS[type]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="date"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Date</FormLabel>
                <FormControl>
                  <Input type="date" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="time"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Time ({tzLabel})</FormLabel>
                <FormControl>
                  <Input type="time" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <FormField
          control={form.control}
          name="content"
          render={({ field }) => (
            <FormItem>
              <FormLabel>What happened?</FormLabel>
              <FormControl>
                <Textarea rows={3} autoFocus placeholder="Summary, next steps, objections…" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save activity"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
