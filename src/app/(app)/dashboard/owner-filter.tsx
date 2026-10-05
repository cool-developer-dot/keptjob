"use client";

import { Loader2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { dashboardHref } from "@/lib/validation/dashboard";
import type { TeamMember } from "@/server/data/prospect-detail";

const ALL = "all";

/** Managers: show the whole team or one rep; the URL `owner` param is the state. */
export function DashboardOwnerFilter({ owner, owners }: { owner: string | null; owners: TeamMember[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const label = owners.find((member) => member.id === owner)?.full_name ?? "All owners";

  const onChange = (next: string) => {
    startTransition(() => {
      router.push(dashboardHref({ owner: next === ALL ? null : next }), { scroll: false });
    });
  };

  return (
    <div className="flex items-center gap-2">
      {pending && (
        <Loader2Icon aria-label="Loading" role="status" className="size-4 animate-spin text-muted-foreground" />
      )}
      <Select value={owner ?? ALL} onValueChange={onChange}>
        <SelectTrigger aria-label="Owner" className="w-44">
          {/* Explicit children: rendered on the server too. */}
          <SelectValue>{label}</SelectValue>
        </SelectTrigger>
        <SelectContent align="end">
          <SelectItem value={ALL}>All owners</SelectItem>
          {owners.map((member) => (
            <SelectItem key={member.id} value={member.id}>
              {member.full_name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
