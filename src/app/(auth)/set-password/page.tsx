import type { Metadata } from "next";

import { requireUser } from "@/lib/auth";

import { SetPasswordForm } from "./set-password-form";

export const metadata: Metadata = { title: "Set password · AI Sales CRM" };

/** Reached from an invite or recovery link (session set by /auth/confirm). */
export default async function SetPasswordPage() {
  const user = await requireUser();
  return <SetPasswordForm email={user.email} />;
}
