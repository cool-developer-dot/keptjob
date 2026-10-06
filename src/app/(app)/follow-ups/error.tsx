"use client";

import { AlertCircleIcon } from "lucide-react";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";

/** Error boundary for /follow-ups (Next 16.3: `retry` re-fetches the segment). */
export default function FollowUpsError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div
      role="alert"
      className="glass flex flex-col items-center justify-center gap-3 rounded-3xl px-6 py-16 text-center"
    >
      <div className="flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertCircleIcon aria-hidden className="size-6" />
      </div>
      <div className="space-y-1">
        <h2 className="text-base font-semibold">Couldn&apos;t load the follow-ups</h2>
        <p className="text-sm text-muted-foreground">Something went wrong. Please try again.</p>
      </div>
      <Button variant="outline" onClick={() => retry()}>
        Try again
      </Button>
    </div>
  );
}
