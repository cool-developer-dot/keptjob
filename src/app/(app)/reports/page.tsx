import type { Metadata } from "next";

import { PageHeader } from "@/components/app-shell/page-header";

export const metadata: Metadata = { title: "Reports · AI Sales CRM" };

export default function ReportsPage() {
  return (
    <>
      <PageHeader title="Reports" description="Funnel, conversion rates, win rate and pipeline value." />
      <p className="text-sm text-muted-foreground">Coming soon (Prompt 13).</p>
    </>
  );
}
