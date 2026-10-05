import Link from "next/link";

import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/** Titled page section (dashboard, reports); `id` names the region for assistive tech and tests. */
export function SectionCard({
  id,
  title,
  description,
  action,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  action?: { href: string; label: string };
  children: React.ReactNode;
}) {
  return (
    <Card aria-labelledby={`${id}-title`} role="region" data-section={id} className="min-w-0 gap-4">
      <CardHeader>
        <CardTitle id={`${id}-title`} className="text-base">
          <h2>{title}</h2>
        </CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
        {action && (
          <CardAction>
            <Link href={action.href} className="text-sm font-medium text-primary underline-offset-4 hover:underline">
              {action.label}
            </Link>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="min-w-0">{children}</CardContent>
    </Card>
  );
}

/** Muted empty state inside a section. */
export function SectionEmpty({ icon, title, body }: { icon: React.ReactNode; title: string; body?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-8 text-center">
      <div className="flex size-9 items-center justify-center rounded-full bg-muted text-muted-foreground [&_svg]:size-4">
        {icon}
      </div>
      <p className="text-sm font-medium">{title}</p>
      {body && <p className="max-w-xs text-xs text-muted-foreground">{body}</p>}
    </div>
  );
}
