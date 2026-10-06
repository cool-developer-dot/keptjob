"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { forgotPasswordSchema, type ForgotPasswordInput } from "@/lib/validation/auth";
import { requestPasswordReset } from "@/server/actions/auth";

export function ForgotPasswordForm() {
  const [pending, startTransition] = useTransition();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const form = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });

  const onSubmit = (values: ForgotPasswordInput) =>
    startTransition(async () => {
      const result = await requestPasswordReset(values);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setSentTo(values.email);
    });

  return (
    <Card className="glass-strong gap-6 rounded-3xl py-7 [--card-spacing:--spacing(7)]">
      <CardHeader>
        <CardTitle className="text-xl">Forgot password</CardTitle>
        <CardDescription>We&rsquo;ll email you a link to set a new password.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {sentTo ? (
          <p role="status" className="rounded-xl bg-white/60 p-3 text-sm ring-1 ring-[oklch(0.3_0.01_255/0.08)] dark:bg-white/5 dark:ring-white/10">
            If an account exists for <strong>{sentTo}</strong>, a reset link is on its way. Check
            your inbox.
          </p>
        ) : (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input type="email" autoComplete="email" autoFocus {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" className="w-full" disabled={pending}>
                {pending ? "Sending…" : "Send reset link"}
              </Button>
            </form>
          </Form>
        )}
        <p className="text-center text-sm">
          <Link href="/login" className="text-muted-foreground underline-offset-4 hover:underline">
            Back to log in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
