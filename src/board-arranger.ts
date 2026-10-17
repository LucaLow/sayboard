import { createElement as node, createButton as action } from "./dom";
import { boardPage, type Board } from "./board";
import { renderSymbol } from "./symbols";
import {
  arrangeTile,
  createArrangementCategory,
  type ArrangementResult,
  type ArrangementTarget,
} from "./board-arrangement";

export type ArrangementSession = {
  board: Board;
  selectedId: string | null;
  message: string;
};
export function createBoardArranger({
  session,
  pageId,
  columns,
  size,
  onOpen,
  onSave,
  onCancel,
}: {
  session: ArrangementSession;
  pageId: string | null;
  columns: number;
  size: string;
  onOpen: (id: string) => void;
  onSave: () => string | null;
  onCancel: () => void;
}): HTMLElement {
  const section = node("section", "board-arranger");
  section.setAttribute("aria-label", "Arrange board");
  let dragging: {
    tileId: string;
    pointerId: number;
    x: number;
    y: number;
    started: boolean;
    handle: HTMLButtonElement;
  } | null = null;
  let highlighted: HTMLElement | null = null;
  function clearDrag() {
    if (dragging?.handle.hasPointerCapture(dragging.pointerId))
      dragging.handle.releasePointerCapture(dragging.pointerId);
    dragging = null;
    highlighted?.classList.remove("arrange-drop-active");
    highlighted = null;
    section.classList.remove("arrange-dragging");
  }
  function apply(result: ArrangementResult) {
    if (result.kind === "changed") session.board = result.board;
    session.message = result.message;
    render();
    const chosen = Array.from(
      section.querySelectorAll<HTMLButtonElement>("[data-arrange-tile-id]"),
    ).find((element) => element.dataset.arrangeTileId === session.selectedId);
    (chosen ?? section.querySelector<HTMLElement>(".arrange-feedback"))?.focus({
      preventScroll: true,
    });
  }
  function move(target: ArrangementTarget) {
    if (!session.selectedId) {
      session.message = "Select a word before choosing a destination.";
      render();
      return;
    }
    try {
      apply(
        arrangeTile({
          board: session.board,
          pageId,
          tileId: session.selectedId,
          target,
        }),
      );
    } catch (error) {
      session.message =
        error instanceof Error
          ? error.message
          : "Could not arrange that tile. Your draft is unchanged.";
      render();
    }
  }
  function select(tileId: string) {
    session.selectedId = tileId;
    session.message =
      "Tile selected. Choose a slot or a board below, or drag its handle.";
    render();
    section.querySelector<HTMLSelectElement>(".arrange-position")?.focus();
  }
  section.onkeydown = (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    clearDrag();
    session.selectedId = null;
    session.message = "Move cancelled. Your draft is unchanged.";
    render();
    section
      .querySelector<HTMLButtonElement>(".arrange-save")
      ?.focus({ preventScroll: true });
  };
  function render() {
    const fullscreenScroller = section.closest<HTMLElement>(
      ".communication-fullscreen",
    );
    const scrollY = fullscreenScroller?.scrollTop ?? window.scrollY;
    section.replaceChildren();
    const page = boardPage(session.board, pageId);
    const selected = page.tiles.find((tile) => tile?.id === session.selectedId);
    if (!selected) session.selectedId = null;
    const toolbar = node("div", "arrange-toolbar");
    toolbar.append(node("h1", "", "Arrange board"));
    toolbar.append(
      action(
        "Save arrangement",
        () => {
          const error = onSave();
          if (error) {
            session.message = error;
            render();
          }
        },
        "button primary arrange-save",
      ),
      action("Cancel arrangement", () => {
        clearDrag();
        onCancel();
      }),
    );
    section.append(
      toolbar,
      node(
        "p",
        "subtitle",
        "Caregiver mode. Drag handles to swap slots or move words into categories. Tap a tile for move controls. Touch elsewhere to scroll.",
      ),
    );
    const feedback = node(
      "p",
      "arrange-feedback",
      session.message ||
        "Select a tile for button controls. Categories stay on Home.",
    );
    feedback.tabIndex = -1;
    feedback.role = "status";
    feedback.setAttribute("aria-live", "polite");
    section.append(feedback);
    const controls = node("div", "arrange-actions");
    controls.hidden = !selected;
    const positionLabel = node(
      "label",
      "",
      selected ? `Position for ${selected.label}` : "Select a tile to move",
    );
    const position = node("select", "arrange-position");
    position.setAttribute("aria-label", "Destination slot");
    page.tiles.forEach((tile, index) => {
      const option = node(
        "option",
        "",
        `Slot ${index + 1}: ${tile?.label ?? "empty"}`,
      );
      option.value = String(index);
      option.selected = tile?.id === selected?.id;
      position.append(option);
    });
    position.disabled = !selected;
    positionLabel.append(position);
    const toSlot = action("Move / swap slot", () =>
      move({ kind: "slot", index: Number(position.value) }),
    );
    toSlot.disabled = !selected;
    const destinationLabel = node("label", "", "Move word to board");
    const destination = node("select");
    destination.setAttribute("aria-label", "Destination board");
    const destinations = [
      { id: "", label: "Home" },
      ...session.board.tiles.flatMap((tile) =>
        tile?.kind === "category"
          ? [{ id: tile.subBoardId, label: tile.label }]
          : [],
      ),
    ];
    for (const item of destinations) {
      if (item.id === (pageId ?? "")) continue;
      const option = node("option", "", item.label);
      option.value = item.id;
      destination.append(option);
    }
    destination.disabled =
      selected?.kind !== "word" || destination.options.length === 0;
    destinationLabel.append(destination);
    const toBoard = action("Move to board", () =>
      move({ kind: "page", pageId: destination.value || null }),
    );
    toBoard.disabled = destination.disabled;
    controls.append(positionLabel, toSlot, destinationLabel, toBoard);
    section.append(controls);
    const form = node("form", "arrange-create");
    const nameLabel = node("label", "", "New category on Home");
    const name = node("input");
    name.name = "category-name";
    name.maxLength = 40;
    name.required = true;
    name.setAttribute("aria-label", "New category name");
    nameLabel.append(name);
    const create = node("button", "button", "Create category");
    create.type = "submit";
    form.append(nameLabel, create);
    form.onsubmit = (event) => {
      event.preventDefault();
      try {
        apply(createArrangementCategory(session.board, name.value));
      } catch (error) {
        session.message =
          error instanceof Error
            ? error.message
            : "Could not create category. Your draft is unchanged.";
        render();
      }
      section
        .querySelector<HTMLElement>(".arrange-category-creator summary")
        ?.focus({ preventScroll: true });
    };
    const categoryCreator = node("details", "arrange-category-creator");
    categoryCreator.append(node("summary", "button", "Add category"), form);
    section.append(categoryCreator);
    if (pageId !== null) {
      const home = action(
        "Move selected word to Home",
        () => move({ kind: "page", pageId: null }),
        "button arrange-home-drop",
      );
      home.dataset.dropPage = "";
      home.disabled = selected?.kind === "category";
      section.append(home);
    }
    const viewport = node("div", "board-viewport arrange-viewport");
    viewport.role = "region";
    viewport.setAttribute(
      "aria-label",
      "Arrange tiles, scroll to reach all slots",
    );
    viewport.tabIndex = 0;
    const grid = node("div", "grid arrange-grid");
    grid.dataset.size = size;
    grid.style.setProperty("--board-columns", String(columns));
    page.tiles.forEach((tile, index) => {
      const slot = node(
        "div",
        `arrange-slot ${tile ? tile.tone : "empty-slot"}`,
      );
      slot.dataset.dropSlot = String(index);
      if (!tile) {
        slot.append(
          action(
            `Empty slot ${index + 1}`,
            () => move({ kind: "slot", index }),
            "button arrange-empty",
          ),
        );
      } else {
        const selectButton = action(
          "",
          () => select(tile.id),
          "tile arrange-select",
        );
        selectButton.dataset.arrangeTileId = tile.id;
        selectButton.setAttribute(
          "aria-label",
          `Select ${tile.label}, slot ${index + 1}`,
        );
        selectButton.setAttribute(
          "aria-pressed",
          String(tile.id === session.selectedId),
        );
        selectButton.append(
          renderSymbol(tile.icon),
          node("span", "", tile.label),
          node("span", "arrange-slot-number", `Slot ${index + 1}`),
        );
        const handle = action(
          "Drag",
          () => select(tile.id),
          "button arrange-handle",
        );
        handle.setAttribute(
          "aria-label",
          `Drag ${tile.label}. Or activate to use move controls`,
        );
        handle.onpointerdown = (event) => {
          if (event.button !== 0 || !event.isPrimary) return;
          event.preventDefault();
          clearDrag();
          // Pointer capture does not move focus. Keep Escape inside this section.
          handle.focus({ preventScroll: true });
          dragging = {
            tileId: tile.id,
            pointerId: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            started: false,
            handle,
          };
          handle.setPointerCapture(event.pointerId);
        };
        handle.onpointermove = (event) => {
          if (!dragging || event.pointerId !== dragging.pointerId) return;
          if (
            !dragging.started &&
            Math.hypot(event.clientX - dragging.x, event.clientY - dragging.y) <
              8
          )
            return;
          dragging.started = true;
          section.classList.add("arrange-dragging");
          highlighted?.classList.remove("arrange-drop-active");
          const hit = document
            .elementFromPoint(event.clientX, event.clientY)
            ?.closest<HTMLElement>("[data-drop-page], [data-drop-slot]");
          highlighted = hit && section.contains(hit) ? hit : null;
          highlighted?.classList.add("arrange-drop-active");
          const targetPage = highlighted?.dataset.dropPage;
          feedback.textContent = highlighted
            ? targetPage !== undefined
              ? `Release to move ${tile.label} into ${targetPage === "" ? "Home" : (session.board.tiles.find((item) => item?.kind === "category" && item.subBoardId === targetPage)?.label ?? "category")}.`
              : `Release to move or swap ${tile.label} with slot ${Number(highlighted.dataset.dropSlot) + 1}.`
            : "No drop target. Release here to cancel, or press Escape.";
          const scrollContainer =
            section.closest<HTMLElement>(".communication-fullscreen") ?? window;
          if (event.clientY > innerHeight - 60) scrollContainer.scrollBy(0, 14);
          else if (event.clientY < 110) scrollContainer.scrollBy(0, -14);
          const bounds = viewport.getBoundingClientRect();
          if (event.clientX > bounds.right - 35) viewport.scrollLeft += 14;
          else if (event.clientX < bounds.left + 35) viewport.scrollLeft -= 14;
        };
        handle.onpointerup = (event) => {
          if (!dragging || event.pointerId !== dragging.pointerId) return;
          const dragged = dragging;
          const target = highlighted;
          clearDrag();
          session.selectedId = dragged.tileId;
          if (!dragged.started) {
            select(dragged.tileId);
            return;
          }
          if (target?.dataset.dropPage !== undefined)
            move({ kind: "page", pageId: target.dataset.dropPage || null });
          else if (target?.dataset.dropSlot !== undefined)
            move({ kind: "slot", index: Number(target.dataset.dropSlot) });
          else {
            session.message = "Move cancelled. Your draft is unchanged.";
            render();
          }
        };
        handle.onlostpointercapture = (event) => {
          if (dragging?.pointerId !== event.pointerId) return;
          clearDrag();
          session.message = "Move cancelled. Your draft is unchanged.";
          render();
        };
        handle.onpointercancel = () => {
          clearDrag();
          session.message = "Move cancelled. Your draft is unchanged.";
          render();
        };
        slot.append(selectButton, handle);
        if (tile.kind === "category") {
          const into = action(
            `Move into ${tile.label}`,
            () => move({ kind: "page", pageId: tile.subBoardId }),
            "button arrange-category-drop",
          );
          into.dataset.dropPage = tile.subBoardId;
          slot.append(
            into,
            action(
              `Open ${tile.label} category`,
              () => {
                clearDrag();
                session.selectedId = null;
                onOpen(tile.subBoardId);
              },
              "button arrange-open",
            ),
          );
        }
      }
      grid.append(slot);
    });
    viewport.append(grid);
    section.append(viewport);
    (fullscreenScroller ?? window).scrollTo({
      top: scrollY,
      behavior: "instant",
    });
  }
  render();
  return section;
}
