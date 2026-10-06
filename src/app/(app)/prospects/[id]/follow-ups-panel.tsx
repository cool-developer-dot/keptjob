"use client";

/**
 * Follow-ups panel (SPEC §8): pending (soonest first, Overdue / Today badges in
 * the org timezone) and completed, with add / complete / reschedule / delete.
 * Anchor target of the info card's "Next follow-up" link (#follow-ups).
 */
import { CalendarCheckIcon, PlusIcon } from "lucide-react";
import { useState } from "react";

import {
  CompleteFollowUpButton,
  DeleteFollowUpButton,
  RescheduleFollowUpButton,
} from "@/components/follow-ups/follow-up-actions";
import { FollowUpForm } from "@/components/follow-ups/follow-up-form";
import { useOrgSettings } from "@/components/org-settings-provider";
import { FollowUpBadge } from "@/components/prospects/prospect-badges";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateString, formatOrgDate } from "@/lib/time";
import type { FollowUpRow } from "@/server/data/context";

export function FollowUpsPanel({
  prospectId,
  pending,
  completed,
  userNames,
}: {
  prospectId: string;
  pending: FollowUpRow[];
  completed: FollowUpRow[];
  userNames: Record<string, string>;
}) {
  const { timezone } = useOrgSettings();
  const [adding, setAdding] = useState(false);

  return (
    <Card id="follow-ups" aria-labelledby="follow-ups-title" className="scroll-mt-20">
      <CardHeader>
        <CardTitle id="follow-ups-title" className="flex items-center gap-2">
          <CalendarCheckIcon aria-hidden className="size-4 text-muted-foreground" />
          Follow-ups
        </CardTitle>
        <CardDescription>
          {pending.length === 0 ? "Nothing scheduled." : `${pending.length} pending`}
        </CardDescription>
        {!adding && (
          <CardAction>
            <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
              <PlusIcon aria-hidden />
              Add follow-up
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="space-y-5">
        {adding && (
          <div className="glass-tile rounded-2xl p-3.5">
            <FollowUpForm prospectId={prospectId} onDone={() => setAdding(false)} onCancel={() => setAdding(false)} />
          </div>
        )}

        <section aria-label="Pending follow-ups">
          {pending.length === 0 ? (
            <p className="text-sm text-muted-foreground">No pending follow-ups. Add one so this deal doesn&apos;t go stale.</p>
          ) : (
            <ul className="divide-y">
              {pending.map((followUp) => (
                <li key={followUp.id} className="space-y-2 py-3 first:pt-0 last:pb-0" data-follow-up-id={followUp.id}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 space-y-1">
                      <FollowUpBadge dueDate={followUp.due_date} timezone={timezone} className="text-sm" />
                      <p className="text-sm break-words whitespace-pre-wrap">{followUp.note}</p>
                    </div>
                    <DeleteFollowUpButton followUp={followUp} />
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <CompleteFollowUpButton followUp={followUp} />
                    <RescheduleFollowUpButton followUp={followUp} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {completed.length > 0 && (
          <section aria-labelledby="completed-follow-ups-title" className="space-y-2">
            <h3 id="completed-follow-ups-title" className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Completed
            </h3>
            <ul className="divide-y">
              {completed.map((followUp) => (
                <li
                  key={followUp.id}
                  className="flex items-start justify-between gap-2 py-2 first:pt-0 last:pb-0"
                  data-follow-up-id={followUp.id}
                >
                  <div className="min-w-0 space-y-0.5">
                    <p className="text-sm break-words text-muted-foreground line-through decoration-muted-foreground/40">
                      {followUp.note}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Due {formatDateString(followUp.due_date)}
                      {followUp.completed_at && <> · Completed {formatOrgDate(followUp.completed_at, timezone)}</>}
                      {followUp.completed_by && <> by {userNames[followUp.completed_by] ?? "a former user"}</>}
                    </p>
                  </div>
                  <DeleteFollowUpButton followUp={followUp} />
                </li>
              ))}
            </ul>
          </section>
        )}
      </CardContent>
    </Card>
  );
}
