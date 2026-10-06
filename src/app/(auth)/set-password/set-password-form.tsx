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
import { PASSWORD_MIN_LENGTH, setPasswordSchema, type SetPasswordInput } from "@/lib/validation/auth";
import { setPassword } from "@/server/actions/auth";

export function SetPasswordForm({ email }: { email: string }) {
  const [pending, startTransition] = useTransition();
  const form = useForm<SetPasswordInput>({
    resolver: zodResolver(setPasswordSchema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  const onSubmit = (values: SetPasswordInput) =>
    startTransition(async () => {
      // On success the action redirects to /dashboard.
      const result = await setPassword(values);
      if (result && !result.ok) toast.error(result.error);
    });

  return (
    <Card className="glass-strong gap-6 rounded-3xl py-7 [--card-spacing:--spacing(7)]">
      <CardHeader>
        <CardTitle className="text-xl">Set your password</CardTitle>
        <CardDescription>
          Choose a new password for <strong>{email}</strong>.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
            {/* Lets password managers associate the new password with the account. */}
            <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>New password</FormLabel>
                  <FormControl>
                    <Input type="password" autoComplete="new-password" autoFocus {...field} />
                  </FormControl>
                  <FormDescription>At least {PASSWORD_MIN_LENGTH} characters.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="confirmPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Confirm password</FormLabel>
                  <FormControl>
                    <Input type="password" autoComplete="new-password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? "Saving…" : "Save password"}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
