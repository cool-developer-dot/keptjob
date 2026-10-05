import type { DataContext } from "@/server/data/context";
import { listProspectFollowUpsData, type TeamMember } from "@/server/data/prospect-detail";

import { FollowUpsPanel } from "./follow-ups-panel";

/** Server part of the follow-ups panel (streams inside <Suspense>). */
export async function FollowUpsSection({
  ctx,
  prospectId,
  team,
}: {
  ctx: DataContext;
  prospectId: string;
  team: TeamMember[];
}) {
  const result = await listProspectFollowUpsData(ctx, prospectId);
  if (!result.ok) throw new Error(result.error);
  const names = Object.fromEntries(team.map((member) => [member.id, member.full_name]));
  return (
    <FollowUpsPanel
      prospectId={prospectId}
      pending={result.data.pending}
      completed={result.data.completed}
      userNames={names}
    />
  );
}
