import {
  compactPhoneLayout,
  isDeviceTileSize,
  type DeviceLayout,
} from "./compact-layout";
import { isGridColumns } from "./device-layout";

/** A draft-only control. Its caller owns Save, discard and local persistence. */
export function createDeviceLayoutControls({
  layout,
  onChange,
}: {
  layout: DeviceLayout;
  onChange: (next: DeviceLayout) => void;
}): HTMLElement {
  let working = { ...layout };
  const section = document.createElement("section");
  section.className = "device-layout-settings";
  const title = document.createElement("h2");
  title.textContent = "Display on this device";
  const sizeLabel = document.createElement("label");
  sizeLabel.textContent = "Tile size on this device";
  const size = document.createElement("select");
  size.append(
    new Option("Use board size", ""),
    new Option("Small", "small"),
    new Option("Standard", "standard"),
    new Option("Large", "large"),
    new Option("Extra large", "extra-large"),
  );
  sizeLabel.append(size);
  const columnsLabel = document.createElement("label");
  columnsLabel.textContent = "Board columns on this device";
  const columns = document.createElement("select");
  for (const count of [1, 2, 3, 4, 5])
    columns.append(
      new Option(
        `${count} ${count === 1 ? "column" : "columns"}`,
        String(count),
      ),
    );
  columnsLabel.append(columns);
  const preset = document.createElement("button");
  preset.type = "button";
  preset.className = "button";
  preset.textContent = "Compact phone preset";
  const explanation = document.createElement("p");
  explanation.textContent =
    "The phone preset uses 2 columns and Small tiles, aiming to show at least six words in portrait. All words remain available by scrolling. Long labels and short screens may show fewer rows.";
  const preview = document.createElement("div");
  preview.className = "layout-preview";
  preview.setAttribute("aria-label", "Numbered layout preview");
  for (let slot = 1; slot <= 10; slot++) {
    const position = document.createElement("span");
    position.textContent = String(slot);
    preview.append(position);
  }
  const note = document.createElement("p");
  note.textContent =
    "Preview shows slots 1–10. Save to apply. Changing columns changes which row each slot occupies. Columns stay fixed when the screen rotates or resizes. These display preferences stay on this device and do not change account copies or exported words.";
  const feedback = document.createElement("p");
  feedback.role = "status";
  feedback.setAttribute("aria-live", "polite");

  function update(next: DeviceLayout) {
    working = { ...next };
    size.value = next.size ?? "";
    columns.value = String(next.columns);
    preview.style.setProperty("--board-columns", String(next.columns));
  }
  size.onchange = () => {
    if (size.value === "" || isDeviceTileSize(size.value)) {
      update({ ...working, size: size.value === "" ? null : size.value });
      onChange({ ...working });
      feedback.textContent =
        "Device tile size changed in the draft. Save to apply.";
    }
  };
  columns.onchange = () => {
    const next = Number(columns.value);
    if (isGridColumns(next)) {
      update({ ...working, columns: next });
      onChange({ ...working });
      feedback.textContent =
        "Device columns changed in the draft. Save to apply.";
    }
  };
  preset.onclick = () => {
    update(compactPhoneLayout());
    onChange({ ...working });
    feedback.textContent =
      "Compact phone preset selected in the draft: 2 columns and Small tiles. Save to apply.";
  };
  update(working);
  section.append(
    title,
    sizeLabel,
    columnsLabel,
    preset,
    explanation,
    preview,
    note,
    feedback,
  );
  return section;
}
