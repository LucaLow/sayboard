import {
  catalogue,
  searchSymbols,
  suggestSymbols,
  type SymbolEntry,
} from "./catalogue";
import { renderSymbol } from "./symbols";
const entries = new Map(catalogue.map((entry) => [entry.id, entry]));
export function createSymbolPicker({
  initialId,
  text,
  explicit,
}: {
  initialId: string;
  text: string;
  explicit: boolean;
}) {
  let selected = initialId;
  let hasExplicitChoice = explicit;
  let currentText = text;
  const fieldset = document.createElement("fieldset");
  fieldset.className = "symbol-picker";
  const legend = document.createElement("legend");
  legend.textContent = "Symbol";
  fieldset.append(legend);
  const preview = document.createElement("div");
  preview.className = "symbol-selection";
  preview.setAttribute("aria-live", "polite");
  const auto = document.createElement("button");
  auto.type = "button";
  auto.className = "button compact";
  auto.textContent = "Use text suggestions";
  auto.onclick = () => {
    hasExplicitChoice = false;
    updateSuggestions(currentText);
  };
  const top = document.createElement("div");
  top.className = "symbol-top";
  top.append(preview, auto);
  fieldset.append(top);
  const suggestions = document.createElement("div");
  suggestions.className = "symbol-suggestions";
  suggestions.setAttribute("aria-label", "Suggested symbols");
  suggestions.role = "group";
  fieldset.append(suggestions);
  const filters = document.createElement("div");
  filters.className = "symbol-filters";
  const searchLabel = document.createElement("label");
  searchLabel.textContent = "Search symbols";
  const search = document.createElement("input");
  search.type = "search";
  search.placeholder = "Try water, dog, happy…";
  searchLabel.append(search);
  const kindLabel = document.createElement("label");
  kindLabel.textContent = "Show";
  const kind = document.createElement("select");
  kind.append(
    new Option("Icons and emoji", "all"),
    new Option("Icons", "icon"),
    new Option("Emoji", "emoji"),
  );
  kindLabel.append(kind);
  filters.append(searchLabel, kindLabel);
  const browse = document.createElement("details");
  browse.className = "symbol-browse";
  const browseLabel = document.createElement("summary");
  browseLabel.textContent = "Find another symbol";
  browse.append(browseLabel, filters);
  fieldset.append(browse);
  const count = document.createElement("p");
  count.className = "symbol-count";
  count.role = "status";
  browse.append(count);
  const results = document.createElement("div");
  results.className = "symbol-results";
  results.setAttribute("aria-label", "Symbol search results");
  results.role = "group";
  browse.append(results);
  function navigate(event: KeyboardEvent) {
    const group = event.currentTarget;
    const target = event.target;
    if (
      !(group instanceof HTMLElement) ||
      !(target instanceof HTMLButtonElement)
    )
      return;
    const buttons = Array.from(
      group.querySelectorAll<HTMLButtonElement>("button"),
    );
    const index = buttons.indexOf(target);
    if (index < 0) return;
    const columns =
      getComputedStyle(group).gridTemplateColumns.split(" ").length;
    const step =
      event.key === "ArrowRight"
        ? 1
        : event.key === "ArrowLeft"
          ? -1
          : event.key === "ArrowDown"
            ? columns
            : event.key === "ArrowUp"
              ? -columns
              : 0;
    let destination = index + step;
    if (event.key === "Home") destination = 0;
    else if (event.key === "End") destination = buttons.length - 1;
    else if (!step) return;
    event.preventDefault();
    destination = Math.max(0, Math.min(buttons.length - 1, destination));
    buttons.forEach((button) => (button.tabIndex = -1));
    const next = buttons[destination];
    if (next) {
      next.tabIndex = 0;
      next.focus();
    }
  }
  suggestions.addEventListener("keydown", navigate);
  results.addEventListener("keydown", navigate);
  function refreshSelection() {
    const entry = entries.get(selected);
    preview.replaceChildren(
      renderSymbol(selected),
      document.createTextNode(entry?.label ?? selected),
    );
    auto.setAttribute("aria-pressed", String(!hasExplicitChoice));
    fieldset
      .querySelectorAll<HTMLButtonElement>("[data-symbol-id]")
      .forEach((button) =>
        button.setAttribute(
          "aria-pressed",
          String(button.dataset.symbolId === selected),
        ),
      );
    for (const group of [suggestions, results]) {
      const buttons = Array.from(
        group.querySelectorAll<HTMLButtonElement>("button"),
      );
      const target =
        buttons.find((button) => button.dataset.symbolId === selected) ??
        buttons[0];
      buttons.forEach(
        (button) => (button.tabIndex = button === target ? 0 : -1),
      );
    }
  }
  function choice(entry: SymbolEntry) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "symbol-choice";
    button.dataset.symbolId = entry.id;
    button.setAttribute("aria-label", `Choose ${entry.label} ${entry.kind}`);
    button.title = entry.label;
    button.append(renderSymbol(entry.id));
    const label = document.createElement("span");
    label.textContent = entry.label;
    button.append(label);
    button.onclick = () => {
      selected = entry.id;
      hasExplicitChoice = true;
      refreshSelection();
    };
    return button;
  }
  function renderResults() {
    const filter =
      kind.value === "icon" ? "icon" : kind.value === "emoji" ? "emoji" : "all";
    const found = searchSymbols(search.value, filter, 60);
    results.replaceChildren(...found.map(choice));
    count.textContent = found.length
      ? `${found.length} symbols shown${found.length === 60 ? ". Refine your search to see more. Use arrow keys within results." : "."}`
      : "No matching symbols. Try another word or choose Icons and emoji.";
    refreshSelection();
  }
  function updateSuggestions(nextText: string) {
    currentText = nextText;
    const found = suggestSymbols(nextText, 6);
    if (!hasExplicitChoice) selected = found[0]?.id ?? initialId;
    suggestions.replaceChildren(...found.map(choice));
    refreshSelection();
  }
  search.oninput = renderResults;
  kind.onchange = renderResults;
  updateSuggestions(text);
  renderResults();
  return { element: fieldset, selectedId: () => selected, updateSuggestions };
}
