import {
  accountClient,
  AccountError,
  disabledAccountMessage,
  type AccountBoard,
} from "./account";
import { type Board } from "./board";
export function createAccountPanel({
  working,
  applyBoard,
  confirm,
}: {
  working: Board;
  applyBoard: (board: Board) => void;
  confirm: (message: string) => Promise<boolean>;
}) {
  const section = document.createElement("section");
  section.className = "settings account-panel";
  const title = document.createElement("h2");
  title.textContent = "Account backup";
  const description = document.createElement("p");
  description.textContent =
    "Your board stays on this device. Sign in to an existing account, then choose when to save a copy or load one. Signing in does not upload words.";
  const content = document.createElement("div");
  const notice = document.createElement("p");
  notice.className = "notice";
  notice.role = "status";
  section.append(title, description, content, notice);
  let busy = false;
  let latest: AccountBoard | null = null;
  function action(label: string, run: () => Promise<void>) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "button";
    button.textContent = label;
    button.onclick = () => void perform(run);
    return button;
  }
  async function perform(run: () => Promise<void>) {
    if (busy) return;
    busy = true;
    section
      .querySelectorAll<HTMLInputElement | HTMLButtonElement>("input,button")
      .forEach((el) => (el.disabled = true));
    notice.textContent = "Working…";
    notice.classList.remove("error");
    try {
      await run();
    } catch (error) {
      notice.textContent =
        error instanceof Error
          ? error.message
          : "Account request failed. Your local board is unchanged.";
      notice.classList.add("error");
      if (
        section.isConnected &&
        error instanceof AccountError &&
        error.status === 409
      ) {
        latest = await accountClient.loadBoard().catch(() => null);
        if (latest)
          notice.textContent += ` Latest account revision: ${latest.revision}. Choose Load account board to review it, or Save draft to account to explicitly replace it.`;
      }
    } finally {
      busy = false;
      if (section.isConnected) renderContent();
    }
  }
  function renderContent() {
    content.replaceChildren();
    if (accountClient.currentAvailability()?.state !== "enabled") {
      content.append(
        action("Check account availability", () => initialize(true)),
      );
      return;
    }
    const session = accountClient.currentSession();
    if (!session) {
      const form = document.createElement("form");
      form.className = "account-login";
      function field(text: string, type: string, autocomplete: string) {
        const label = document.createElement("label");
        label.textContent = text;
        const input = document.createElement("input");
        input.type = type;
        input.setAttribute("autocomplete", autocomplete);
        input.required = true;
        label.append(input);
        form.append(label);
        return input;
      }
      const username = field("Account username", "text", "username");
      const password = field(
        "Account password",
        "password",
        "current-password",
      );
      const login = document.createElement("button");
      login.className = "button";
      login.type = "submit";
      login.textContent = "Sign in";
      form.append(login);
      form.onsubmit = (event) => {
        event.preventDefault();
        const enteredPassword = password.value;
        const enteredUsername = username.value.trim();
        password.value = "";
        void perform(async () => {
          await accountClient.login(enteredUsername, enteredPassword);
          latest = null;
          notice.textContent = "Signed in. No board was uploaded.";
        });
      };
      content.append(
        form,
        action("Check existing session", async () => {
          await accountClient.restoreSession();
          notice.textContent = accountClient.currentSession()
            ? "Session restored. No board was uploaded."
            : "You are signed out.";
        }),
      );
      return;
    }
    const signedIn = document.createElement("p");
    signedIn.textContent = `Signed in as ${session.account.username}. Account copies are separate from the local board.`;
    const actions = document.createElement("div");
    actions.className = "editor-toolbar";
    actions.append(
      action("Load account board", async () => {
        latest = await accountClient.loadBoard();
        if (!section.isConnected) return;
        if (!latest.board) {
          notice.textContent =
            "This account has no saved board. Your local board is unchanged.";
          return;
        }
        if (
          (await confirm(
            `Load account revision ${latest.revision} into the caregiver draft? This replaces this draft. Save board applies it on this device.`,
          )) &&
          section.isConnected
        )
          applyBoard(structuredClone(latest.board));
        else
          notice.textContent =
            "Account load cancelled. Your local board is unchanged.";
      }),
      action("Save draft to account", async () => {
        latest = await accountClient.loadBoard();
        if (!section.isConnected) return;
        const copy = structuredClone(working);
        if (
          !(await confirm(
            latest.board
              ? `Replace account revision ${latest.revision} with this caregiver draft? This uploads the words and spoken phrases to your account.`
              : "Save this caregiver draft to your account? This uploads the words and spoken phrases to your account.",
          ))
        ) {
          notice.textContent =
            "Account save cancelled. No words were uploaded.";
          return;
        }
        if (!section.isConnected) return;
        latest = await accountClient.saveBoard(copy, latest.revision);
        notice.textContent = `Account copy saved at revision ${latest.revision}. Save board separately to apply the draft on this device.`;
      }),
      action("Sign out", async () => {
        await accountClient.logout();
        latest = null;
        notice.textContent =
          "Signed out. The board on this device is unchanged.";
      }),
    );
    content.append(signedIn, actions);
  }
  async function initialize(refresh = false) {
    const availability = await accountClient.checkAvailability({ refresh });
    if (availability.state === "disabled") {
      latest = null;
      notice.textContent = disabledAccountMessage;
      return;
    }
    if (!accountClient.currentSession()) await accountClient.restoreSession();
    notice.textContent = accountClient.currentSession()
      ? "Session restored. No board was uploaded."
      : "You are signed out. Sign in to an existing account to use account backup.";
  }
  renderContent();
  void perform(() => initialize());
  return section;
}
