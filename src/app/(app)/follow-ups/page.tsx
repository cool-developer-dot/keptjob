import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/app-shell/page-header";
import { requireUser } from "@/lib/auth";
import { getOrgSettings } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { orgToday, timeZoneAbbreviation } from "@/lib/time";
import { parseFollowUpsParams, type FollowUpsParams } from "@/lib/validation/follow-ups-page";
import type { DataContext } from "@/server/data/context";
import {
  countNeedsAttentionData,
  FOLLOW_UPS_LIMIT,
  getFollowUpCountsData,
  listFollowUpsData,
  listNeedsAttentionData,
} from "@/server/data/follow-up-views";
import { listTeamData } from "@/server/data/prospect-detail";

import { FollowUpList } from "./follow-up-list";
import { FollowUpListSkeleton } from "./follow-up-list-skeleton";
import { FollowUpTabs } from "./follow-up-tabs";
import { NeedsAttentionList } from "./needs-attention-list";
import { OwnerFilter } from "./owner-filter";

export const metadata: Metadata = { title: "Follow-ups · AI Sales CRM" };

/**
 * Follow-ups (SPEC §8, §9.4, §9.6, §11): Overdue / Today / Upcoming (7 days) /
 * Completed (30 days) tabs bucketed in SQL against the org "today"
 * (follow_up_buckets view, same definition as the counts), plus "Needs
 * attention" (open deals that are stale or have no follow-up). State in the
 * URL (`tab`, `owner` for managers). The tab list streams behind a skeleton.
 */
export default async function FollowUpsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const isManager = user.role === "manager";
  const [raw, supabase, settings] = await Promise.all([searchParams, createClient(), getOrgSettings()]);

  const parsed = parseFollowUpsParams(raw);
  // Reps: no owner filter (RLS scopes them to their own rows anyway).
  const params: FollowUpsParams = isManager ? parsed : { ...parsed, owner: null };

  const ctx: DataContext = { supabase, user: { id: user.id, role: user.role } };
  const [counts, attention, team] = await Promise.all([
    getFollowUpCountsData(ctx, { ownerId: params.owner }),
    countNeedsAttentionData(ctx, { ownerId: params.owner }),
    listTeamData(ctx),
  ]);
  if (!counts.ok) throw new Error(counts.error);
  if (!attention.ok) throw new Error(attention.error);
  if (!team.ok) throw new Error(team.error);

  const names = Object.fromEntries(team.data.map((member) => [member.id, member.full_name]));
  const now = new Date();
  const tzLabel = timeZoneAbbreviation(settings.timezone, now);

  return (
    <>
      <PageHeader
        title="Follow-ups"
        description={`${isManager ? "The team's" : "Your"} follow-ups by due date and the deals that need attention. Dates use the org timezone (${tzLabel}).`}
        actions={isManager ? <OwnerFilter params={params} owners={team.data} /> : undefined}
      />
      <FollowUpTabs params={params} counts={{ ...counts.data, attention: attention.data }} />
      <Suspense key={`${params.tab}:${params.owner ?? ""}`} fallback={<FollowUpListSkeleton />}>
        <TabPanel
          ctx={ctx}
          params={params}
          names={names}
          showOwner={isManager}
          today={orgToday(settings.timezone, now)}
          now={now.toISOString()}
        />
      </Suspense>
    </>
  );
}

async function TabPanel({
  ctx,
  params,
  names,
  showOwner,
  today,
  now,
}: {
  ctx: DataContext;
  params: FollowUpsParams;
  names: Record<string, string>;
  showOwner: boolean;
  today: string;
  now: string;
}) {
  if (params.tab === "attention") {
    const result = await listNeedsAttentionData(ctx, { ownerId: params.owner });
    if (!result.ok) throw new Error(result.error);
    return (
      <NeedsAttentionList
        rows={result.data.rows}
        total={result.data.total}
        names={names}
        showOwner={showOwner}
        now={now}
      />
    );
  }

  const result = await listFollowUpsData(ctx, { tab: params.tab, ownerId: params.owner });
  if (!result.ok) throw new Error(result.error);
  return (
    <>
      {result.data.truncated && (
        <p role="status" className="mb-3 text-sm text-muted-foreground">
          Showing the first {FOLLOW_UPS_LIMIT.toLocaleString("en-US")} follow-ups.
        </p>
      )}
      <FollowUpList
        tab={params.tab}
        rows={result.data.rows}
        names={names}
        showOwner={showOwner}
        currentUserId={ctx.user.id}
        today={today}
        now={now}
      />
    </>
  );
}
