import { describe, expect, it } from "vitest";
import { infoTipPosition } from "./info-tip-position";

const desktop = {
  viewportWidth: 1440,
  viewportHeight: 900,
  height: 160,
  align: "end" as const,
  boundary: { left: 256, right: 1440, top: 64, bottom: 900 },
};

describe("floating popup positioning", () => {
  it("keeps a title popup out of the sidebar", () => {
    const position = infoTipPosition({
      ...desktop,
      anchor: { left: 470, right: 494, top: 120, bottom: 144 },
    });
    expect(position.left).toBe(268);
    expect(position.left + position.width).toBeLessThanOrEqual(1428);
    expect(position.left + position.arrowLeft).toBeLessThan(494);
  });

  it("keeps right-side card popups within the viewport", () => {
    const position = infoTipPosition({
      ...desktop,
      align: "center",
      anchor: { left: 1390, right: 1414, top: 120, bottom: 144 },
    });
    expect(position.left + position.width).toBe(1428);
  });

  it("opens above a button near the bottom of the content area", () => {
    const position = infoTipPosition({
      ...desktop,
      anchor: { left: 600, right: 624, top: 830, bottom: 854 },
    });
    expect(position.above).toBe(true);
    expect(position.top + desktop.height).toBe(822);
    expect(position.top).toBeGreaterThanOrEqual(76);
  });

  it("fits a mobile info sheet within the screen", () => {
    const position = infoTipPosition({
      viewportWidth: 375,
      viewportHeight: 667,
      height: 900,
      align: "end",
      anchor: { left: 50, right: 74, top: 100, bottom: 124 },
    });
    expect(position).toMatchObject({ mobile: true, left: 12, top: 12, width: 351, maxHeight: 643 });
  });

  it("keeps searchable dropdowns anchored and sized to their control on mobile", () => {
    const position = infoTipPosition({
      viewportWidth: 375,
      viewportHeight: 667,
      height: 300,
      align: "end",
      mobileSheet: false,
      preferredWidth: 500,
      anchor: { left: 24, right: 351, top: 500, bottom: 536 },
    });
    expect(position.mobile).toBe(false);
    expect(position.above).toBe(true);
    expect(position.left).toBe(12);
    expect(position.width).toBe(351);
    expect(position.top + 300).toBe(492);
  });

  it("stays visible when the mobile keyboard reduces the viewport", () => {
    const position = infoTipPosition({ viewportWidth: 375, viewportHeight: 400, height: 300, align: "end",
      mobileSheet: false, anchor: { left: 24, right: 351, top: 500, bottom: 536 } });
    expect(position.top).toBeGreaterThanOrEqual(12);
    expect(position.top + Math.min(300, position.maxHeight)).toBeLessThanOrEqual(388);
  });
});
