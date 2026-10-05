"use client";

/**
 * "New prospect" dialog → createProspect. Uses the shared prospectCreateSchema
 * (the action re-validates). Owner select only for managers (default = the
 * current user); currency is the org default (not sent; the DB fills it).
 */
import { zodResolver } from "@hookform/resolvers/zod";
import { PlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { useOrgSettings } from "@/components/org-settings-provider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { DECISION_MAKER_STATUS_OPTIONS, ROLE_LABELS, type Role } from "@/lib/constants";
import {
  prospectCreateSchema,
  type ProspectCreateData,
  type ProspectCreateInput,
} from "@/lib/validation/prospects";
import { createProspect } from "@/server/actions/prospects";

import { ObjectionMultiSelect } from "./objection-multi-select";

export type OwnerOption = { id: string; full_name: string; role: Role };

type Props = {
  currentUserId: string;
  /** Managers only: assignable users. null/undefined → no owner field (reps). */
  owners?: OwnerOption[] | null;
  triggerLabel?: string;
  triggerVariant?: React.ComponentProps<typeof Button>["variant"];
};

export function NewProspectDialog({
  currentUserId,
  owners,
  triggerLabel = "New prospect",
  triggerVariant = "default",
}: Props) {
  const router = useRouter();
  const { defaultCurrency } = useOrgSettings();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const canAssign = Boolean(owners && owners.length > 0);

  const empty: ProspectCreateInput = {
    name: "",
    company: "",
    email: "",
    phone: "",
    decisionMakerStatus: "unknown",
    objections: [],
    objectionNotes: "",
    notes: "",
    dealValue: "",
    ...(canAssign ? { ownerId: currentUserId } : {}),
  };

  const form = useForm<ProspectCreateInput, unknown, ProspectCreateData>({
    resolver: zodResolver(prospectCreateSchema),
    defaultValues: empty,
  });

  const onOpenChange = (next: boolean) => {
    if (pending) return;
    // Reset on open (not on close/success) so the closing dialog doesn't flash an empty form.
    if (next) form.reset(empty);
    setOpen(next);
  };

  const onSubmit = (values: ProspectCreateData) =>
    startTransition(async () => {
      const { ownerId, ...rest } = values;
      const result = await createProspect(canAssign ? { ...rest, ownerId } : rest);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const id = result.data.id;
      toast.success(`${result.data.name} was added.`, {
        action: { label: "View", onClick: () => router.push(`/prospects/${id}`) },
      });
      setOpen(false);
      router.refresh();
    });

  const text = (value: unknown) => (typeof value === "string" || typeof value === "number" ? value : "");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant={triggerVariant}>
          <PlusIcon aria-hidden />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New prospect</DialogTitle>
          <DialogDescription>New prospects start in the Prospect stage.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
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
            <div className="grid gap-4 sm:grid-cols-2">
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
                name="dealValue"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Deal value ({defaultCurrency})</FormLabel>
                    <FormControl>
                      <Input inputMode="decimal" autoComplete="off" placeholder="Optional" {...field} value={text(field.value)} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="decisionMakerStatus"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Decision maker</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
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
            <FormField
              control={form.control}
              name="objections"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Objections</FormLabel>
                  <FormControl>
                    <ObjectionMultiSelect value={field.value ?? []} onChange={field.onChange} onBlur={field.onBlur} />
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
                    <Textarea rows={3} {...field} value={text(field.value)} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {canAssign && owners && (
              <FormField
                control={form.control}
                name="ownerId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Owner</FormLabel>
                    <Select value={field.value ?? currentUserId} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {owners.map((owner) => (
                          <SelectItem key={owner.id} value={owner.id}>
                            {owner.full_name}
                            {owner.id === currentUserId ? " (you)" : ` · ${ROLE_LABELS[owner.role]}`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>Managers can assign the prospect to any team member.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Creating…" : "Create prospect"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
