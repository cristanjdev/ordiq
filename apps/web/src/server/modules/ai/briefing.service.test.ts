import { describe, expect, it } from "vitest";
import { buildTermBriefing, generateBriefingSummary, templateSummary } from "./briefing.service";

describe("term briefing", () => {
  it("asks for a schedule when the term has none, and never invents figures", async () => {
    const briefing = buildTermBriefing("AY2099-2100-S1");
    expect(briefing.schedule).toBeNull();
    expect(briefing.stats).toBeNull();
    expect(briefing.items.map((i) => i.id)).toContain("no-schedule");
    expect(templateSummary(briefing)).toMatch(/no schedule/i);

    // Under the test runner no provider is called: the built-in summary is used.
    const summary = await generateBriefingSummary(briefing);
    expect(summary.mode).toBe("offline");
    expect(summary.text).toBe(templateSummary(briefing));
  });

  it("orders urgent items first and keeps a stable fingerprint for the same data", () => {
    const a = buildTermBriefing("AY2099-2100-S1");
    const b = buildTermBriefing("AY2099-2100-S1");
    expect(a.fingerprint).toBe(b.fingerprint);
    const rank = { critical: 0, warning: 1, info: 2, ok: 3 } as const;
    const ranks = a.items.map((i) => rank[i.severity]);
    expect([...ranks].sort((x, y) => x - y)).toEqual(ranks);
  });
});
