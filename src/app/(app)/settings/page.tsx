import type { Metadata } from "next";

import { PageHeader } from "@/components/app-shell/page-header";
import { requireManager } from "@/lib/auth";

export const metadata: Metadata = { title: "Settings · AI Sales CRM" };

/** Managers only: enforced here (server) and in src/proxy.ts. */
export default async function SettingsPage() {
  await requireManager();
  return (
    <>
      <PageHeader title="Settings" description="Organization settings and team invites." />
      <p className="text-sm text-muted-foreground">Coming soon (Prompt 4).</p>
    </>
  );
}
