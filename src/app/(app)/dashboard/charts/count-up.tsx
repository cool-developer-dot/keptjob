import type { CSSProperties } from "react";

/**
 * Integer that counts up from 0 on load — pure CSS (`@property --num` +
 * `counter()`, see `.count-up` in globals.css), so the server-rendered page
 * already holds the final value and nothing flashes. Decorative: always
 * `aria-hidden`; render the real value beside it for assistive tech and tests.
 * Browsers without `@property` (or reduced motion) show the final value.
 */
export function CountUp({ value, className }: { value: number; className?: string }) {
  const n = Math.max(0, Math.round(value));
  return <span aria-hidden className={["count-up", className].filter(Boolean).join(" ")} style={{ "--to": n } as CSSProperties} />;
}
