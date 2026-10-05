import type { Metadata } from "next";

import { PageHeader } from "@/components/app-shell/page-header";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { parsePipelineParams, type PipelineParams } from "@/lib/validation/pipeline";
import { listPipelineData, PIPELINE_LIMIT } from "@/server/data/pipeline";
import { listTeamData } from "@/server/data/prospect-detail";

import { PipelineBoard } from "./pipeline-board";
import { PipelineFilters } from "./pipeline-filters";

export const metadata: Metadata = { title: "Pipeline · AI Sales CRM" };

/**
 * Kanban pipeline (SPEC §2, §9, §11). Server-rendered and filtered from the URL
 * (`q`, `owner` for managers) through RLS; the client board handles drag and
 * drop (Prompt 6 stage-change flow) and refreshes on Realtime changes.
 */
export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const isManager = user.role === "manager";
  const [raw, supabase] = await Promise.all([searchParams, createClient()]);

  const parsed = parsePipelineParams(raw);
  // Reps: no owner filter (RLS scopes them anyway).
  const params: PipelineParams = isManager ? parsed : { ...parsed, owner: null };

  const ctx = { supabase, user: { id: user.id, role: user.role } };
  const [result, team] = await Promise.all([
    listPipelineData(ctx, params),
    isManager ? listTeamData(ctx) : Promise.resolve(null),
  ]);
  if (!result.ok) throw new Error(result.error);
  if (team && !team.ok) throw new Error(team.error);
  const owners = team ? team.data : null;

  return (
    <>
      <PageHeader
        title="Pipeline"
        description={
          isManager
            ? "Every deal on the team by stage. Drag a card to change its stage."
            : "Your deals by stage. Drag a card to change its stage."
        }
      />
      <PipelineFilters params={params} owners={owners} />
      {result.data.truncated && (
        <p role="status" className="mb-3 text-sm text-muted-foreground">
          Showing the {PIPELINE_LIMIT.toLocaleString("en-US")} most recently active prospects. Use search
          {isManager ? " or the owner filter" : ""} to narrow the board.
        </p>
      )}
      <PipelineBoard cards={result.data.cards} owners={owners} userId={user.id} now={new Date().toISOString()} />
    </>
  );
}
