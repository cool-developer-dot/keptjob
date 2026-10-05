/**
 * Result shape returned by every server action in src/server/actions.
 * Actions never throw for expected failures (validation, RLS, not found);
 * they return { ok: false, error } with a user-presentable message.
 */
export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };
