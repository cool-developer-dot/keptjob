"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { TIMEZONE_OPTIONS } from "@/lib/constants";
import { COMMON_CURRENCIES } from "@/lib/money";
import type { OrgSettings } from "@/lib/org-settings";
import {
  STALE_DAYS_MAX,
  STALE_DAYS_MIN,
  orgSettingsSchema,
  type OrgSettingsInput,
} from "@/lib/validation/settings";
import { updateOrgSettings } from "@/server/actions/settings";

export function OrgSettingsForm({ settings }: { settings: OrgSettings }) {
  const [pending, startTransition] = useTransition();
  const form = useForm<OrgSettingsInput>({
    resolver: zodResolver(orgSettingsSchema),
    defaultValues: settings,
  });

  // Keep a currency set outside the common list selectable.
  const currencies = COMMON_CURRENCIES.some((c) => c.code === settings.defaultCurrency)
    ? COMMON_CURRENCIES
    : [{ code: settings.defaultCurrency, name: settings.defaultCurrency }, ...COMMON_CURRENCIES];

  const onSubmit = (values: OrgSettingsInput) =>
    startTransition(async () => {
      const result = await updateOrgSettings(values);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      form.reset(result.data);
      toast.success("Settings saved.");
    });

  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>Organization</CardTitle>
        <CardDescription>Defaults used across the CRM for the whole team.</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5" noValidate>
            <FormField
              control={form.control}
              name="defaultCurrency"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Default currency</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full sm:w-72">
                        <SelectValue placeholder="Choose a currency" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {currencies.map((c) => (
                        <SelectItem key={c.code} value={c.code}>
                          {c.code} · {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    Applies to new prospects; existing prospects keep their currency.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="timezone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Timezone</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full sm:w-72">
                        <SelectValue placeholder="Choose a timezone" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {TIMEZONE_OPTIONS.map((tz) => (
                        <SelectItem key={tz.value} value={tz.value}>
                          {tz.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    Used for &ldquo;today&rdquo;, due and overdue follow-ups, and all dates and times.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="staleDays"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Stale after (days)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={STALE_DAYS_MIN}
                      max={STALE_DAYS_MAX}
                      step={1}
                      className="w-32"
                      name={field.name}
                      ref={field.ref}
                      onBlur={field.onBlur}
                      value={Number.isNaN(field.value) ? "" : field.value}
                      onChange={(e) => field.onChange(e.target.valueAsNumber)}
                    />
                  </FormControl>
                  <FormDescription>
                    Open deals with no activity for this many days are flagged as stale ({STALE_DAYS_MIN}
                    –{STALE_DAYS_MAX}).
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" disabled={pending || !form.formState.isDirty}>
              {pending ? "Saving…" : "Save settings"}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
