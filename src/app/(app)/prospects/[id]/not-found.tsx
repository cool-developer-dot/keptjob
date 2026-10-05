import { SearchXIcon } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";

/** 404 for a prospect that doesn't exist or isn't visible to the user (RLS) — same message for both. */
export default function ProspectNotFound() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 py-16 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <SearchXIcon aria-hidden className="size-6" />
      </div>
      <div className="space-y-1">
        <h1 className="text-base font-semibold">Prospect not found</h1>
        <p className="text-sm text-muted-foreground">
          It may have been deleted, or you don&apos;t have access to it.
        </p>
      </div>
      <Button variant="outline" asChild>
        <Link href="/prospects">Back to prospects</Link>
      </Button>
    </div>
  );
}
