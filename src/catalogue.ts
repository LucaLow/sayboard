import { icons, type IconNode } from "lucide";
import emojiData from "./catalogue-data.json" with { type: "json" };

export type SymbolEntry = {
  id: string;
  label: string;
  kind: "icon" | "emoji";
  keywords: string[];
};

function words(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function iconId(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
}

const vocabulary: Record<string, string[]> = {
  check: ["yes", "okay", "ok", "agree", "all done", "finished"],
  x: ["no", "refuse", "disagree"],
  hand: ["stop", "wait", "pause"],
  "circle-help": ["help", "support", "question", "need help"],
  plus: ["more", "again", "add"],
  minus: ["less", "do not want", "dont want", "refuse"],
  heart: ["love", "like", "want", "care", "hurt", "pain"],
  smile: ["happy", "glad", "good", "excited", "feeling"],
  frown: ["sad", "upset", "unhappy", "feeling"],
  angry: ["angry", "mad", "frustrated", "feeling"],
  "cup-soda": ["drink", "thirsty", "juice", "soda"],
  "glass-water": ["water", "drink", "thirsty"],
  utensils: ["eat", "food", "hungry", "meal", "lunch", "dinner"],
  toilet: ["toilet", "bathroom", "potty", "pee", "poo"],
  bed: ["break", "rest", "sleep", "tired", "nap"],
  house: ["home", "house", "family"],
  users: ["together", "friends", "family", "people"],
  play: ["play", "start", "game"],
  music: ["music", "song", "sing", "dance"],
  "book-open": ["book", "read", "story"],
  "arrow-right": ["go", "next", "forward"],
  ear: ["listen", "hear", "sound"],
  "message-circle": ["talk", "say", "something else", "tell", "comment"],
  accessibility: ["access", "accessible", "wheelchair", "disabled"],
};

const iconNodes = new Map<string, IconNode>();
const iconEntries: SymbolEntry[] = Object.entries(icons).flatMap(
  ([name, node]) => {
    const id = iconId(name);
    if (iconNodes.has(id)) return [];
    iconNodes.set(id, node);
    return [
      {
        id,
        label: id.replaceAll("-", " "),
        kind: "icon",
        keywords: vocabulary[id] ?? [],
      } satisfies SymbolEntry,
    ];
  },
);
const aliases = {
  home: icons.House,
  volume: icons.Volume2,
  back: icons.ArrowLeft,
};
for (const [id, node] of Object.entries(aliases)) {
  if (!iconNodes.has(id))
    iconEntries.push({
      id,
      label: id,
      kind: "icon",
      keywords: vocabulary[id === "home" ? "house" : id] ?? [],
    });
  iconNodes.set(id, node);
}

const emojiEntries: SymbolEntry[] = emojiData.map(
  ({ id, label, keywords }) => ({
    id,
    label,
    keywords,
    kind: "emoji",
  }),
);
export const catalogue: SymbolEntry[] = [...iconEntries, ...emojiEntries];
const byId = new Map(catalogue.map((entry) => [entry.id, entry]));
const glyphs = new Map(emojiData.map((entry) => [entry.id, entry.glyph]));
type SearchEntry = {
  entry: SymbolEntry;
  label: string;
  terms: string;
  keywords: string[];
  communication: string[];
  labelWords?: string[];
  termWords?: string[];
};
function createSearchIndex(): SearchEntry[] {
  return catalogue.map((entry) => {
    const label = words(entry.label);
    return {
      entry,
      label,
      terms: words([entry.label, ...entry.keywords].join(" ")),
      keywords: entry.keywords.map(words),
      communication: (vocabulary[entry.id] ?? []).map(words),
    };
  });
}
const searchIndex = createSearchIndex();

export function isSymbolId(value: unknown): value is string {
  return typeof value === "string" && byId.has(value);
}
export function getIconNode(id: string): IconNode | undefined {
  return iconNodes.get(id);
}
export function getEmojiGlyph(id: string): string | undefined {
  return glyphs.get(id);
}

/** All data stays local. Labels and keyword text are normalised once at startup. */
export function searchSymbols(
  query: string,
  kind: "all" | "icon" | "emoji" = "all",
  limit = 60,
): SymbolEntry[] {
  return matchingSymbols(query, kind, limit, true);
}

function matchingSymbols(
  query: string,
  kind: "all" | "icon" | "emoji",
  limit: number,
  allowPrefix: boolean,
): SymbolEntry[] {
  if (!Number.isFinite(limit) || limit <= 0) return [];
  const trimmed = query.trim();
  if (!trimmed)
    return catalogue
      .filter((entry) => kind === "all" || entry.kind === kind)
      .slice(0, Math.floor(limit));
  const needle = words(query);
  const tokens = needle.split(" ").filter(Boolean);
  // The six relevance tiers retain catalogue order within each score. Compute
  // each match's score once instead of repeating it in a sort comparator.
  const ranked: SymbolEntry[][] = Array.from({ length: 6 }, () => []);
  for (const match of searchIndex) {
    const { entry } = match;
    if (kind !== "all" && entry.kind !== kind) continue;
    const terms = (match.termWords ??= match.terms.split(" "));
    if (
      glyphs.get(entry.id) !== trimmed &&
      (!tokens.length ||
        !tokens.every((token) =>
          terms.some(
            (term) =>
              term === token ||
              (allowPrefix && token.length >= 2 && term.startsWith(token)),
          ),
        ))
    )
      continue;
    const tier = !needle
      ? 5
      : match.label === needle
        ? 0
        : match.communication.includes(needle)
          ? 1
          : match.keywords.includes(needle)
            ? 2
            : tokens.every((token) =>
                  (match.labelWords ??= match.label.split(" ")).includes(token),
                )
              ? 3
              : tokens.every((token) => terms.includes(token))
                ? 4
                : 5;
    ranked[tier].push(entry);
  }
  return ranked.flat().slice(0, Math.floor(limit));
}

const filler = new Set([
  "i",
  "me",
  "my",
  "we",
  "the",
  "a",
  "an",
  "to",
  "some",
  "please",
  "am",
  "is",
  "are",
  "want",
  "need",
  "can",
  "you",
  "it",
  "im",
  "have",
]);
const suggestionRules: [string[], string[]][] = [
  [
    ["dont want", "do not want", "don t want"],
    ["minus", "x", "hand"],
  ],
  [
    ["all done", "finished"],
    ["check", "circle-check"],
  ],
  [
    ["hurt", "hurts", "pain", "sick"],
    ["heart", "stethoscope", "thermometer"],
  ],
];

/** Return suggestions only; callers retain the caregiver's explicit selection. */
export function suggestSymbols(text: string, limit = 6): SymbolEntry[] {
  if (!Number.isFinite(limit) || limit <= 0 || !text.trim()) return [];
  const normal = words(text);
  if (!normal) return matchingSymbols(text, "all", limit, false);
  const maximum = Math.floor(limit);
  const selected = new Map<string, SymbolEntry>();
  const add = (entry: SymbolEntry | undefined) => {
    if (entry) selected.set(entry.id, entry);
  };
  for (const [phrases, ids] of suggestionRules) {
    if (phrases.some((phrase) => ` ${normal} `.includes(` ${phrase} `)))
      ids.forEach((id) => add(byId.get(id)));
  }
  const tokens = normal.split(" ").filter((token) => !filler.has(token));
  for (const token of tokens) {
    // Curated communication vocabulary gets priority over incidental substring matches.
    for (const [id, synonyms] of Object.entries(vocabulary)) {
      if (synonyms.includes(token)) add(byId.get(id));
    }
  }
  if (selected.size >= maximum) return [...selected.values()].slice(0, maximum);
  matchingSymbols(normal, "all", limit, false).forEach(add);
  // Later matches only append new entries. Once the visible prefix is full,
  // further scans cannot change it. A single-word phrase was searched above.
  for (const token of new Set(tokens)) {
    if (selected.size >= maximum) break;
    if (token === normal) continue;
    matchingSymbols(token, "all", limit, false).forEach(add);
  }
  if (!selected.size && normal.split(" ").includes("want"))
    add(byId.get("heart"));
  return [...selected.values()].slice(0, maximum);
}
