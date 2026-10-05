import { cn } from "cn";
import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon } from "lucide-react";
import Link from "next/link";

import {
  DecisionMakerLabel,
  FollowUpBadge,
  ObjectionChips,
  StageBadge,
  StaleBadge,
} from "@/components/prospects/prospect-badges";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney } from "@/lib/money";
import { formatOrgDateTime, formatRelativeTime } from "@/lib/time";
import { sortHref, type ProspectListParams, type ProspectSortKey } from "@/lib/validation/prospect-list";
import type { ProspectListRow } from "@/server/data/prospect-list";

import { ProspectRowLink } from "./prospect-row-link";

type Props = {
  rows: ProspectListRow[];
  params: ProspectListParams;
  /** Owner column (managers only); null for reps. */
  ownerNames: ReadonlyMap<string, string> | null;
  timezone: string;
  staleDays: number;
  now: Date;
};

/** Server-rendered prospects table (sortable headers are links; state lives in the URL). */
export function ProspectsTable({ rows, params, ownerNames, timezone, staleDays, now }: Props) {
  return (
    <div className="rounded-lg border">
      <Table className="min-w-[900px]">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <SortableHead column="name" label="Name" params={params} />
            <SortableHead column="company" label="Company" params={params} />
            <SortableHead column="stage" label="Stage" params={params} />
            <TableHead className="whitespace-normal">Decision maker</TableHead>
            <TableHead>Objections</TableHead>
            <SortableHead column="follow_up" label="Next follow-up" params={params} />
            {ownerNames && <TableHead>Owner</TableHead>}
            <SortableHead column="last_activity" label="Last activity" params={params} />
            <SortableHead column="deal_value" label="Deal value" params={params} align="right" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const href = `/prospects/${row.id}`;
            return (
              <ProspectRowLink key={row.id} href={href}>
                <TableCell className="max-w-52">
                  <Link
                    href={href}
                    className="block truncate font-medium hover:underline focus-visible:underline focus-visible:outline-none"
                  >
                    {row.name}
                  </Link>
                  {row.email && <span className="block truncate text-xs text-muted-foreground">{row.email}</span>}
                </TableCell>
                <TableCell className="max-w-40 truncate">
                  {row.company ?? <span className="text-muted-foreground">—</span>}
                </TableCell>
                <TableCell>
                  <StageBadge stage={row.stage} />
                </TableCell>
                <TableCell>
                  <DecisionMakerLabel status={row.decision_maker_status} />
                </TableCell>
                <TableCell>
                  <ObjectionChips objections={row.objections} max={2} className="flex-nowrap" />
                </TableCell>
                <TableCell>
                  <FollowUpBadge dueDate={row.follow_up_date} timezone={timezone} now={now} />
                </TableCell>
                {ownerNames && (
                  <TableCell className="max-w-40 truncate">{ownerNames.get(row.owner_id) ?? "—"}</TableCell>
                )}
                <TableCell>
                  <span className="flex flex-col items-start gap-1 whitespace-nowrap">
                    <time
                      dateTime={row.last_activity_at}
                      title={formatOrgDateTime(row.last_activity_at, timezone)}
                    >
                      {formatRelativeTime(row.last_activity_at, now)}
                    </time>
                    {row.is_stale && <StaleBadge staleDays={staleDays} />}
                  </span>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatMoney(row.deal_value, row.currency)}
                </TableCell>
              </ProspectRowLink>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function SortableHead({
  column,
  label,
  params,
  align = "left",
}: {
  column: ProspectSortKey;
  label: string;
  params: ProspectListParams;
  align?: "left" | "right";
}) {
  const active = params.sort === column;
  const Icon = !active ? ArrowUpDownIcon : params.dir === "asc" ? ArrowUpIcon : ArrowDownIcon;
  return (
    <TableHead
      aria-sort={active ? (params.dir === "asc" ? "ascending" : "descending") : undefined}
      className={cn(align === "right" && "text-right")}
    >
      <Link
        href={sortHref(params, column)}
        scroll={false}
        className={cn(
          "inline-flex items-center gap-1 rounded-sm hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          active ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {label}
        <Icon aria-hidden className={cn("size-3.5", !active && "opacity-50")} />
        <span className="sr-only">
          {active ? `(sorted ${params.dir === "asc" ? "ascending" : "descending"}, click to reverse)` : "(sort)"}
        </span>
      </Link>
    </TableHead>
  );
}
