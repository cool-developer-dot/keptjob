import type { Metadata } from "next";

import { PageHeader } from "@/components/app-shell/page-header";

export const metadata: Metadata = { title: "Prospect · AI Sales CRM" };

export default async function ProspectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <>
      <PageHeader title="Prospect details" description={`Prospect ${id}`} />
      <p className="text-sm text-muted-foreground">Coming soon (Prompt 8).</p>
    </>
  );
}
