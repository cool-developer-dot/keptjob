import type { Metadata } from "next";

import { PageHeader } from "@/components/app-shell/page-header";

export const metadata: Metadata = { title: "Prospects · AI Sales CRM" };

export default function ProspectsPage() {
  return (
    <>
      <PageHeader title="Prospects" description="All prospects you have access to." />
      <p className="text-sm text-muted-foreground">Coming soon (Prompt 7).</p>
    </>
  );
}
