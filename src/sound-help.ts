import { showDismissibleModal } from "./modal";

/** Manual troubleshooting only. Browsers do not expose the phone's silent switch. */
export function createSoundHelp(): HTMLButtonElement {
  const help = document.createElement("button");
  help.type = "button";
  help.className = "button quiet sound-help";
  help.textContent = "No sound?";
  help.setAttribute("aria-haspopup", "dialog");
  help.onclick = () => {
    help.focus({ preventScroll: true });
    const dialog = document.createElement("dialog");
    dialog.className = "tile-dialog sound-help-dialog";
    const title = document.createElement("h2");
    title.id = "sound-help-title";
    title.textContent = "No sound?";
    const guidance = document.createElement("ul");
    guidance.id = "sound-help-guidance";
    for (const text of [
      "Turn off Silent Mode.",
      "Turn up the media volume.",
      "Check Bluetooth/headphones.",
    ]) {
      const item = document.createElement("li");
      item.textContent = text;
      guidance.append(item);
    }
    dialog.setAttribute("aria-labelledby", title.id);
    dialog.setAttribute("aria-describedby", guidance.id);
    const actions = document.createElement("div");
    actions.className = "dialog-actions";
    const close = document.createElement("button");
    close.type = "button";
    close.className = "button";
    close.textContent = "Close";
    close.onclick = () => dialog.close();
    actions.append(close);
    dialog.append(title, guidance, actions);
    // Some browsers consume Escape to leave native fullscreen before dispatching
    // a dialog cancel event. Close this help too when that happens.
    const nativeFullscreen = document.fullscreenElement;
    const fullscreenChanged = () => {
      if (nativeFullscreen && document.fullscreenElement !== nativeFullscreen)
        dialog.close();
    };
    document.addEventListener("fullscreenchange", fullscreenChanged);
    showDismissibleModal(dialog, {
      onClosed: () =>
        document.removeEventListener("fullscreenchange", fullscreenChanged),
    });
    close.focus();
  };
  return help;
}
