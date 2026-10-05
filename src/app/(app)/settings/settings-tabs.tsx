"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type SettingsTab = "organization" | "team";

/** Organization / Team tabs; the Team tab is kept in the URL (?tab=team). */
export function SettingsTabs({
  initialTab,
  organization,
  team,
}: {
  initialTab: SettingsTab;
  organization: React.ReactNode;
  team: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [tab, setTab] = useState<SettingsTab>(initialTab);

  const onValueChange = (value: string) => {
    const next: SettingsTab = value === "team" ? "team" : "organization";
    setTab(next);
    router.replace(next === "team" ? `${pathname}?tab=team` : pathname, { scroll: false });
  };

  return (
    <Tabs value={tab} onValueChange={onValueChange} className="gap-6">
      <TabsList>
        <TabsTrigger value="organization">Organization</TabsTrigger>
        <TabsTrigger value="team">Team</TabsTrigger>
      </TabsList>
      <TabsContent value="organization">{organization}</TabsContent>
      <TabsContent value="team">{team}</TabsContent>
    </Tabs>
  );
}
