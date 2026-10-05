"use client";

/**
 * Prospect info card. View mode lists every SPEC §3 field; "Edit" turns the card
 * into a form in place (react-hook-form + prospectDetailsFormSchema) and saves
 * only the changed fields with updateProspect (the server re-validates).
 * "Next follow-up" is derived (earliest pending follow-up) and read-only: it
 * links to the follow-ups panel.
 */
import { zodResolver } from "@hookform/resolvers/zod";
import { PencilIcon } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { useOrgSettings } from "@/components/org-settings-provider";
import { ObjectionMultiSelect } from "@/components/prospects/objection-multi-select";
import { DecisionMakerLabel, FollowUpBadge, ObjectionChips } from "@/components/prospects/prospect-badges";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { DECISION_MAKER_STATUS_LABELS, DECISION_MAKER_STATUS_OPTIONS } from "@/lib/constants";
import { COMMON_CURRENCIES, formatMoney } from "@/lib/money";
import { formatOrgDateTime } from "@/lib/time";
import {
  changedProspectFields,
  prospectDetailsFormSchema,
  type ProspectDetailsFormData,
  type ProspectDetailsFormInput,
} from "@/lib/validation/prospects";
import { updateProspect } from "@/server/actions/prospects";
import type { ProspectDetail } from "@/server/data/prospect-detail";

function toFormValues(prospect: ProspectDetail): ProspectDetailsFormInput {
  return {
    name: prospect.name,
    company: prospect.company ?? "",
    email: prospect.email ?? "",
    phone: prospect.phone ?? "",
    decisionMakerStatus: prospect.decision_maker_status,
    objections: prospect.objections,
    objectionNotes: prospect.objection_notes ?? "",
    notes: prospect.notes ?? "",
    dealValue: prospect.deal_value == null ? "" : String(prospect.deal_value),
    currency: prospect.currency,
  };
}

export function ProspectInfoCard({ prospect }: { prospect: ProspectDetail }) {
  const [editing, setEditing] = useState(false);

  return (
    <Card aria-labelledby="details-title">
      <CardHeader>
        <CardTitle id="details-title">Details</CardTitle>
        <CardDescription>Contact, decision maker, objections and notes.</CardDescription>
        {!editing && (
          <CardAction>
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              <PencilIcon aria-hidden />
              Edit
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        {editing ? (
          <DetailsForm prospect={prospect} onClose={() => setEditing(false)} />
        ) : (
          <DetailsView prospect={prospect} />
        )}
      </CardContent>
    </Card>
  );
}

function Field({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "space-y-1 sm:col-span-2" : "space-y-1"}>
      <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd className="text-sm break-words">{children}</dd>
    </div>
  );
}

const empty = <span className="text-muted-foreground">—</span>;

function DetailsView({ prospect }: { prospect: ProspectDetail }) {
  const { timezone } = useOrgSettings();
  return (
    <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
      <Field label="Name">{prospect.name}</Field>
      <Field label="Company">{prospect.company ?? empty}</Field>
      <Field label="Email">
        {prospect.email ? (
          <a href={`mailto:${prospect.email}`} className="underline-offset-4 hover:underline">
            {prospect.email}
          </a>
        ) : (
          empty
        )}
      </Field>
      <Field label="Phone">
        {prospect.phone ? (
          <a href={`tel:${prospect.phone.replace(/[^\d+]/g, "")}`} className="underline-offset-4 hover:underline">
            {prospect.phone}
          </a>
        ) : (
          empty
        )}
      </Field>
      <Field label="Decision maker">
        <DecisionMakerLabel status={prospect.decision_maker_status} />
      </Field>
      <Field label="Deal value">
        {prospect.deal_value == null ? empty : `${formatMoney(prospect.deal_value, prospect.currency)} (${prospect.currency})`}
      </Field>
      <Field label="Next follow-up">
        <span className="flex flex-wrap items-center gap-2">
          <FollowUpBadge dueDate={prospect.follow_up_date} timezone={timezone} />
          <a href="#follow-ups" className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground">
            {prospect.follow_up_date ? "View follow-ups" : "Add a follow-up"}
          </a>
        </span>
      </Field>
      <Field label="Objections">
        <ObjectionChips objections={prospect.objections} />
      </Field>
      <Field label="Objection notes" wide>
        {prospect.objection_notes ? <span className="whitespace-pre-wrap">{prospect.objection_notes}</span> : empty}
      </Field>
      <Field label="Conversation notes" wide>
        {prospect.notes ? <span className="whitespace-pre-wrap">{prospect.notes}</span> : empty}
      </Field>
      <Field label="Created">{formatOrgDateTime(prospect.created_at, timezone)}</Field>
      <Field label="Last updated">{formatOrgDateTime(prospect.updated_at, timezone)}</Field>
    </dl>
  );
}

function DetailsForm({ prospect, onClose }: { prospect: ProspectDetail; onClose: () => void }) {
  const [pending, startTransition] = useTransition();
  const initialValues = useMemo(() => toFormValues(prospect), [prospect]);
  const form = useForm<ProspectDetailsFormInput, unknown, ProspectDetailsFormData>({
    resolver: zodResolver(prospectDetailsFormSchema),
    defaultValues: initialValues,
  });

  const currencies = useMemo(() => {
    const codes: string[] = COMMON_CURRENCIES.map((c) => c.code);
    return codes.includes(prospect.currency) ? codes : [prospect.currency, ...codes];
  }, [prospect.currency]);

  const onSubmit = (values: ProspectDetailsFormData) =>
    startTransition(async () => {
      const initial = prospectDetailsFormSchema.safeParse(initialValues);
      // Existing data that no longer validates → send everything.
      const changes = initial.success ? changedProspectFields(initial.data, values) : values;
      if (Object.keys(changes).length === 0) {
        onClose();
        return;
      }
      const result = await updateProspect({ prospectId: prospect.id, ...changes });
      if (!result.ok) {
        toast.error(result.error); // stay in edit mode with the user's input
        return;
      }
      toast.success("Details saved.");
      onClose();
    });

  const text = (value: unknown) => (typeof value === "string" || typeof value === "number" ? value : "");

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        noValidate
        aria-label="Edit details"
        className="space-y-4"
        onKeyDown={(event) => {
          if (event.key === "Escape" && !pending && event.target instanceof HTMLInputElement) onClose();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Name</FormLabel>
                <FormControl>
                  <Input autoComplete="off" {...field} value={text(field.value)} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="company"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Company</FormLabel>
                <FormControl>
                  <Input autoComplete="off" {...field} value={text(field.value)} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Email</FormLabel>
                <FormControl>
                  <Input type="email" autoComplete="off" {...field} value={text(field.value)} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="phone"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Phone</FormLabel>
                <FormControl>
                  <Input type="tel" autoComplete="off" {...field} value={text(field.value)} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="decisionMakerStatus"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Decision maker</FormLabel>
                <Select value={field.value} onValueChange={field.onChange} disabled={pending}>
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue>{field.value ? DECISION_MAKER_STATUS_LABELS[field.value] : null}</SelectValue>
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {DECISION_MAKER_STATUS_OPTIONS.map((option) => (
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
          <div className="grid grid-cols-[1fr_6.5rem] gap-2">
            <FormField
              control={form.control}
              name="dealValue"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Deal value</FormLabel>
                  <FormControl>
                    <Input
                      inputMode="decimal"
                      autoComplete="off"
                      placeholder="Optional"
                      {...field}
                      value={text(field.value)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="currency"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Currency</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange} disabled={pending}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue>{field.value}</SelectValue>
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {currencies.map((code) => (
                        <SelectItem key={code} value={code}>
                          {code}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </div>
        <FormField
          control={form.control}
          name="objections"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Objections</FormLabel>
              <FormControl>
                <ObjectionMultiSelect value={field.value ?? []} onChange={field.onChange} disabled={pending} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="objectionNotes"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Objection notes</FormLabel>
              <FormControl>
                <Textarea rows={2} {...field} value={text(field.value)} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="notes"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Conversation notes</FormLabel>
              <FormControl>
                <Textarea rows={5} {...field} value={text(field.value)} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save details"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
