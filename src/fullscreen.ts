/** Ephemeral presentation only: never changes the board, columns, theme or storage. */
export function createFullscreen(root: HTMLElement) {
  const doc = root.ownerDocument;
  let mode: "off" | "immersive" | "native" = "off";
  let generation = 0;
  let confirming = false;
  let message = "";
  let returnFocus: HTMLElement | null = null;
  let requestPending = false;

  function refresh() {
    const active = mode !== "off";
    root.classList.toggle("communication-fullscreen", active);
    doc.documentElement.classList.toggle("communication-fullscreen-page", active);
    root.querySelectorAll<HTMLElement>("[data-fullscreen-chrome]").forEach((node) => {
      node.hidden = active;
      node.inert = active;
    });
    root.querySelectorAll<HTMLElement>(".fullscreen-controls").forEach((node) => {
      node.hidden = !active;
      const prompt = node.querySelector<HTMLElement>(".fullscreen-confirm");
      if (prompt) prompt.hidden = !confirming;
      const exit = node.querySelector<HTMLButtonElement>(".fullscreen-exit");
      if (exit) {
        exit.hidden = confirming;
        exit.setAttribute("aria-expanded", String(confirming));
      }
      const feedback = node.querySelector<HTMLElement>(".fullscreen-feedback");
      if (feedback) feedback.textContent = message;
    });
    root.querySelectorAll<HTMLButtonElement>(".fullscreen-entry").forEach((node) => {
      node.setAttribute("aria-pressed", String(active));
      node.disabled = requestPending;
    });
  }

  function restoreFocus() {
    const target = returnFocus?.isConnected ? returnFocus : root.querySelector<HTMLElement>(".fullscreen-entry");
    target?.focus({ preventScroll: true });
    returnFocus = null;
  }

  function isActive() {
    return mode !== "off";
  }

  function restore() {
    mode = "off";
    generation++;
    confirming = false;
    message = "";
    refresh();
    if (!requestPending) restoreFocus();
  }

  async function exit() {
    const operation = ++generation;
    if (doc.fullscreenElement === root) {
      try {
        await doc.exitFullscreen();
      } catch {
        if (operation !== generation) return;
        message = "The browser could not exit fullscreen. Try again or use Escape or your browser's fullscreen control.";
        refresh();
        return;
      }
    }
    if (operation === generation) restore();
  }

  async function enter(trigger: HTMLElement) {
    if (mode !== "off" || requestPending) return;
    returnFocus = trigger;
    const request = ++generation;
    mode = "immersive";
    confirming = false;
    message = "Board view. Browser controls may remain visible. Use Exit fullscreen to leave.";
    refresh();
    root.querySelector<HTMLElement>(".fullscreen-exit")?.focus({ preventScroll: true });
    // Called directly from the click handler to retain the browser's user activation.
    if (!doc.fullscreenEnabled || typeof root.requestFullscreen !== "function") return;
    requestPending = true;
    refresh();
    try {
      await root.requestFullscreen();
      if (request !== generation) {
        if (doc.fullscreenElement === root) await doc.exitFullscreen();
        return;
      }
      if (doc.fullscreenElement === root) {
        mode = "native";
        message = "Fullscreen board. Use Exit fullscreen or Escape to leave.";
        refresh();
      }
    } catch {
      // A denied native request keeps the usable in-page fallback.
      if (request === generation) refresh();
    } finally {
      requestPending = false;
      refresh();
      if (!isActive()) restoreFocus();
    }
  }

  function fullscreenChanged() {
    if (doc.fullscreenElement === root) {
      if (mode === "off") {
        void doc.exitFullscreen().catch(() => {
          mode = "native";
          refresh();
        });
      } else {
        mode = "native";
        message = "Fullscreen board. Use Exit fullscreen or Escape to leave.";
        refresh();
      }
    } else if (mode === "native") restore();
  }

  function keydown(event: KeyboardEvent) {
    if (event.key !== "Escape" || mode === "off") return;
    // A speech-details dialog owns its Escape while open.
    if (doc.querySelector("dialog[open]")) return;
    event.preventDefault();
    void exit();
  }
  doc.addEventListener("fullscreenchange", fullscreenChanged);
  doc.addEventListener("keydown", keydown);

  function makeButton(label: string, action: () => void, className = "") {
    const node = doc.createElement("button");
    node.type = "button";
    node.className = `button ${className}`;
    node.textContent = label;
    node.onclick = action;
    return node;
  }

  function createEntryButton() {
    const entry = makeButton("Fullscreen", () => { void enter(entry); }, "fullscreen-entry");
    entry.setAttribute("aria-label", "Enter fullscreen communication board");
    entry.setAttribute("aria-pressed", "false");
    return entry;
  }

  function createControls() {
    const controls = doc.createElement("div");
    controls.className = "fullscreen-controls";
    controls.hidden = mode === "off";
    const exitButton = makeButton("Exit fullscreen", () => {
      confirming = true;
      refresh();
      keep.focus({ preventScroll: true });
    }, "fullscreen-exit quiet");
    exitButton.setAttribute("aria-expanded", "false");
    const confirm = doc.createElement("div");
    confirm.className = "fullscreen-confirm";
    confirm.hidden = true;
    confirm.setAttribute("role", "group");
    confirm.setAttribute("aria-label", "Leave fullscreen board?");
    const keep = makeButton("Keep communicating", () => {
      confirming = false;
      refresh();
      exitButton.focus({ preventScroll: true });
    });
    confirm.append(keep, makeButton("Leave fullscreen", () => { void exit(); }, "primary"));
    const feedback = doc.createElement("p");
    feedback.className = "fullscreen-feedback sr-only";
    feedback.setAttribute("role", "status");
    controls.append(exitButton, confirm, feedback);
    return controls;
  }

  return {
    createEntryButton,
    createControls,
    refresh,
    exit,
    destroy() {
      doc.removeEventListener("fullscreenchange", fullscreenChanged);
      doc.removeEventListener("keydown", keydown);
      void exit();
    },
  };
}
