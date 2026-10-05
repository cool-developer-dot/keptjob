// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ACTIVITY_TYPES,
  ALLOWED_TIMEZONES,
  DEAL_HEALTH_VALUES,
  DECISION_MAKER_STATUSES,
  FOLLOW_UP_STATUSES,
  LOST_REASONS,
  OBJECTION_CATEGORIES,
  PIPELINE_STAGES,
  ROLES,
  WON_REASONS,
} from "@/lib/constants";

import { Constants } from "./database.types";

// Guards against drift between the SQL schema (supabase/migrations) and
// src/lib/constants.ts. Runs without a database.

describe("generated database enums match src/lib/constants.ts", () => {
  const enums = Constants.public.Enums;

  it.each([
    ["pipeline_stage", enums.pipeline_stage, PIPELINE_STAGES],
    ["decision_maker_status", enums.decision_maker_status, DECISION_MAKER_STATUSES],
    ["objection_category", enums.objection_category, OBJECTION_CATEGORIES],
    ["activity_type", enums.activity_type, ACTIVITY_TYPES],
    ["follow_up_status", enums.follow_up_status, FOLLOW_UP_STATUSES],
    ["deal_health", enums.deal_health, DEAL_HEALTH_VALUES],
    ["user_role", enums.user_role, ROLES],
  ])("%s", (_name, dbValues, tsValues) => {
    expect([...dbValues]).toEqual([...tsValues]);
  });
});

describe("schema CHECK lists match src/lib/constants.ts", () => {
  const sql = readFileSync(
    resolve(process.cwd(), "supabase/migrations/20261005120000_schema.sql"),
    "utf8",
  );

  function quotedList(pattern: RegExp): string[] {
    const match = sql.match(pattern);
    expect(match, `pattern ${pattern} not found in schema migration`).not.toBeNull();
    return [...match![1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  }

  it("closed_won reasons", () => {
    expect(quotedList(/when 'closed_won' then[\s\S]*?close_reason in \(([^)]*)\)/)).toEqual([...WON_REASONS]);
  });

  it("closed_lost reasons", () => {
    expect(quotedList(/when 'closed_lost' then[\s\S]*?close_reason in \(([^)]*)\)/)).toEqual([...LOST_REASONS]);
  });

  it("allowed org timezones", () => {
    expect(quotedList(/timezone in \(([^)]*)\)/)).toEqual([...ALLOWED_TIMEZONES]);
  });
});
