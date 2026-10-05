"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { useOrgSettings } from "@/components/org-settings-provider";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ROLE_LABELS, ROLE_OPTIONS, ROLES, type Role } from "@/lib/constants";
import { formatOrgDate } from "@/lib/time";
import { changeUserRole } from "@/server/actions/settings";

import { InviteUserDialog } from "./invite-user-dialog";

export type TeamMember = {
  id: string;
  full_name: string;
  email: string;
  role: Role;
  created_at: string;
};

export function TeamTable({ users, currentUserId }: { users: TeamMember[]; currentUserId: string }) {
  const { timezone } = useOrgSettings();

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-4">
        <div className="space-y-1.5">
          <CardTitle>Team</CardTitle>
          <CardDescription>
            Invite sales reps and managers. Invited users set their password from the email link.
          </CardDescription>
        </div>
        <InviteUserDialog />
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Joined</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user) => (
              <TableRow key={user.id} data-testid={`team-row-${user.email}`}>
                <TableCell className="font-medium">
                  {user.full_name || user.email}
                  {user.id === currentUserId && (
                    <span className="ml-1 text-muted-foreground">(you)</span>
                  )}
                </TableCell>
                <TableCell>{user.email}</TableCell>
                <TableCell>
                  <RoleSelect
                    key={`${user.id}:${user.role}`}
                    user={user}
                    isSelf={user.id === currentUserId}
                  />
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {formatOrgDate(user.created_at, timezone)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function RoleSelect({ user, isSelf }: { user: TeamMember; isSelf: boolean }) {
  const router = useRouter();
  const [role, setRole] = useState<Role>(user.role);
  const [pending, startTransition] = useTransition();

  const onValueChange = (value: string) => {
    const next = ROLES.find((r) => r === value);
    if (!next || next === role) return;
    const previous = role;
    setRole(next);
    startTransition(async () => {
      const result = await changeUserRole({ userId: user.id, role: next });
      if (!result.ok) {
        setRole(previous);
        toast.error(result.error);
        return;
      }
      toast.success(`${user.full_name || user.email} is now ${ROLE_LABELS[result.data.role]}.`);
      // A manager who demoted themselves can no longer see Settings.
      if (isSelf && result.data.role !== "manager") router.push("/dashboard");
      else router.refresh();
    });
  };

  return (
    <Select value={role} onValueChange={onValueChange} disabled={pending}>
      <SelectTrigger size="sm" className="w-40" aria-label={`Role for ${user.full_name || user.email}`}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ROLE_OPTIONS.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
