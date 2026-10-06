import { CalendarClockIcon, HistoryIcon, SirenIcon, SparklesIcon } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/app-shell/page-header";
import { requireUser } from "@/lib/auth";
import { DASHBOARD_LIMITS, firstName, greetingFor } from "@/lib/dashboard";
import { getOrgSettings } from "@/lib/org";
import type { OrgSettings } from "@/lib/org-settings";
import { createClient } from "@/lib/supabase/server";
import { formatOrgDate, orgToday, timeZoneAbbreviation, type DateString } from "@/lib/time";
import { parseDashboardParams } from "@/lib/validation/dashboard";
import type { DataContext } from "@/server/data/context";
import {
  getDashboardKpisData,
  listContactTodayData,
  listDealsNeedingAttentionData,
  listLatestAiRecommendationsData,
  listRecentActivityData,
} from "@/server/data/dashboard";
import { listTeamData, type TeamMember } from "@/server/data/prospect-detail";

import { AiRecommendationsList } from "./ai-recommendations";
import { AttentionList } from "./attention-list";
import { ContactTodayList } from "./contact-today";
import { KpiTiles } from "./kpi-tiles";
import { DashboardOwnerFilter } from "./owner-filter";
import { RecentActivityFeed } from "./recent-activity";
import { SectionCard } from "@/components/section-card";
import { KpiTilesSkeleton, SectionSkeleton } from "./skeletons";

export const metadata: Metadata = { title: "Dashboard · AI Sales CRM" };

/** Rows shown per section (the full lists live on the linked pages), keeping the dashboard calm. */
const VISIBLE = { contactToday: 5, attention: 5, activity: 8 } as const;

/**
 * Dashboard (SPEC §1): who to contact (KPIs + Contact today), last
 * conversation / objections / next follow-up / AI next step per contact,
 * deals needing attention (ranked), latest AI recommendations, recent
 * activity. Reps see their own data (RLS); managers can filter by owner
 * (`?owner=`). Every section streams in its own Suspense boundary; their
 * queries run in parallel. Dates use the org timezone.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const isManager = user.role === "manager";
  const [raw, supabase, settings] = await Promise.all([searchParams, createClient(), getOrgSettings()]);
  const ctx: DataContext = { supabase, user: { id: user.id, role: user.role } };

  const team = await listTeamData(ctx);
  if (!team.ok) throw new Error(team.error);

  // Reps: no owner filter (RLS scopes them to their own rows anyway). Unknown owner ids → All.
  const requested = parseDashboardParams(raw).owner;
  const owner = isManager && team.data.some((member) => member.id === requested) ? requested : null;

  const now = new Date();
  const today = orgToday(settings.timezone, now);
  const ownerName = owner ? team.data.find((member) => member.id === owner)?.full_name : null;
  const scope = !isManager ? "Your day at a glance" : ownerName ? `Showing ${ownerName}` : "The whole team";

  const shared = {
    ctx,
    owner,
    settings,
    team: team.data,
    showOwner: isManager && !owner,
    today,
    now: now.toISOString(),
  };

  return (
    <>
      <PageHeader
        title={`${greetingFor(settings.timezone, now)}, ${firstName(user.full_name)}`}
        description={`${formatOrgDate(now, settings.timezone, "EEEE, MMMM d, yyyy")} (${timeZoneAbbreviation(settings.timezone, now)}) · ${scope}`}
        actions={isManager ? <DashboardOwnerFilter owner={owner} owners={team.data} /> : undefined}
      />
      <div className="space-y-6" key={owner ?? "all"}>
        <Suspense fallback={<KpiTilesSkeleton />}>
          <KpiSection {...shared} />
        </Suspense>
        <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
          <div className="min-w-0 space-y-6">
            <Suspense fallback={<SectionSkeleton label="contact today" />}>
              <ContactTodaySection {...shared} />
            </Suspense>
            <Suspense fallback={<SectionSkeleton label="deals needing attention" />}>
              <AttentionSection {...shared} />
            </Suspense>
          </div>
          <div className="min-w-0 space-y-6">
            <Suspense fallback={<SectionSkeleton label="AI recommendations" rows={2} />}>
              <AiSection {...shared} />
            </Suspense>
            <Suspense fallback={<SectionSkeleton label="recent activity" rows={4} />}>
              <ActivitySection {...shared} />
            </Suspense>
          </div>
        </div>
      </div>
    </>
  );
}

type SectionProps = {
  ctx: DataContext;
  owner: string | null;
  settings: OrgSettings;
  team: TeamMember[];
  showOwner: boolean;
  today: DateString;
  now: string;
};

function namesOf(team: TeamMember[]): Record<string, string> {
  return Object.fromEntries(team.map((member) => [member.id, member.full_name]));
}

function followUpsHref(owner: string | null, tab?: string): string {
  const params = new URLSearchParams();
  if (tab) params.set("tab", tab);
  if (owner) params.set("owner", owner);
  const query = params.toString();
  return query ? `/follow-ups?${query}` : "/follow-ups";
}

async function KpiSection({ ctx, owner, today }: SectionProps) {
  const result = await getDashboardKpisData(ctx, { ownerId: owner, today });
  if (!result.ok) throw new Error(result.error);
  return <KpiTiles kpis={result.data} owner={owner} />;
}

async function ContactTodaySection({ ctx, owner, team, showOwner, today, settings, now }: SectionProps) {
  const result = await listContactTodayData(ctx, { ownerId: owner });
  if (!result.ok) throw new Error(result.error);
  const { total } = result.data;
  const rows = result.data.rows.slice(0, VISIBLE.contactToday);
  return (
    <SectionCard
      id="contact-today"
      title="Contact today"
      icon={<CalendarClockIcon />}
      tone="neutral"
      description={
        total === 0
          ? "Follow-ups due today or overdue"
          : `${total} follow-up${total === 1 ? "" : "s"} due today or overdue · most overdue first`
      }
      action={{ href: followUpsHref(owner), label: total > rows.length ? `View all ${total}` : "Follow-ups" }}
    >
      <ContactTodayList
        rows={rows}
        names={namesOf(team)}
        showOwner={showOwner}
        today={today}
        timezone={settings.timezone}
        now={now}
      />
    </SectionCard>
  );
}

async function AttentionSection({ ctx, owner, team, showOwner, settings, now }: SectionProps) {
  const result = await listDealsNeedingAttentionData(ctx, { ownerId: owner, limit: DASHBOARD_LIMITS.attention });
  if (!result.ok) throw new Error(result.error);
  const { total } = result.data;
  const rows = result.data.rows.slice(0, VISIBLE.attention);
  return (
    <SectionCard
      id="attention"
      title="Deals needing attention"
      icon={<SirenIcon />}
      tone="red"
      description={`${total > rows.length ? `Top ${rows.length} of ${total}` : "Ranked"}: overdue, stale, low AI health, no follow-up`}
      action={{ href: followUpsHref(owner, "attention"), label: total > rows.length ? `View all ${total}` : "Needs attention" }}
    >
      <AttentionList
        rows={rows}
        names={namesOf(team)}
        showOwner={showOwner}
        staleDays={settings.staleDays}
        timezone={settings.timezone}
        now={now}
      />
    </SectionCard>
  );
}

async function AiSection({ ctx, owner, settings, now }: SectionProps) {
  const result = await listLatestAiRecommendationsData(ctx, { ownerId: owner });
  if (!result.ok) throw new Error(result.error);
  return (
    <SectionCard
      id="ai-recommendations"
      title="Latest AI recommendations"
      icon={<SparklesIcon />}
      tone="neutral"
      description="Newest next step per open deal"
    >
      <AiRecommendationsList rows={result.data} timezone={settings.timezone} now={now} />
    </SectionCard>
  );
}

async function ActivitySection({ ctx, owner, team, settings, now }: SectionProps) {
  const result = await listRecentActivityData(ctx, { ownerId: owner });
  if (!result.ok) throw new Error(result.error);
  return (
    <SectionCard
      id="recent-activity"
      title="Recent activity"
      icon={<HistoryIcon />}
      tone="sky"
      description="Latest updates across your deals"
    >
      <RecentActivityFeed
        rows={result.data.slice(0, VISIBLE.activity)}
        users={team}
        timezone={settings.timezone}
        now={now}
      />
    </SectionCard>
  );
}
