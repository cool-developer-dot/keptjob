"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { loginSchema, type LoginInput } from "@/lib/validation/auth";
import { signIn } from "@/server/actions/auth";

export function LoginForm({ next, linkError }: { next: string | null; linkError: boolean }) {
  const [pending, startTransition] = useTransition();
  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = (values: LoginInput) =>
    startTransition(async () => {
      // On success the action redirects; it only returns on failure.
      const result = await signIn(values, next);
      if (result && !result.ok) {
        toast.error(result.error);
        form.resetField("password");
      }
    });

  return (
    <Card className="glass-strong gap-6 rounded-3xl py-7 [--card-spacing:--spacing(7)]">
      <CardHeader>
        <CardTitle className="text-xl">Welcome back</CardTitle>
        <CardDescription>Log in with your work email and password.</CardDescription>
      </CardHeader>
      <CardContent>
        {linkError && (
          <p role="alert" className="mb-4 rounded-xl bg-destructive/10 p-3 text-sm text-destructive">
            This link is invalid or has expired. Request a new one with &ldquo;Forgot password?&rdquo;
            or ask your manager for a new invite.
          </p>
        )}
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
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-center justify-between">
                    <FormLabel>Password</FormLabel>
                    <Link
                      href="/forgot-password"
                      className="text-xs text-muted-foreground underline-offset-4 hover:underline"
                    >
                      Forgot password?
                    </Link>
                  </div>
                  <FormControl>
                    <Input type="password" autoComplete="current-password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" size="lg" className="w-full" disabled={pending}>
              {pending ? "Logging in…" : "Log in"}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
