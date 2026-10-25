import { createElement as el, createButton as button } from "./dom";
import { renderSymbol } from "./symbols";
import { accountClient, AccountError } from "./account";
import { teacherClient, ClassroomError } from "./classroom-client";
import {
  id,
  type Classroom,
  type ClassroomDetail,
  type ProfileDetail,
} from "./classroom-contract";
import { serializeBoard } from "./board";
import "./style.css";
import "./teacher.css";
import {
  canInvite,
  createInvitationsPanel,
  showActivation,
} from "./teacher-invitations";

const root = document.querySelector<HTMLDivElement>("#teacher-app");
if (!root) throw new Error("Missing teacher workspace");
let signedIn = false;
let serviceDisabled = false;
let operator = false;
let busy = false;
let rooms: Classroom[] = [];
let room: ClassroomDetail | null = null;
let profile: ProfileDetail | null = null;
let notice = "Checking the classroom service…";
let errorNotice = false;
let pairing: { code: string; expiresAt: number } | null = null;
const fieldValues = new Map<string, string>();
let deviceStatusContainer: HTMLElement | null = null;
let refreshingDevices = false;

function lastContact(timestamp: number | null) {
  if (timestamp === null) return "No contact reported yet";
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 10) return "Last contact just now";
  if (seconds < 60) return `Last contact ${seconds} seconds ago`;
  return `Last contact ${new Date(timestamp).toLocaleString()}`;
}
function renderDevices(container: HTMLElement, current: ProfileDetail) {
  container.replaceChildren();
  const count = root?.querySelector("[data-device-count]");
  if (count)
    count.textContent = current.devices.length
      ? `${current.devices.length} linked device${current.devices.length === 1 ? "" : "s"}`
      : "No devices linked yet";
  const summary = el("p", "teacher-muted teacher-device-summary");
  summary.textContent = current.devices.length
    ? "Device reports refresh automatically. Updates wait while a learner is speaking, typing or using caregiver controls."
    : "No devices linked yet. Pair a learner’s device once to start automatic updates.";
  container.append(summary);
  for (const device of current.devices) {
    const row = el("div", "teacher-row teacher-device-row");
    const details = el("div", "teacher-device-details");
    const recent =
      device.lastSeenAt !== null && Date.now() - device.lastSeenAt < 30_000;
    const applied =
      current.publishedVersion > 0 &&
      device.appliedVersion === current.publishedVersion;
    const state =
      device.expiresAt <= Date.now()
        ? "Link expired. Pair this device again."
        : applied
          ? `Version ${device.appliedVersion} saved${recent ? " · Up to date" : ""}`
          : current.publishedVersion
            ? `Waiting for version ${current.publishedVersion}${device.appliedVersion ? ` · Version ${device.appliedVersion} saved` : ""}`
            : "Waiting for the first publication";
    details.append(
      el("strong", "", device.name),
      el(
        "span",
        `teacher-device-state${applied && recent ? " current" : ""}`,
        state,
      ),
      el(
        "span",
        "teacher-muted",
        `${lastContact(device.lastSeenAt)}${device.lastSeenAt !== null && !recent ? " · No recent contact" : ""}`,
      ),
    );
    row.append(
      details,
      action("Revoke " + device.name, async () => {
        if (
          !(await confirm(
            `Stop future updates to ${device.name}? Its saved board stays available.`,
          ))
        )
          return;
        await teacherClient.revoke(current.id, device.id);
        await refreshProfile();
        notice = "Device access revoked. Its saved board remains available.";
      }),
    );
    container.append(row);
  }
}
async function refreshDeviceReports() {
  const current = profile;
  const container = deviceStatusContainer;
  if (
    !signedIn ||
    !current ||
    !container ||
    busy ||
    refreshingDevices ||
    document.visibilityState !== "visible"
  )
    return;
  // Updating only the receipt list preserves form values, focus, and a live pairing code.
  if (
    container.contains(document.activeElement) ||
    document.querySelector("dialog[open]")
  )
    return;
  refreshingDevices = true;
  try {
    const latest = await teacherClient.profile(current.id);
    if (
      !signedIn ||
      profile?.id !== current.id ||
      container !== deviceStatusContainer ||
      busy ||
      container.contains(document.activeElement) ||
      document.querySelector("dialog[open]")
    )
      return;
    profile = { ...profile, devices: latest.devices };
    renderDevices(container, latest);
  } catch (error) {
    if (profile?.id !== current.id || container !== deviceStatusContainer)
      return;
    if (
      (error instanceof ClassroomError || error instanceof AccountError) &&
      [401, 403].includes(error.status)
    ) {
      clearPrivateView();
      notice =
        "Your teacher session ended. Sign in again to see device reports.";
      errorNotice = true;
      render();
    } else {
      const summary = container.querySelector(".teacher-device-summary");
      if (summary)
        summary.textContent =
          "Device reports could not refresh. The reports below show the last known state. Saved learner boards remain available.";
    }
  } finally {
    refreshingDevices = false;
  }
}

function link(label: string, href: string, className = "button") {
  const a = el("a", className, label);
  a.href = href;
  return a;
}
async function confirm(message: string): Promise<boolean> {
  const dialog = el("dialog", "teacher-dialog");
  const heading = el("h2", "", "Confirm classroom change");
  heading.id = "teacher-confirmation";
  dialog.setAttribute("aria-labelledby", heading.id);
  let approved = false;
  dialog.append(
    heading,
    el("p", "", message),
    button("Cancel", () => dialog.close()),
    button(
      "Confirm",
      () => {
        approved = true;
        dialog.close();
      },
      "button primary",
    ),
  );
  document.body.append(dialog);
  return new Promise((resolve) => {
    dialog.onclose = () => {
      dialog.remove();
      resolve(approved);
    };
    dialog.showModal();
  });
}
function action(label: string, run: () => Promise<void>, primary = false) {
  return button(
    label,
    () => void perform(run),
    primary ? "button primary" : "button",
  );
}
async function perform(run: () => Promise<void>) {
  if (busy) return;
  busy = true;
  root
    ?.querySelectorAll<HTMLInputElement | HTMLButtonElement>("input,button")
    .forEach((control) => (control.disabled = true));
  try {
    await run();
    errorNotice = false;
  } catch (error) {
    notice =
      error instanceof Error ? error.message : "The classroom request failed.";
    errorNotice = true;
    if (
      (error instanceof ClassroomError || error instanceof AccountError) &&
      [401, 403].includes(error.status)
    )
      clearPrivateView();
  } finally {
    busy = false;
    render();
  }
}
function clearPrivateView() {
  signedIn = false;
  operator = false;
  rooms = [];
  room = null;
  profile = null;
  pairing = null;
  fieldValues.clear();
  history.replaceState(null, "", location.pathname);
}
function rememberLocation() {
  history.replaceState(
    null,
    "",
    location.pathname +
      (room ? `#${room.id}${profile ? "/" + profile.id : ""}` : ""),
  );
}
function form(
  key: string,
  labelText: string,
  submitText: string,
  run: (value: string) => Promise<void>,
) {
  const form = el("form", "teacher-form");
  const label = el("label", "", labelText);
  const input = el("input");
  input.required = true;
  input.maxLength = key === "device" ? 60 : 100;
  input.value = fieldValues.get(key) ?? "";
  input.oninput = () => fieldValues.set(key, input.value);
  label.append(input);
  const submit = el("button", "button primary", submitText);
  submit.type = "submit";
  form.append(label, submit);
  form.onsubmit = (event) => {
    event.preventDefault();
    const value = input.value.trim();
    if (!value) return;
    void perform(async () => {
      await run(value);
      fieldValues.delete(key);
    });
  };
  return form;
}
async function loadRoom(value: Classroom) {
  room = await teacherClient.classroom(value.id);
  profile = null;
  pairing = null;
  rememberLocation();
  notice = "Choose a profile or add one below.";
}
async function refreshProfile() {
  if (!profile || !room) return;
  profile = await teacherClient.profile(profile.id);
  room = await teacherClient.classroom(room.id);
  pairing = null;
}
function exportProfile(value: ProfileDetail) {
  const url = URL.createObjectURL(
    new Blob([serializeBoard(value.board)], { type: "application/json" }),
  );
  const a = link("", url);
  a.download = `sayboard-${value.id}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function render() {
  if (!root) return;
  deviceStatusContainer = null;
  root.replaceChildren();
  const shell = el("main", "teacher-shell");
  const header = el("header", "teacher-header");
  const brand = el("div", "brand");
  brand.append(renderSymbol("message-circle"), el("span", "", "sayboard"));
  const navigation = el("nav", "teacher-actions");
  navigation.setAttribute("aria-label", "Teacher navigation");
  navigation.append(link("Open communication board", "/"));
  // Clearing a rejected private view must not remove the only way to end a
  // server session that survived a failed logout.
  if (signedIn || accountClient.currentSession())
    navigation.append(
      el(
        "span",
        "teacher-user",
        accountClient.currentSession()?.account.username ?? "",
      ),
      action("Sign out", async () => {
        await accountClient.logout();
        clearPrivateView();
        notice = "Signed out.";
      }),
    );
  header.append(brand, navigation);
  shell.append(header);
  const status = el(
    "p",
    `teacher-status${errorNotice ? " error" : ""}`,
    notice,
  );
  status.role = "status";
  status.setAttribute("aria-live", "polite");
  shell.append(el("p", "teacher-eyebrow", "TEACHER WORKSPACE"));
  if (!signedIn) {
    shell.append(
      el("h1", "", "A familiar board for every learner."),
      el(
        "p",
        "teacher-intro",
        "Prepare a board, link each learner’s device once, then publish updates from here. Linked devices update automatically and keep their saved board when disconnected.",
      ),
    );
    const card = el("section", "teacher-card teacher-login");
    card.append(
      el("h2", "", "Teacher sign in"),
      el(
        "p",
        "",
        "The teacher pilot is invite-only. Open your invitation to choose a password, or sign in with your existing account.",
      ),
    );
    const login = el("form", "teacher-form");
    const usernameLabel = el("label", "", "Teacher username");
    const username = el("input");
    username.autocomplete = "username";
    username.required = true;
    username.maxLength = 64;
    username.autocapitalize = "none";
    username.spellcheck = false;
    username.value = fieldValues.get("login-username") ?? "";
    usernameLabel.append(username);
    const passwordLabel = el("label", "", "Password");
    const password = el("input");
    password.type = "password";
    password.autocomplete = "current-password";
    password.required = true;
    passwordLabel.append(password);
    const submit = el("button", "button primary", "Sign in");
    submit.type = "submit";
    login.append(usernameLabel, passwordLabel, submit);
    login.onsubmit = (event) => {
      event.preventDefault();
      const secret = password.value;
      const name = username.value.trim();
      password.value = "";
      void perform(async () => {
        await accountClient.login(name, secret);
        clearPrivateView();
        rooms = await teacherClient.list();
        operator = await canInvite();
        signedIn = true;
        notice = "Signed in. Choose a classroom or create your first one.";
      });
    };
    card.append(
      ...(serviceDisabled ? [] : [login]),
      el(
        "p",
        "teacher-muted",
        "Need a password reset? Contact your Sayboard administrator. Student accounts and email addresses are not required.",
      ),
    );
    shell.append(card, status);
  } else if (!room) {
    shell.append(
      el("h1", "", "Your classrooms"),
      el(
        "p",
        "teacher-intro",
        "Keep each learner’s draft, published versions and linked devices together.",
      ),
      status,
    );
    const grid = el("div", "teacher-grid");
    for (const value of rooms) {
      const card = el("section", "teacher-card");
      card.append(
        el("h2", "", value.name),
        action("Open " + value.name, () => loadRoom(value), true),
      );
      grid.append(card);
    }
    if (!rooms.length)
      grid.append(
        el(
          "p",
          "teacher-empty",
          "Start with a demonstration classroom. You can prepare and test boards before linking a learner’s device.",
        ),
      );
    const create = el("section", "teacher-card");
    create.append(
      el("h2", "", "Create a classroom"),
      form("classroom", "Classroom name", "Create classroom", async (name) => {
        const created = await teacherClient.create(name);
        rooms = await teacherClient.list();
        await loadRoom(created);
      }),
    );
    grid.append(create);
    shell.append(grid);
    if (!rooms.length) {
      const guide = el("ol", "teacher-start-guide");
      for (const step of [
        "Create a classroom and add a learner alias.",
        "Edit and preview the learner’s board.",
        "Publish a version when it is ready.",
        "Link a learner’s device once. Future publications arrive automatically.",
      ])
        guide.append(el("li", "", step));
      shell.append(
        el("h2", "teacher-guide-heading", "Your first classroom, step by step"),
        guide,
      );
    }
    if (operator) shell.append(createInvitationsPanel());
  } else if (!profile) {
    const current = room;
    shell.append(
      action("All classrooms", async () => {
        rooms = await teacherClient.list();
        room = null;
        pairing = null;
        rememberLocation();
        notice = "Your classrooms are up to date.";
      }),
      el("h1", "", current.name),
      el(
        "p",
        "teacher-intro",
        "Use classroom aliases for profiles. Avoid full student names or other unnecessary personal information.",
      ),
      status,
    );
    const grid = el("div", "teacher-grid");
    for (const value of current.profiles) {
      const card = el("section", "teacher-card");
      card.append(
        el("h2", "", value.label),
        el(
          "p",
          "teacher-muted",
          value.publishedVersion
            ? `Published version ${value.publishedVersion}`
            : "Draft only. Not yet published.",
        ),
        action(
          "Manage " + value.label,
          async () => {
            profile = await teacherClient.profile(value.id);
            pairing = null;
            rememberLocation();
            notice = "Edit the draft, then publish when it is ready.";
          },
          true,
        ),
      );
      grid.append(card);
    }
    const add = el("section", "teacher-card");
    add.append(
      el("h2", "", "Add a learner profile"),
      el(
        "p",
        "",
        "Each profile starts with the starter board. Edit it or import an existing Sayboard file.",
      ),
      form("profile", "Profile alias", "Add profile", async (label) => {
        profile = await teacherClient.addProfile(current.id, label);
        room = await teacherClient.classroom(current.id);
        rememberLocation();
        notice =
          "Profile created. Its board is a private draft until published.";
      }),
    );
    grid.append(add);
    shell.append(grid);
    const remove = el("section", "teacher-danger");
    remove.append(
      action("Delete classroom", async () => {
        if (
          !(await confirm(
            `Permanently delete ${current.name}, all its profiles, saved versions and device links? Working device boards remain on their devices. Export any boards you need first.`,
          ))
        )
          return;
        await teacherClient.removeClassroom(current.id);
        rooms = await teacherClient.list();
        room = null;
        rememberLocation();
        notice = "Classroom deleted.";
      }),
    );
    shell.append(remove);
  } else {
    const current = profile;
    const classroom = room;
    shell.append(
      action("Back to " + classroom.name, () => loadRoom(classroom)),
      el("h1", "", current.label),
      el(
        "p",
        "teacher-intro",
        "A board that grows with your learner. Edit the draft, preview it, then publish when you’re ready.",
      ),
      status,
    );
    const progress = el("ol", "teacher-progress");
    progress.setAttribute("aria-label", "Board setup");
    for (const [title, detail] of [
      ["1. Prepare", `Draft revision ${current.revision}`],
      [
        "2. Publish",
        current.publishedVersion
          ? `Version ${current.publishedVersion} available`
          : "Not published yet",
      ],
      [
        "3. Connect",
        current.devices.length
          ? `${current.devices.length} linked device${current.devices.length === 1 ? "" : "s"}`
          : "No devices linked yet",
      ],
    ]) {
      const step = el("li");
      const description = el("span", "", detail);
      if (title === "3. Connect") description.dataset.deviceCount = "";
      step.append(el("strong", "", title), description);
      progress.append(step);
    }
    shell.append(progress);
    const grid = el("div", "teacher-profile-grid");
    const draft = el("section", "teacher-card teacher-draft");
    const homeTiles = current.board.tiles.filter(Boolean).length;
    draft.append(
      el("p", "teacher-eyebrow", "DRAFT"),
      el("h2", "", "Prepare the board"),
      el(
        "p",
        "",
        `${homeTiles} home ${homeTiles === 1 ? "tile" : "tiles"} · ${current.board.subBoards.length} ${current.board.subBoards.length === 1 ? "category" : "categories"} · Draft revision ${current.revision}`,
      ),
    );
    const actions = el("div", "teacher-actions");
    const editor = `/?teacherBoard=${current.id}&classroom=${classroom.id}`;
    actions.append(
      link("Edit board", editor, "button primary"),
      link("Preview board", editor + "&preview=1"),
      button("Export draft", () => exportProfile(current)),
    );
    const boardPreview = el("div", "teacher-board-preview");
    boardPreview.setAttribute("aria-label", "Saved draft vocabulary preview");
    for (const tile of current.board.tiles.slice(0, 10)) {
      const previewTile = el(
        "div",
        tile
          ? `teacher-preview-tile ${tile.tone}`
          : "teacher-preview-tile empty",
      );
      if (tile)
        previewTile.append(renderSymbol(tile.icon), el("span", "", tile.label));
      else previewTile.setAttribute("aria-label", "Empty slot");
      boardPreview.append(previewTile);
    }
    draft.append(boardPreview, actions);
    const duplicate = el("details", "teacher-secondary-tools");
    duplicate.append(
      el("summary", "", "Copy this board for another learner"),
      form(
        "duplicate",
        "New profile alias",
        "Duplicate this board",
        async (label) => {
          profile = await teacherClient.addProfile(
            classroom.id,
            label,
            current.board,
          );
          room = await teacherClient.classroom(classroom.id);
          pairing = null;
          rememberLocation();
          notice =
            "Board copied to a new profile draft. Device links were not copied.";
        },
      ),
    );
    draft.append(duplicate);
    grid.append(draft);
    const publish = el("section", "teacher-card teacher-publication");
    publish.append(
      el("p", "teacher-eyebrow", "PUBLISHED"),
      el(
        "h2",
        "",
        current.publishedVersion
          ? `Version ${current.publishedVersion}`
          : "Ready when you are",
      ),
      el(
        "p",
        "",
        "Publish the saved draft to linked devices. Each learner keeps their current board until they finish speaking or editing.",
      ),
      action(
        "Publish saved draft",
        async () => {
          if (
            !(await confirm(
              `Publish the saved draft for ${current.label}? Linked devices will update automatically after speech, typing and caregiver editing finish.`,
            ))
          )
            return;
          profile = await teacherClient.publish(current.id, current.revision);
          room = await teacherClient.classroom(classroom.id);
          notice = `Version ${profile.publishedVersion} published. Linked devices update automatically. Check their reports below to confirm receipt.`;
        },
        true,
      ),
      action("Refresh saved draft", async () => {
        await refreshProfile();
        notice = "Saved draft refreshed.";
      }),
    );
    grid.append(publish);
    const devices = el("section", "teacher-card teacher-devices");
    devices.append(
      el("h2", "", "Classroom devices"),
      el(
        "p",
        "",
        "Link once. Future board updates arrive automatically, when the learner is ready.",
      ),
    );
    const reports = el("div", "teacher-device-reports");
    deviceStatusContainer = reports;
    renderDevices(reports, current);
    devices.append(reports);
    const setup = el("details", "teacher-device-setup");
    setup.open = !current.devices.length || pairing !== null;
    setup.append(
      el("summary", "", "Link a learner device"),
      el(
        "p",
        "teacher-muted",
        "On the learner’s device, open the address below. Choose Caregiver controls → Edit board and settings → Backup and transfer → Classroom board. Enter the code, choose Link classroom device and confirm the initial connection.",
      ),
      form("device", "Device name", "Create pairing code", async (name) => {
        pairing = await teacherClient.pairing(current.id, name);
        notice =
          "Enter this code on the intended device within ten minutes and confirm the initial connection. Future publications sync automatically. Creating another code replaces this one.";
      }),
    );
    const address = el(
      "label",
      "teacher-link-field",
      "Open this address on the learner’s device",
    );
    const addressInput = el("input");
    addressInput.readOnly = true;
    addressInput.value = location.origin + "/";
    addressInput.onclick = () => addressInput.select();
    address.append(addressInput);
    setup.insertBefore(address, setup.querySelector("form"));
    if (pairing) {
      const panel = el("div", "teacher-pairing");
      panel.append(
        el("p", "", "Single-use pairing code"),
        el("code", "", pairing.code),
        el(
          "p",
          "teacher-muted",
          `Expires ${new Date(pairing.expiresAt).toLocaleTimeString()}. Refreshing this page hides the code.`,
        ),
      );
      setup.append(panel);
      setup.append(
        action("Copy pairing code", async () => {
          if (!pairing) return;
          try {
            await navigator.clipboard.writeText(pairing.code);
            notice = "Pairing code copied. Enter it on the intended device.";
          } catch {
            notice = "Select and copy the code shown above.";
          }
        }),
      );
    }
    devices.append(setup);
    grid.append(devices);
    const versions = el("details", "teacher-card teacher-versions");
    versions.append(
      el("summary", "", "Published versions"),
      el(
        "p",
        "teacher-muted",
        "Restore an earlier version to your draft. Preview and publish it when you’re ready.",
      ),
    );
    if (!current.versions.length)
      versions.append(
        el(
          "p",
          "teacher-muted",
          "Your first published version will appear here.",
        ),
      );
    for (const version of current.versions) {
      const row = el("div", "teacher-row");
      row.append(
        el(
          "span",
          "",
          `Version ${version.number} · ${new Date(version.createdAt).toLocaleString()}`,
        ),
        action("Restore version " + version.number + " to draft", async () => {
          if (
            !(await confirm(
              `Replace the saved draft with version ${version.number}? The currently published version stays unchanged until you publish this draft.`,
            ))
          )
            return;
          profile = await teacherClient.restore(
            current.id,
            current.revision,
            version.number,
          );
          notice = `Version ${version.number} restored into the draft. Preview it before publishing.`;
        }),
      );
      versions.append(row);
    }
    grid.append(versions);
    shell.append(grid);
    const remove = el("section", "teacher-danger");
    remove.append(
      action("Delete profile", async () => {
        if (
          !(await confirm(
            `Permanently delete ${current.label}, its versions and device links? Export the draft first if needed. Device boards stay on their devices.`,
          ))
        )
          return;
        await teacherClient.removeProfile(current.id);
        await loadRoom(classroom);
        notice = "Profile deleted.";
      }),
    );
    shell.append(remove);
  }
  shell.append(
    el(
      "footer",
      "teacher-footer",
      "Boards and published vocabulary are stored on this server. Spoken messages and speech history are not collected. The communication board remains available without a teacher session.",
    ),
  );
  root.append(shell);
  if (busy)
    root
      .querySelectorAll<HTMLInputElement | HTMLButtonElement>("input,button")
      .forEach((control) => (control.disabled = true));
}
setInterval(() => void refreshDeviceReports(), 5000);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") void refreshDeviceReports();
});
// Opening another private link in this tab changes only the fragment. Start a
// fresh activation page rather than leaving the signed-in workspace on screen.
window.addEventListener("hashchange", () => {
  if (new URLSearchParams(location.hash.slice(1)).has("activate"))
    location.reload();
});
const activation = new URLSearchParams(location.hash.slice(1)).get("activate");
if (activation !== null) {
  history.replaceState(null, "", location.pathname);
  void showActivation(root, activation, (username) => {
    fieldValues.set("login-username", username);
    notice = "Password saved. Sign in to open your teacher workspace.";
    render();
  });
} else {
  render();
  void perform(async () => {
    const availability = await accountClient.checkAvailability();
    if (availability.state === "disabled") {
      serviceDisabled = true;
      notice =
        "Classroom hosting is not enabled on this website. Use the address provided by your administrator.";
      return;
    }
    const session = await accountClient.restoreSession();
    if (!session) {
      notice = "Sign in to open your classrooms.";
      return;
    }
    rooms = await teacherClient.list();
    operator = await canInvite();
    signedIn = true;
    const parts = location.hash.slice(1).split("/");
    if (parts[0]) {
      const classroom = rooms.find((value) => value.id === id(parts[0]));
      if (classroom) {
        room = await teacherClient.classroom(classroom.id);
        if (parts[1] && room.profiles.some((p) => p.id === parts[1]))
          profile = await teacherClient.profile(id(parts[1]));
      }
    }
    rememberLocation();
    notice = "Your classroom workspace is up to date.";
  });
}
