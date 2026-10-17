import { ClassroomError, deviceClient } from "./classroom-client";
import {
  id,
  integer,
  record,
  type DeviceBoard,
  type DeviceSync,
} from "./classroom-contract";

export const classroomLinkKey = "sayboard-classroom-link";
type Link = { profileId: string; version: number };
export type SyncState =
  | { kind: "unlinked" }
  | {
      kind: "linked";
      label: string;
      version: number;
      publishedVersion: number;
      status: "checking" | "current" | "waiting" | "offline" | "storage-error";
    };
type Client = Pick<typeof deviceClient, "sync" | "board" | "applied">;
function parseLink(raw: string | null): Link | null {
  if (!raw) return null;
  try {
    const value = record(JSON.parse(raw));
    return { profileId: id(value.profileId), version: integer(value.version) };
  } catch {
    return null;
  }
}

/** One owner downloads, durably applies and acknowledges teacher publications. */
export function createClassroomSync({
  storage,
  serverHint,
  canApply,
  hasStoredBoard,
  apply,
  onState,
  client = deviceClient,
}: {
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  serverHint: boolean;
  hasStoredBoard: boolean;
  canApply: () => boolean;
  apply: (publication: DeviceBoard) => boolean;
  onState: (state: SyncState) => void;
  client?: Client;
}) {
  let link: Link | null = null;
  try {
    link = parseLink(storage.getItem(classroomLinkKey));
  } catch {
    /* Storage failures never prevent communication. */
  }
  if (link && !hasStoredBoard) link = { ...link, version: 0 };
  let enabled = serverHint || link !== null;
  let generation = 0;
  let active = false;
  let stopped = false;
  let rerun = false;
  let label = "your classroom";
  let publishedVersion = link?.version ?? 0;
  let acknowledged: string | null = null;
  let pending: DeviceBoard | null = null;
  let state: SyncState = enabled
    ? {
        kind: "linked",
        label,
        version: link?.version ?? 0,
        publishedVersion,
        status: "checking",
      }
    : { kind: "unlinked" };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<(state: SyncState) => void>();
  function publish(status: Extract<SyncState, { kind: "linked" }>["status"]) {
    state = {
      kind: "linked",
      label,
      version: link?.version ?? 0,
      publishedVersion,
      status,
    };
    onState(state);
    listeners.forEach((listener) => listener(state));
  }
  function unlink() {
    enabled = false;
    generation++;
    link = null;
    acknowledged = null;
    pending = null;
    clearTimeout(timer);
    try {
      storage.removeItem(classroomLinkKey);
    } catch {
      /* Keep the working board. */
    }
    document.cookie = "sayboard_classroom=; Path=/; Max-Age=0; SameSite=Strict";
    state = { kind: "unlinked" };
    onState(state);
    listeners.forEach((listener) => listener(state));
  }
  function writeLink(next: Link) {
    storage.setItem(classroomLinkKey, JSON.stringify(next));
    link = next;
  }
  function schedule(
    delay = document.visibilityState === "hidden" ? 15000 : 3000,
  ) {
    clearTimeout(timer);
    if (enabled && !stopped) timer = setTimeout(() => void check(), delay);
  }
  async function check() {
    if (!enabled || stopped || active) return;
    active = true;
    clearTimeout(timer);
    timer = undefined;
    let nextDelay: number | undefined;
    const currentGeneration = generation;
    const valid = () => enabled && !stopped && currentGeneration === generation;
    try {
      const remote = await client.sync();
      let csrf = remote.csrfToken;
      if (!valid()) return;
      label = remote.label;
      publishedVersion = remote.version;
      if (link?.profileId !== remote.profileId) {
        writeLink({ profileId: remote.profileId, version: 0 });
        acknowledged = null;
        pending = null;
      }
      if (remote.version === 0) {
        publish("waiting");
        return;
      }
      if (link?.version !== remote.version) {
        const candidate =
          pending?.profileId === remote.profileId &&
          pending.version === remote.version
            ? pending
            : await client.board();
        if (!valid()) return;
        if (
          candidate.profileId !== remote.profileId ||
          candidate.version < remote.version ||
          !candidate.board
        )
          throw new Error("Invalid publication");
        pending = candidate;
        publishedVersion = candidate.version;
        if (!canApply()) {
          publish("waiting");
          return;
        }
        // Revalidate after the download: the teacher may have published again,
        // or revoked this browser while its response was in flight.
        const latest = await client.sync();
        if (!valid()) return;
        if (
          latest.profileId !== candidate.profileId ||
          latest.version !== candidate.version
        ) {
          publishedVersion = latest.version;
          publish("waiting");
          nextDelay = 100;
          return;
        }
        csrf = latest.csrfToken;
        if (!canApply()) {
          publish("waiting");
          return;
        }
        if (!apply(candidate)) {
          publish("storage-error");
          return;
        }
        // The board is saved before its version marker. A partial storage write
        // retries the same immutable publication and never sends a false receipt.
        writeLink({
          profileId: candidate.profileId,
          version: candidate.version,
        });
        pending = null;
      }
      if (!valid() || !link) return;
      const receipt = `${link.profileId}/${link.version}`;
      if (acknowledged !== receipt) {
        await client.applied(link.version, csrf);
        if (!valid()) return;
        acknowledged = receipt;
      }
      publish("current");
    } catch (error) {
      if (!valid()) return;
      if (error instanceof ClassroomError && [401, 404].includes(error.status))
        unlink();
      else
        publish(
          error instanceof DOMException && error.name === "QuotaExceededError"
            ? "storage-error"
            : "offline",
        );
    } finally {
      active = false;
      // A re-pair during a request invalidates it and schedules the new binding.
      if (enabled && !stopped) schedule(rerun ? 0 : nextDelay);
      rerun = false;
    }
  }
  function connect(remote: DeviceSync) {
    enabled = true;
    generation++;
    label = remote.label;
    publishedVersion = remote.version;
    try {
      writeLink({ profileId: remote.profileId, version: 0 });
    } catch {
      link = { profileId: remote.profileId, version: 0 };
    }
    acknowledged = null;
    pending = null;
    publish("waiting");
    if (active) rerun = true;
    else schedule(0);
  }
  const resume = () => {
    if (enabled) {
      if (active) {
        rerun = true;
        return;
      }
      clearTimeout(timer);
      timer = undefined;
      void check();
    }
  };
  const changed = (event: StorageEvent) => {
    if (event.key !== classroomLinkKey) return;
    const next = parseLink(event.newValue);
    if (!next) {
      unlink();
      return;
    }
    link = { ...next, version: 0 };
    enabled = true;
    generation++;
    acknowledged = null;
    resume();
  };
  window.addEventListener("online", resume);
  window.addEventListener("focus", resume);
  window.addEventListener("storage", changed);
  document.addEventListener("visibilitychange", resume);
  if (enabled) schedule(0);
  return {
    connect,
    disconnect: unlink,
    check: resume,
    state: () => state,
    subscribe(listener: (state: SyncState) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
      window.removeEventListener("online", resume);
      window.removeEventListener("focus", resume);
      window.removeEventListener("storage", changed);
      document.removeEventListener("visibilitychange", resume);
    },
  };
}
