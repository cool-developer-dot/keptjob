"use client";

/**
 * The stage-change prompts (SPEC §9): Demo Booked, Demo Attended and Closed
 * Won/Lost. Presentational + react-hook-form only — the server calls live in
 * useStageChange(). Render it through `useStageChange().dialog`.
 */
import { zodResolver } from "@hookform/resolvers/zod";
import { useMemo } from "react";
import { useForm, useWatch, type Control, type FieldValues, type Path } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  LOST_REASON_OPTIONS,
  STAGE_LABELS,
  TIMEZONE_LABELS,
  WON_REASON_OPTIONS,
  type AllowedTimezone,
  type PipelineStage,
} from "@/lib/constants";
import { timeZoneAbbreviation } from "@/lib/time";
import {
  closeFormSchema,
  demoAttendedFormSchema,
  demoBookedFormSchema,
  type CloseFormValues,
  type DemoAttendedFormValues,
  type DemoBookedFormValues,
} from "@/lib/validation/stage-change";
import { demoAttendedDefaults, demoBookedDefaults, demoFollowUpDueDate, type StageFlow } from "@/lib/workflow";

/** The prospect fields the flow needs (a full ProspectRow fits). */
export type StageChangeProspect = {
  id: string;
  name: string;
  stage: PipelineStage;
  demo_at?: string | null;
};

export type DialogStageFlow = Extract<StageFlow, { kind: "demo_booked" | "demo_attended" | "close" }>;

export type StageChangeRequest = {
  /** Unique per request: resets the form for every new prompt. */
  key: number;
  prospect: StageChangeProspect;
  toStage: PipelineStage;
  flow: DialogStageFlow;
};

export type StageChangeSubmission =
  | { kind: "skip" }
  | { kind: "demo_booked"; values: DemoBookedFormValues }
  | { kind: "demo_attended"; values: DemoAttendedFormValues }
  | { kind: "close"; values: CloseFormValues };

type StageChangeDialogProps = {
  request: StageChangeRequest | null;
  timezone: AllowedTimezone;
  /** True while the move / secondary actions run: buttons disabled, can't be dismissed. */
  saving: boolean;
  onSubmit: (submission: StageChangeSubmission) => void;
  onCancel: () => void;
};

export function StageChangeDialog({ request, timezone, saving, onSubmit, onCancel }: StageChangeDialogProps) {
  const open = request !== null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !saving) onCancel();
      }}
    >
      {request ? (
        <DialogContent
          key={request.key}
          showCloseButton={!saving}
          onEscapeKeyDown={(event) => saving && event.preventDefault()}
          onInteractOutside={(event) => saving && event.preventDefault()}
          className="sm:max-w-md"
        >
          <DialogHeader>
            <DialogTitle>
              Move “{request.prospect.name}” to {STAGE_LABELS[request.toStage]}
            </DialogTitle>
            <DialogDescription>{describe(request.flow, timezone)}</DialogDescription>
          </DialogHeader>
          {request.flow.kind === "demo_booked" ? (
            <DemoBookedForm
              prospect={request.prospect}
              timezone={timezone}
              saving={saving}
              onSubmit={onSubmit}
              onCancel={onCancel}
            />
          ) : request.flow.kind === "demo_attended" ? (
            <DemoAttendedForm timezone={timezone} saving={saving} onSubmit={onSubmit} onCancel={onCancel} />
          ) : (
            <CloseForm flow={request.flow} saving={saving} onSubmit={onSubmit} onCancel={onCancel} />
          )}
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

function describe(flow: DialogStageFlow, timezone: AllowedTimezone): string {
  const zone = `Times are in ${TIMEZONE_LABELS[timezone]}.`;
  switch (flow.kind) {
    case "demo_booked":
      return `Add the demo date and time and a follow-up, or skip to only change the stage. ${zone}`;
    case "demo_attended":
      return "Add your demo notes and the next follow-up, or skip to only change the stage.";
    case "close":
      return `A ${flow.outcome === "won" ? "won" : "lost"} reason is required to close the deal.`;
  }
}

type FormProps = {
  saving: boolean;
  onSubmit: (submission: StageChangeSubmission) => void;
  onCancel: () => void;
};

function Footer({ saving, onCancel, onSkip, saveDisabled }: {
  saving: boolean;
  onCancel: () => void;
  onSkip?: () => void;
  saveDisabled?: boolean;
}) {
  return (
    <DialogFooter>
      <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
        Cancel
      </Button>
      {onSkip ? (
        <Button type="button" variant="secondary" onClick={onSkip} disabled={saving}>
          Skip
        </Button>
      ) : null}
      <Button type="submit" disabled={saving || saveDisabled}>
        {saving ? "Saving…" : "Save"}
      </Button>
    </DialogFooter>
  );
}

function CheckboxField<T extends FieldValues>({
  control,
  name,
  label,
  disabled,
}: {
  control: Control<T>;
  name: Path<T>;
  label: string;
  disabled?: boolean;
}) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className="flex flex-row items-center gap-2 space-y-0">
          <FormControl>
            <Checkbox
              checked={field.value === true}
              onCheckedChange={(checked) => field.onChange(checked === true)}
              onBlur={field.onBlur}
              ref={field.ref}
              disabled={disabled}
            />
          </FormControl>
          <FormLabel className="font-normal">{label}</FormLabel>
        </FormItem>
      )}
    />
  );
}

/** Follow-up due date + note, shown when "Create a follow-up" is checked. */
function FollowUpFields<T extends DemoBookedFormValues | DemoAttendedFormValues>({
  control,
  disabled,
}: {
  control: Control<T>;
  disabled: boolean;
}) {
  // Both form value types share these fields.
  const c = control as unknown as Control<DemoAttendedFormValues>;
  const createFollowUp = useWatch({ control: c, name: "createFollowUp" });
  return (
    <fieldset className="glass-tile space-y-3 rounded-2xl p-3.5" disabled={disabled}>
      <legend className="sr-only">Follow-up</legend>
      <CheckboxField control={c} name="createFollowUp" label="Create a follow-up" />
      {createFollowUp ? (
        <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
          <FormField
            control={c}
            name="followUpDueDate"
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
            control={c}
            name="followUpNote"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Follow-up note</FormLabel>
                <FormControl>
                  <Input autoComplete="off" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      ) : null}
    </fieldset>
  );
}

function DemoBookedForm({
  prospect,
  timezone,
  saving,
  onSubmit,
  onCancel,
}: FormProps & { prospect: StageChangeProspect; timezone: AllowedTimezone }) {
  const defaultValues = useMemo(() => demoBookedDefaults(prospect.demo_at, timezone), [prospect.demo_at, timezone]);
  const form = useForm<DemoBookedFormValues>({
    resolver: zodResolver(demoBookedFormSchema),
    defaultValues,
  });
  const zone = timeZoneAbbreviation(timezone);

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit((values) => onSubmit({ kind: "demo_booked", values }))}
        className="space-y-4"
        noValidate
      >
        <fieldset className="grid grid-cols-2 gap-3" disabled={saving}>
          <legend className="sr-only">Demo date and time ({zone})</legend>
          <FormField
            control={form.control}
            name="demoDate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Demo date ({zone})</FormLabel>
                <FormControl>
                  <Input
                    type="date"
                    {...field}
                    onChange={(event) => {
                      field.onChange(event);
                      // Keep the follow-up on "the day after the demo" until the user edits it.
                      if (!form.getFieldState("followUpDueDate").isDirty) {
                        form.setValue("followUpDueDate", demoFollowUpDueDate(event.target.value), {
                          shouldValidate: form.formState.isSubmitted,
                        });
                      }
                    }}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="demoTime"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Time ({zone})</FormLabel>
                <FormControl>
                  <Input type="time" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </fieldset>
        <FollowUpFields control={form.control} disabled={saving} />
        <Footer saving={saving} onCancel={onCancel} onSkip={() => onSubmit({ kind: "skip" })} />
      </form>
    </Form>
  );
}

function DemoAttendedForm({ timezone, saving, onSubmit, onCancel }: FormProps & { timezone: AllowedTimezone }) {
  const defaultValues = useMemo(() => demoAttendedDefaults(timezone), [timezone]);
  const form = useForm<DemoAttendedFormValues>({
    resolver: zodResolver(demoAttendedFormSchema),
    defaultValues,
  });

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit((values) => onSubmit({ kind: "demo_attended", values }))}
        className="space-y-4"
        noValidate
      >
        <FormField
          control={form.control}
          name="notes"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Demo notes</FormLabel>
              <FormControl>
                <Textarea rows={4} placeholder="How did the demo go?" disabled={saving} {...field} />
              </FormControl>
              <FormDescription>Optional. Saved as a demo entry on the timeline.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FollowUpFields control={form.control} disabled={saving} />
        <Footer saving={saving} onCancel={onCancel} onSkip={() => onSubmit({ kind: "skip" })} />
      </form>
    </Form>
  );
}

function CloseForm({
  flow,
  saving,
  onSubmit,
  onCancel,
}: FormProps & { flow: Extract<StageFlow, { kind: "close" }> }) {
  const schema = useMemo(() => closeFormSchema(flow.outcome), [flow.outcome]);
  const form = useForm<CloseFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { closeReason: "", closeNotes: "", completePendingFollowUps: flow.offerCompleteFollowUps },
  });
  const closeReason = useWatch({ control: form.control, name: "closeReason" });
  const options = flow.outcome === "won" ? WON_REASON_OPTIONS : LOST_REASON_OPTIONS;
  const n = flow.pendingFollowUps;

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit((values) => onSubmit({ kind: "close", values }))}
        className="space-y-4"
        noValidate
      >
        <FormField
          control={form.control}
          name="closeReason"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{flow.outcome === "won" ? "Won reason" : "Lost reason"} (required)</FormLabel>
              <Select value={field.value} onValueChange={field.onChange} disabled={saving}>
                <FormControl>
                  <SelectTrigger className="w-full" aria-required="true" ref={field.ref} onBlur={field.onBlur}>
                    <SelectValue placeholder="Choose a reason" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {options.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
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
          name="closeNotes"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Notes (optional)</FormLabel>
              <FormControl>
                <Textarea rows={3} disabled={saving} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {flow.offerCompleteFollowUps ? (
          <CheckboxField
            control={form.control}
            name="completePendingFollowUps"
            label={`Mark ${n} pending follow-up${n === 1 ? "" : "s"} as completed`}
            disabled={saving}
          />
        ) : null}
        <Footer saving={saving} onCancel={onCancel} saveDisabled={!closeReason} />
      </form>
    </Form>
  );
}
