import { HistoryIcon } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getOrgSettings } from "@/lib/org";
import { buildTimeline } from "@/lib/timeline";
import type { DataContext } from "@/server/data/context";
import {
  ACTIVITY_LIMIT,
  listProspectActivitiesData,
  listProspectStageHistoryData,
  type TeamMember,
} from "@/server/data/prospect-detail";

import { LogActivityForm } from "./log-activity-form";
import { Timeline } from "./timeline";

/** Activity card: "Log activity" form + the timeline, newest first (streams inside <Suspense>). */
export async function TimelineSection({
  ctx,
  prospectId,
  team,
}: {
  ctx: DataContext;
  prospectId: string;
  team: TeamMember[];
}) {
  const [activities, history, settings] = await Promise.all([
    listProspectActivitiesData(ctx, prospectId),
    listProspectStageHistoryData(ctx, prospectId),
    getOrgSettings(),
  ]);
  if (!activities.ok) throw new Error(activities.error);
  if (!history.ok) throw new Error(history.error);

  const entries = buildTimeline({
    activities: activities.data.rows,
    // The "created" entry is only accurate when the oldest activities are loaded.
    stageHistory: activities.data.truncated ? [] : history.data,
    users: team,
  });

  return (
    <Card aria-labelledby="activity-title">
      <CardHeader>
        <CardTitle id="activity-title" className="flex items-center gap-2">
          <HistoryIcon aria-hidden className="size-4 text-muted-foreground" />
          Activity
        </CardTitle>
        <CardDescription>Calls, conversations, notes, demos, follow-ups and changes, newest first.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <LogActivityForm prospectId={prospectId} />
        <Timeline entries={entries} timezone={settings.timezone} now={new Date()} />
        {activities.data.truncated && (
          <p className="text-center text-xs text-muted-foreground">Showing the latest {ACTIVITY_LIMIT} activities.</p>
        )}
      </CardContent>
    </Card>
  );
}
