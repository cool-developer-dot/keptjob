/**
 * Pipeline (Kanban) URL state: search `q` + `owner` (managers only). Pure and
 * client-safe; every key is parsed independently, invalid → default.
 */
import { z } from "zod";

import { SEARCH_MAX_LENGTH } from "@/lib/validation/prospect-list";

export const PIPELINE_PATH = "/pipeline";

export type PipelineParams = {
  q: string;
  owner: string | null;
};

export const DEFAULT_PIPELINE_PARAMS: PipelineParams = { q: "", owner: null };

type RawValue = string | string[] | undefined | null;
export type RawPipelineSearchParams = Record<string, RawValue> | URLSearchParams;

const searchSchema = z
  .string()
  .transform((value) => value.replace(/\s+/g, " ").trim().slice(0, SEARCH_MAX_LENGTH).trim())
  .catch("");
const ownerSchema = z.uuid().nullable().catch(null);

function first(params: RawPipelineSearchParams, key: string): string | null {
  const value = params instanceof URLSearchParams ? params.get(key) : params[key];
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/** Parses URL search params; unknown/invalid values → defaults (never throws). */
export function parsePipelineParams(params: RawPipelineSearchParams): PipelineParams {
  return {
    q: searchSchema.parse(first(params, "q") ?? ""),
    owner: ownerSchema.parse(first(params, "owner")),
  };
}

export function hasActivePipelineFilters(params: PipelineParams): boolean {
  return Boolean(params.q || params.owner);
}

/** `/pipeline?…` with `overrides` applied (non-default values only). */
export function pipelineHref(params: PipelineParams, overrides: Partial<PipelineParams> = {}): string {
  const next = { ...params, ...overrides };
  const out = new URLSearchParams();
  if (next.q) out.set("q", next.q);
  if (next.owner) out.set("owner", next.owner);
  const query = out.toString();
  return query ? `${PIPELINE_PATH}?${query}` : PIPELINE_PATH;
}
