import { describe, expect, it } from "vitest";

import { DECISION_MAKER_STATUSES } from "@/lib/constants";

import { shouldSuggestDecisionMaker } from "./suggestions";

describe("shouldSuggestDecisionMaker", () => {
  it("suggests only a known status that differs from the prospect's", () => {
    const suggested = DECISION_MAKER_STATUSES.flatMap((ai) =>
      DECISION_MAKER_STATUSES.filter((p) => shouldSuggestDecisionMaker(ai, p)).map((p) => `${ai}<-${p}`),
    );
    expect(suggested.sort()).toEqual(["no<-unknown", "no<-yes", "yes<-no", "yes<-unknown"]);
  });
});
