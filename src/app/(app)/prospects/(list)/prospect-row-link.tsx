"use client";

import { useRouter } from "next/navigation";

import { TableRow } from "@/components/ui/table";

/**
 * A table row that opens `href` on click (mouse convenience). Keyboard and
 * screen-reader users use the real link in the name cell; clicks on links,
 * buttons or while selecting text are left alone. Cmd/Ctrl-click → new tab.
 */
export function ProspectRowLink({ href, children }: { href: string; children: React.ReactNode }) {
  const router = useRouter();

  const onClick = (event: React.MouseEvent<HTMLTableRowElement>) => {
    if (event.defaultPrevented || event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest("a, button, input, select, textarea, [role='button']")) return;
    if (window.getSelection()?.toString()) return;
    if (event.metaKey || event.ctrlKey) {
      window.open(href, "_blank", "noopener");
      return;
    }
    router.push(href);
  };

  return (
    <TableRow className="cursor-pointer" onClick={onClick} data-href={href}>
      {children}
    </TableRow>
  );
}
