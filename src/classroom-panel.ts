import { createElement as el, createButton as button } from "./dom";
import { deviceClient, ClassroomError } from "./classroom-client";
import { type Board } from "./board";
import { type DeviceBoard } from "./classroom-contract";

export function createClassroomPanel({
  applyBoard,
  confirm,
  setPending,
}: {
  applyBoard: (board: Board) => void;
  confirm: (message: string) => Promise<boolean>;
  setPending: (pending: boolean) => void;
}) {
  const section = el("section", "settings account-panel");
  const content = el("div");
  const notice = el(
    "p",
    "notice",
    "Already linked? Check classroom connection to see available versions. To connect a new device, use your teacher’s pairing code. Publishing never automatically replaces this device’s working board.",
  );
  notice.role = "status";
  section.append(el("h2", "", "Classroom board"), content, notice);
  let linked: DeviceBoard | null = null;
  let busy = false;
  async function perform(run: () => Promise<void>) {
    if (busy) return;
    busy = true;
    setPending(true);
    section
      .querySelectorAll<HTMLInputElement | HTMLButtonElement>("input,button")
      .forEach((control) => (control.disabled = true));
    notice.classList.remove("error");
    try {
      await run();
    } catch (error) {
      notice.textContent =
        error instanceof Error
          ? error.message
          : "Could not reach the classroom.";
      notice.classList.add("error");
      if (error instanceof ClassroomError && error.status === 401)
        linked = null;
    } finally {
      busy = false;
      setPending(false);
      if (section.isConnected) render();
    }
  }
  function action(label: string, run: () => Promise<void>) {
    return button(label, () => void perform(run));
  }
  function render() {
    content.replaceChildren();
    const dashboard = el("a", "button", "Teacher dashboard");
    dashboard.href = [
      "https://sayboard.org",
      "https://www.sayboard.org",
      "https://sayboard.vercel.app",
    ].includes(location.origin)
      ? "https://classroom.sayboard.org/teacher.html"
      : "/teacher.html";
    if (!linked) {
      const form = el("form", "account-login");
      const label = el("label", "", "Classroom pairing code");
      const code = el("input");
      code.required = true;
      code.maxLength = 20;
      code.autocomplete = "off";
      code.autocapitalize = "characters";
      label.append(code);
      const pair = el("button", "button", "Link classroom device");
      pair.type = "submit";
      form.append(label, pair);
      form.onsubmit = (event) => {
        event.preventDefault();
        const value = code.value;
        code.value = "";
        void perform(async () => {
          if (
            !(await confirm(
              "Link this browser to the profile assigned by your teacher? Its current board stays unchanged until you load and save a published board.",
            )) ||
            !section.isConnected
          )
            return;
          await deviceClient.pair(value);
          linked = await deviceClient.board();
          notice.textContent =
            "Device linked. Choose Load published board when you are ready.";
        });
      };
      content.append(form);
    } else {
      const current = linked;
      content.append(
        el(
          "p",
          "",
          `Linked to ${current.label}. ${current.version ? `Published version ${current.version} is available.` : "Your teacher has not published a board yet."}`,
        ),
      );
      if (current.board) {
        content.append(
          action("Load published board", async () => {
            notice.textContent = "Checking the latest published board…";
            // The panel may have been open while the teacher published again.
            // Never load its cached snapshot, including after access is revoked.
            const latest = await deviceClient.board();
            linked = latest;
            if (!latest.board) {
              notice.textContent =
                "Your teacher has not published a board yet.";
              return;
            }
            if (
              await confirm(
                `Load version ${latest.version} into this caregiver draft? This replaces this draft. Save board applies it on this device.`,
              )
            ) {
              if (!section.isConnected) return;
              // Confirmation can stay open for minutes. Check access and the
              // version again so only the publication the caregiver approved loads.
              const approved = await deviceClient.board();
              linked = approved;
              if (
                approved.profileId !== latest.profileId ||
                approved.version !== latest.version
              ) {
                notice.textContent =
                  "The published version changed while you were confirming. Your draft is unchanged. Choose Load published board again to review the latest version.";
                return;
              }
              if (section.isConnected && approved.board)
                applyBoard(structuredClone(approved.board));
            }
          }),
        );
        content.append(
          el(
            "p",
            "",
            "Load published board checks for the latest version. Review the draft, then choose Save board to apply it here.",
          ),
        );
      }
      content.append(
        action("Disconnect classroom device", async () => {
          if (
            !(await confirm(
              "Stop future classroom transfers to this browser? The working board stays on this device.",
            ))
          )
            return;
          await deviceClient.unlink(current.csrfToken);
          linked = null;
          notice.textContent = "Disconnected. Your device board is unchanged.";
        }),
      );
    }
    content.append(
      action("Check classroom connection", async () => {
        linked = await deviceClient.board();
        notice.textContent =
          "Connection checked. Loading a published board is a separate choice.";
      }),
      dashboard,
    );
  }
  render();
  // Explicit checks keep the free board free of classroom API requests at startup.
  return section;
}
