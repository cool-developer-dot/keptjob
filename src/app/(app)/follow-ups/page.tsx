import type { Metadata } from "next";

import { PageHeader } from "@/components/app-shell/page-header";

export const metadata: Metadata = { title: "Follow-ups · AI Sales CRM" };

export default function FollowUpsPage() {
  return (
    <>
      <PageHeader title="Follow-ups" description="Due today, overdue, upcoming and completed follow-ups." />
      <p className="text-sm text-muted-foreground">Coming soon (Prompt 10).</p>
    </>
  );
}
