import type { Metadata } from "next";

import { PageHeader } from "@/components/app-shell/page-header";

export const metadata: Metadata = { title: "Dashboard · AI Sales CRM" };

export default function DashboardPage() {
  return (
    <>
      <PageHeader title="Dashboard" description="Who to contact today and which deals need attention." />
      <p className="text-sm text-muted-foreground">Coming soon (Prompt 12).</p>
    </>
  );
}
