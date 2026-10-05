"use client";

import { Loader2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { followUpsHref, parseFollowUpsParams, type FollowUpsParams } from "@/lib/validation/follow-ups-page";
import type { TeamMember } from "@/server/data/prospect-detail";

const ALL = "all";

/** Managers: filter every tab (and the counts) by owner; the URL `owner` param is the state. */
export function OwnerFilter({ params, owners }: { params: FollowUpsParams; owners: TeamMember[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const label = owners.find((owner) => owner.id === params.owner)?.full_name ?? "All owners";

  const onChange = (next: string) => {
    // Latest tab from the address bar (props may lag behind a pending navigation).
    const current = parseFollowUpsParams(new URLSearchParams(window.location.search));
    startTransition(() => {
      router.push(followUpsHref(current, { owner: next === ALL ? null : next }), { scroll: false });
    });
  };

  return (
    <div className="flex items-center gap-2">
      {pending && (
        <Loader2Icon aria-label="Loading" role="status" className="size-4 animate-spin text-muted-foreground" />
      )}
      <Select value={params.owner ?? ALL} onValueChange={onChange}>
        <SelectTrigger aria-label="Owner" className="w-44">
          {/* Explicit children: rendered on the server too. */}
          <SelectValue>{label}</SelectValue>
        </SelectTrigger>
        <SelectContent align="end">
          <SelectItem value={ALL}>All owners</SelectItem>
          {owners.map((owner) => (
            <SelectItem key={owner.id} value={owner.id}>
              {owner.full_name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
