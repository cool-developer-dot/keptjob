import type { Metadata } from "next";

import { PageHeader } from "@/components/app-shell/page-header";
import { requireManager } from "@/lib/auth";
import { getOrgSettings } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";

import { OrgSettingsForm } from "./org-settings-form";
import { SettingsTabs, type SettingsTab } from "./settings-tabs";
import { TeamTable } from "./team-table";

export const metadata: Metadata = { title: "Settings · AI Sales CRM" };

/** Managers only: enforced here (server) and in src/proxy.ts. */
export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const currentUser = await requireManager();
  const [{ tab }, settings, supabase] = await Promise.all([
    searchParams,
    getOrgSettings(),
    createClient(),
  ]);

  const { data: users, error } = await supabase
    .from("users")
    .select("id, full_name, email, role, created_at")
    .order("created_at", { ascending: true });
  if (error) throw new Error("Could not load the team.");

  const initialTab: SettingsTab = tab === "team" ? "team" : "organization";

  return (
    <>
      <PageHeader title="Settings" description="Organization settings and team invites." />
      <SettingsTabs
        initialTab={initialTab}
        organization={<OrgSettingsForm settings={settings} />}
        team={<TeamTable users={users ?? []} currentUserId={currentUser.id} />}
      />
    </>
  );
}
