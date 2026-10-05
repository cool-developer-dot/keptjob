import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { prospectListHref, type ProspectListParams } from "@/lib/validation/prospect-list";

/** "Showing 26–50 of 60" + Previous / Next links (state in the URL). */
export function ProspectsPagination({
  params,
  page,
  pageCount,
  pageSize,
  total,
  shown,
}: {
  params: ProspectListParams;
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
  shown: number;
}) {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = (page - 1) * pageSize + shown;
  const current = { ...params, page };

  return (
    <nav aria-label="Pagination" className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
      <p className="text-muted-foreground" aria-live="polite">
        Showing {from}–{to} of {total} {total === 1 ? "prospect" : "prospects"}
      </p>
      {pageCount > 1 && (
        <div className="flex items-center gap-2">
          <PageLink href={page > 1 ? prospectListHref(current, { page: page - 1 }) : null} label="Previous">
            <ChevronLeftIcon aria-hidden />
            Previous
          </PageLink>
          <span className="px-1 text-muted-foreground">
            Page {page} of {pageCount}
          </span>
          <PageLink href={page < pageCount ? prospectListHref(current, { page: page + 1 }) : null} label="Next">
            Next
            <ChevronRightIcon aria-hidden />
          </PageLink>
        </div>
      )}
    </nav>
  );
}

function PageLink({ href, label, children }: { href: string | null; label: string; children: React.ReactNode }) {
  if (!href) {
    return (
      <Button variant="outline" size="sm" disabled aria-label={label}>
        {children}
      </Button>
    );
  }
  return (
    <Button variant="outline" size="sm" asChild>
      <Link href={href} aria-label={label}>
        {children}
      </Link>
    </Button>
  );
}
