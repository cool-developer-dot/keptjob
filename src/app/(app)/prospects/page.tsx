import { SearchXIcon, UsersIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/app-shell/page-header";
import { NewProspectDialog, type OwnerOption } from "@/components/prospects/new-prospect-dialog";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth";
import { getOrgSettings } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import {
  clearFiltersHref,
  hasActiveFilters,
  parseProspectListParams,
  type ProspectListParams,
} from "@/lib/validation/prospect-list";
import { listProspectsData } from "@/server/data/prospect-list";

import { ProspectsPagination } from "./pagination";
import { ProspectFilters } from "./prospect-filters";
import { ProspectsTable } from "./prospects-table";

export const metadata: Metadata = { title: "Prospects · AI Sales CRM" };

/**
 * Prospects list (SPEC §11). Server-rendered from URL search params; RLS (via
 * the user-scoped client) limits reps to their own prospects.
 */
export default async function ProspectsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const isManager = user.role === "manager";
  const [raw, settings, supabase] = await Promise.all([searchParams, getOrgSettings(), createClient()]);

  const parsed = parseProspectListParams(raw);
  // Reps: the owner filter doesn't exist (RLS scopes them anyway).
  const params: ProspectListParams = isManager ? parsed : { ...parsed, owner: null };

  const ctx = { supabase, user: { id: user.id, role: user.role } };
  const [result, owners] = await Promise.all([
    listProspectsData(ctx, params),
    isManager ? loadOwners(supabase) : Promise.resolve(null),
  ]);
  if (!result.ok) throw new Error(result.error);

  const { rows, total, page, pageCount, pageSize } = result.data;
  const ownerNames = owners ? new Map(owners.map((owner) => [owner.id, owner.full_name])) : null;
  const filtered = hasActiveFilters(params);
  const newProspect = (variant?: "default" | "outline") => (
    <NewProspectDialog currentUserId={user.id} owners={owners} triggerVariant={variant} />
  );

  return (
    <>
      <PageHeader
        title="Prospects"
        description={isManager ? "Every prospect on the team." : "Your prospects."}
        actions={newProspect()}
      />
      <ProspectFilters params={params} owners={owners} />

      {rows.length === 0 ? (
        filtered ? (
          <EmptyState
            icon={<SearchXIcon aria-hidden className="size-6" />}
            title="No prospects match your filters"
            description="Try a different search or clear the filters."
            action={
              <Button variant="outline" asChild>
                <Link href={clearFiltersHref(params)}>Clear filters</Link>
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={<UsersIcon aria-hidden className="size-6" />}
            title="No prospects yet"
            description={
              isManager ? "Add the first prospect for your team." : "Add your first prospect to start your pipeline."
            }
            action={newProspect("outline")}
          />
        )
      ) : (
        <>
          <ProspectsTable
            rows={rows}
            params={params}
            ownerNames={ownerNames}
            timezone={settings.timezone}
            staleDays={settings.staleDays}
            now={new Date()}
          />
          <ProspectsPagination
            params={params}
            page={page}
            pageCount={pageCount}
            pageSize={pageSize}
            total={total}
            shown={rows.length}
          />
        </>
      )}
    </>
  );
}

async function loadOwners(supabase: Awaited<ReturnType<typeof createClient>>): Promise<OwnerOption[]> {
  const { data, error } = await supabase
    .from("users")
    .select("id, full_name, role")
    .order("full_name", { ascending: true });
  if (error) throw new Error("Could not load the team.");
  return data ?? [];
}

function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  action: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 py-16 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">{icon}</div>
      <div className="space-y-1">
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}
