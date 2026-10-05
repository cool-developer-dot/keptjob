import "server-only";

import OpenAI from "openai";

import { createFakeAiClient } from "./fake";
import { AI_MAX_RETRIES, AI_TIMEOUT_MS, FAKE_AI_MODEL } from "./limits";
import type { AiClient } from "./types";

type Env = Readonly<Record<string, string | undefined>>;

export type AiClientResult =
  | { ok: true; client: AiClient; model: string; fake: boolean }
  | { ok: false; reason: "not_configured"; missing: ("OPENAI_API_KEY" | "OPENAI_MODEL")[] };

/**
 * The deterministic fake AI client is used ONLY for local dev/tests/e2e:
 * `AI_FAKE=1` AND not a production build (NODE_ENV !== "production") AND not
 * a Vercel production/preview deployment. `next build`/`next start` and every
 * Vercel deployment run with NODE_ENV=production, so the flag can never
 * activate there.
 */
export function isFakeAiEnabled(env: Env = process.env): boolean {
  if (env.AI_FAKE !== "1") return false;
  if (env.NODE_ENV === "production") return false;
  if (env.VERCEL_ENV === "production" || env.VERCEL_ENV === "preview") return false;
  return true;
}

const openAiClients = new Map<string, OpenAI>();

function openAiAdapter(apiKey: string): AiClient {
  let openai = openAiClients.get(apiKey);
  if (!openai) {
    openai = new OpenAI({ apiKey, timeout: AI_TIMEOUT_MS, maxRetries: AI_MAX_RETRIES });
    openAiClients.set(apiKey, openai);
  }
  const sdk = openai;
  return {
    responses: {
      parse: (params, options) => sdk.responses.parse(params, options),
    },
  };
}

/**
 * Factory for the AI client (injectable: data functions accept a replacement
 * via `deps.getAiClient`). Real client: needs OPENAI_API_KEY and OPENAI_MODEL
 * (the model is never hardcoded).
 */
export function getAiClient(env: Env = process.env): AiClientResult {
  if (isFakeAiEnabled(env)) {
    return { ok: true, client: createFakeAiClient(), model: FAKE_AI_MODEL, fake: true };
  }
  const apiKey = env.OPENAI_API_KEY?.trim();
  const model = env.OPENAI_MODEL?.trim();
  const missing: ("OPENAI_API_KEY" | "OPENAI_MODEL")[] = [];
  if (!apiKey) missing.push("OPENAI_API_KEY");
  if (!model) missing.push("OPENAI_MODEL");
  if (!apiKey || !model) return { ok: false, reason: "not_configured", missing };
  return { ok: true, client: openAiAdapter(apiKey), model, fake: false };
}
