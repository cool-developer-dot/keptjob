import { BarChart3Icon, FilterIcon, ThumbsDownIcon } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { PageHeader } from "@/components/app-shell/page-header";
import { SectionCard, SectionEmpty } from "@/components/section-card";
import { requireUser } from "@/lib/auth";
import { getOrgSettings } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { formatPct, formatReportRange, type ReportRange } from "@/lib/reports";
import { orgToday, timeZoneAbbreviation } from "@/lib/time";
import { parseReportsParams, reportRangeFor, reportsHref } from "@/lib/validation/reports";
import type { DataContext } from "@/server/data/context";
import { listTeamData } from "@/server/data/prospect-detail";
import { getReportData } from "@/server/data/reports";

import { HorizontalBarChart } from "./bar-chart";
import { ReportFilters } from "./report-filters";
import { ConversionTable, ReportKpiTiles, StageCountStrip } from "./report-sections";
import { ReportSkeleton } from "./skeletons";

export const metadata: Metadata = { title: "Reports · AI Sales CRM" };

/**
 * Reports (SPEC §12). Period presets are resolved against the org-local today;
 * reps see their own numbers (RLS; `owner` ignored), managers the team or one
 * owner. All numbers come from the SQL report functions (getReportData).
 */
export default async function ReportsPage({
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

  const parsed = parseReportsParams(raw);
  // Reps: no owner filter. Unknown owner ids → All.
  const owner = isManager && team.data.some((member) => member.id === parsed.owner) ? parsed.owner : null;
  const params = { ...parsed, owner };

  const now = new Date();
  const range = reportRangeFor(params, orgToday(settings.timezone, now));
  const ownerName = owner ? team.data.find((member) => member.id === owner)?.full_name : null;
  const scope = !isManager ? "Your numbers" : ownerName ? `Showing ${ownerName}` : "The whole team";

  return (
    <>
      <PageHeader
        title="Reports"
        description={`${formatReportRange(range)} (${timeZoneAbbreviation(settings.timezone, now)}) · ${scope}`}
      />
      <ReportFilters
        key={reportsHref(params)}
        params={params}
        range={range}
        owners={isManager ? team.data.map(({ id, full_name }) => ({ id, full_name })) : undefined}
      />
      <Suspense key={`${range.from}:${range.to}:${owner ?? "all"}`} fallback={<ReportSkeleton />}>
        <ReportContent ctx={ctx} range={range} owner={owner} />
      </Suspense>
    </>
  );
}

async function ReportContent({ ctx, range, owner }: { ctx: DataContext; range: ReportRange; owner: string | null }) {
  const result = await getReportData(ctx, { ...range, ownerId: owner });
  if (!result.ok) throw new Error(result.error);
  const data = result.data;
  const created = data.funnel[0]?.count ?? 0;

  return (
    <div className="space-y-6">
      <ReportKpiTiles data={data} />

      <SectionCard
        id="stage-counts"
        title="Counts"
        description="Contacted to Follow-ups: prospects created in the period that reached at least that stage (skipped stages count). Closed won / lost: deals closed in the period."
      >
        <StageCountStrip data={data} />
      </SectionCard>

      <div className="grid min-w-0 gap-6 xl:grid-cols-2">
        <SectionCard
          id="funnel"
          title="Funnel"
          description="Prospects created in the period by the highest stage they ever reached."
        >
          {created === 0 ? (
            <SectionEmpty
              icon={<FilterIcon />}
              title="No prospects created in this period"
              body="Pick a longer period to see the funnel."
            />
          ) : (
            <HorizontalBarChart
              caption="Funnel: prospects created in the period that reached each step"
              valueHeader="Prospects"
              data={data.funnel.map((step) => ({
                key: step.stage,
                label: step.label,
                value: step.count,
                detail: step.step === 1 ? undefined : `${formatPct(step.stepConversionPct)} of previous step`,
              }))}
            />
          )}
        </SectionCard>

        <SectionCard id="conversion" title="Conversion rates" description="Between consecutive funnel steps.">
          {created === 0 ? (
            <SectionEmpty
              icon={<FilterIcon />}
              title="No conversion data"
              body="Conversion rates need prospects created in the period."
            />
          ) : (
            <ConversionTable funnel={data.funnel} winRatePct={data.outcomes.winRatePct} />
          )}
        </SectionCard>
      </div>

      <div className="grid min-w-0 gap-6 lg:grid-cols-2">
        <SectionCard id="by-stage" title="Prospects by stage" description="Current stage of every prospect (now).">
          {data.totalProspects === 0 ? (
            <SectionEmpty icon={<BarChart3Icon />} title="No prospects yet" />
          ) : (
            <HorizontalBarChart
              caption="Prospects by current stage"
              valueHeader="Prospects"
              data={data.stageCounts.map((row) => ({ key: row.stage, label: row.label, value: row.count }))}
            />
          )}
        </SectionCard>

        <SectionCard id="lost-reasons" title="Lost reasons" description="Deals closed lost in the period.">
          {data.outcomes.lost === 0 ? (
            <SectionEmpty icon={<ThumbsDownIcon />} title="No deals lost in this period" />
          ) : (
            <HorizontalBarChart
              caption="Lost reasons of deals closed lost in the period"
              valueHeader="Deals"
              data={data.outcomes.lostReasons.map((row) => ({ key: row.reason, label: row.label, value: row.count }))}
            />
          )}
        </SectionCard>
      </div>
    </div>
  );
}
