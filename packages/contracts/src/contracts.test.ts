import { describe, expect, it } from "vitest";
import {
  DIRECTIVE_TYPES,
  HARD_CONSTRAINT_CODES,
  NON_WAIVABLE_HARD_CONSTRAINTS,
  SOFT_CONSTRAINT_CODES,
  WEEKDAYS,
} from "./index";

describe("@ordiq/contracts", () => {
  it("exports the complete Section 6 constraint and directive catalogues", () => {
    expect(HARD_CONSTRAINT_CODES).toHaveLength(15);
    expect(NON_WAIVABLE_HARD_CONSTRAINTS).toEqual(["HC-01", "HC-02", "HC-03"]);
    expect(SOFT_CONSTRAINT_CODES).toHaveLength(16);
    expect(DIRECTIVE_TYPES).toHaveLength(8);
    expect(WEEKDAYS).toContain("MONDAY");
  });
});
