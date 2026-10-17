/** Native dialogs retain their focus trap and prevent backdrop clicks reaching the board. */
export function showDismissibleModal(
  dialog: HTMLDialogElement,
  {
    onDismiss = () => dialog.close(),
    onClosed = () => {},
  }: {
    onDismiss?: () => void;
    onClosed?: () => void;
  } = {},
) {
  const opener = document.activeElement;
  const outside = (event: PointerEvent | MouseEvent) => {
    const bounds = dialog.getBoundingClientRect();
    return (
      event.target === dialog &&
      (event.clientX < bounds.left ||
        event.clientX > bounds.right ||
        event.clientY < bounds.top ||
        event.clientY > bounds.bottom)
    );
  };
  let startedOutside = false;
  dialog.addEventListener("pointerdown", (event) => {
    startedOutside = outside(event);
  });
  dialog.addEventListener("click", (event) => {
    if (startedOutside && outside(event)) onDismiss();
    startedOutside = false;
  });
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    onDismiss();
  });
  dialog.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    const controls = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        "button, input, select, textarea, summary, a[href], [tabindex]",
      ),
    ).filter(
      (node) =>
        node.tabIndex >= 0 &&
        !node.matches(":disabled") &&
        node.getClientRects().length > 0,
    );
    const first = controls[0];
    const last = controls.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  dialog.addEventListener(
    "close",
    () => {
      dialog.remove();
      if (!document.querySelector("dialog[open]"))
        document.documentElement.classList.remove("modal-open");
      onClosed();
      // A close handler may open another dialog or replace the board's controls.
      if (
        opener instanceof HTMLElement &&
        opener.isConnected &&
        !document.querySelector("dialog[open]")
      )
        opener.focus({ preventScroll: true });
    },
    { once: true },
  );
  document.body.append(dialog);
  dialog.showModal();
  document.documentElement.classList.add("modal-open");
}
