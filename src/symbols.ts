import { createElement, CircleHelp } from "lucide";
import { getEmojiGlyph, getIconNode } from "./catalogue";

export function renderSymbol(id: string): SVGElement | HTMLSpanElement {
  const glyph = getEmojiGlyph(id);
  if (glyph) {
    const node = document.createElement("span");
    node.className = "emoji-symbol emoji";
    node.setAttribute("aria-hidden", "true");
    node.textContent = glyph;
    return node;
  }
  return createElement(getIconNode(id) ?? CircleHelp, {
    width: 28,
    height: 28,
    "aria-hidden": "true",
    "stroke-width": 2,
  });
}
