/**
 * AI insight limits (SPEC §10). The rate limit is enforced on the DB clock by
 * public.ai_insight_recent_count() / record_ai_insight() (migration
 * 20261009120000_ai_insights.sql) — keep these numbers in sync with the SQL.
 */
export const AI_RATE_LIMIT = 10;
export const AI_RATE_WINDOW_MINUTES = 10;

/** Overall deadline for one insight request (including the SDK's retry). */
export const AI_TIMEOUT_MS = 30_000;
/** SDK retries for transient errors (connection, 408/409/429/5xx). */
export const AI_MAX_RETRIES = 1;

/** Number of most recent activities sent to the model. */
export const AI_CONTEXT_ACTIVITY_LIMIT = 30;

/** Name of the structured-output JSON schema sent to the Responses API. */
export const AI_SCHEMA_NAME = "prospect_insight";

/** Model recorded for insights produced by the dev/test fake client. */
export const FAKE_AI_MODEL = "fake-ai";
