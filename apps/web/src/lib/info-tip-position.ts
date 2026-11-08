interface Rect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export function infoTipPosition({
  anchor,
  boundary,
  viewportWidth,
  viewportHeight,
  height,
  align,
  mobileSheet = true,
  preferredWidth = 320,
}: {
  anchor: Rect;
  boundary?: Rect;
  viewportWidth: number;
  viewportHeight: number;
  height: number;
  align: "center" | "end";
  mobileSheet?: boolean;
  preferredWidth?: number;
}) {
  const mobile = mobileSheet && viewportWidth < 640;
  const leftEdge = Math.max(12, mobile ? 12 : (boundary?.left ?? 0) + 12);
  const rightEdge = Math.min(
    viewportWidth - 12,
    mobile ? viewportWidth - 12 : (boundary?.right ?? viewportWidth) - 12,
  );
  const topEdge = Math.max(12, mobile ? 12 : (boundary?.top ?? 0) + 12);
  const bottomEdge = Math.min(
    viewportHeight - 12,
    mobile ? viewportHeight - 12 : (boundary?.bottom ?? viewportHeight) - 12,
  );
  const width = Math.max(
    0,
    Math.min(mobile ? viewportWidth - 24 : preferredWidth, rightEdge - leftEdge),
  );
  const preferredLeft =
    align === "end" ? anchor.right - width : (anchor.left + anchor.right - width) / 2;
  const left = mobile ? 12 : Math.max(leftEdge, Math.min(preferredLeft, rightEdge - width));
  const anchorTop = Math.max(topEdge, Math.min(anchor.top, bottomEdge));
  const anchorBottom = Math.max(topEdge, Math.min(anchor.bottom, bottomEdge));
  const below = Math.max(0, bottomEdge - anchorBottom - 8);
  const aboveSpace = Math.max(0, anchorTop - topEdge - 8);
  const above = !mobile && height > below && aboveSpace > below;
  const maxHeight = mobile ? viewportHeight - 24 : above ? aboveSpace : below;
  const visibleHeight = Math.min(height, maxHeight);
  const top = mobile
    ? viewportHeight - 12 - visibleHeight
    : above
      ? anchorTop - 8 - visibleHeight
      : anchorBottom + 8;
  const arrowLeft = Math.max(12, Math.min((anchor.left + anchor.right) / 2 - left - 6, width - 24));
  return { left, top, width, maxHeight, arrowLeft, above, mobile };
}
