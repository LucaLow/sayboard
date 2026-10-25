import { createElement as el } from "./dom";
import "./google-signin.css";

type Availability = { enabled: boolean; signupEnabled: boolean };
let availability: Promise<Availability | null> | undefined;
async function discover(): Promise<Availability | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch("/api/auth/google/config", {
        credentials: "same-origin",
        signal: controller.signal,
      });
      if (!response.ok) return null;
      const value: unknown = await response.json();
      if (
        !value ||
        typeof value !== "object" ||
        !("enabled" in value) ||
        typeof value.enabled !== "boolean" ||
        !("signupEnabled" in value) ||
        typeof value.signupEnabled !== "boolean"
      )
        return null;
      return { enabled: value.enabled, signupEnabled: value.signupEnabled };
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return null;
  }
}

export function mountGoogleSignIn(card: HTMLElement): void {
  const slot = el("div");
  card.append(slot);
  availability ??= discover();
  void availability.then((config) => {
    if (!config?.enabled) return;
    const description = card.querySelector("p");
    if (description)
      description.textContent = config.signupEnabled
        ? "Start with Google, or sign in with an existing teacher username. Learners do not need accounts."
        : "Sign in with Google or your existing teacher username. Learners do not need accounts.";
    const form = el("form", "teacher-form");
    const button = el("button", "google-signin-button", "Continue with Google");
    button.type = "submit";
    const logo = el("img");
    logo.src = "/google-g.svg";
    logo.alt = "";
    logo.width = 20;
    logo.height = 20;
    button.prepend(logo);
    const failure = el("p", "teacher-muted");
    failure.role = "status";
    failure.hidden = true;
    form.onsubmit = (event) => {
      event.preventDefault();
      button.disabled = true;
      failure.hidden = false;
      failure.textContent = "Opening Google sign-in…";
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      void fetch("/api/auth/google/start", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) throw new Error("Google start failed");
          const value: unknown = await response.json();
          if (
            !value ||
            typeof value !== "object" ||
            !("url" in value) ||
            typeof value.url !== "string"
          )
            throw new Error("Invalid authorization URL");
          const target = new URL(value.url);
          if (
            target.origin !== "https://accounts.google.com" ||
            target.pathname !== "/o/oauth2/v2/auth" ||
            target.username ||
            target.password
          )
            throw new Error("Invalid authorization URL");
          location.assign(target.href);
        })
        .catch(() => {
          button.disabled = false;
          failure.textContent =
            "Google sign-in could not start. Try again or use your teacher username.";
        })
        .finally(() => clearTimeout(timeout));
    };
    form.append(button, failure);
    slot.append(
      form,
      el(
        "p",
        "teacher-muted",
        config.signupEnabled
          ? "New here? Your Google account creates your teacher workspace. No new password needed."
          : "Use the Google account you previously used with Sayboard.",
      ),
    );
  });
}

export function googleSignInNotice(): string | null {
  const match = /^#google=(failed|cancelled|signup-disabled)$/.exec(
    location.hash,
  );
  if (!match) return null;
  history.replaceState(null, "", location.pathname + location.search);
  if (match[1] === "cancelled")
    return "Google sign-in was cancelled. You can try again or use your teacher username.";
  if (match[1] === "signup-disabled")
    return "New Google accounts are not enabled here yet. Use your existing teacher login or contact your Sayboard organiser.";
  return "Google sign-in did not finish. Try again or use your teacher username. Your saved boards have not changed.";
}
