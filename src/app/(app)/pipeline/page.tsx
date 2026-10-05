import type { Metadata } from "next";

import { PageHeader } from "@/components/app-shell/page-header";

export const metadata: Metadata = { title: "Pipeline · AI Sales CRM" };

export default function PipelinePage() {
  return (
    <>
      <PageHeader title="Pipeline" description="Kanban board of open and closed deals by stage." />
      <p className="text-sm text-muted-foreground">Coming soon (Prompt 9).</p>
    </>
  );
}
