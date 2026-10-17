import { createSoundHelp } from "./sound-help";

/** Text is session-only. The caller owns the same speech pipeline used by tiles. */
export function createTypeAndSpeak({
  text,
  onChange,
  onSpeak,
}: {
  text: string;
  onChange: (text: string) => void;
  onSpeak: (text: string) => void;
}): HTMLFormElement {
  const form = document.createElement("form");
  form.className = "type-and-speak";
  const label = document.createElement("label");
  label.htmlFor = "typed-speech";
  label.textContent = "Type something to say";
  const heading = document.createElement("div");
  heading.className = "type-and-speak-heading";
  heading.append(label, createSoundHelp());
  const row = document.createElement("div");
  row.className = "type-and-speak-row";
  const input = document.createElement("input");
  input.id = "typed-speech";
  input.type = "text";
  input.value = text;
  input.maxLength = 200;
  input.autocomplete = "off";
  input.enterKeyHint = "send";
  const speak = document.createElement("button");
  speak.type = "submit";
  speak.className = "button primary";
  speak.textContent = "Speak";
  let composing = false;
  function update() {
    speak.disabled = composing || !input.value.trim();
  }
  input.addEventListener("input", () => {
    onChange(input.value);
    update();
  });
  input.addEventListener("compositionstart", () => {
    composing = true;
    update();
  });
  input.addEventListener("compositionend", () => {
    composing = false;
    onChange(input.value);
    update();
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (composing || event.isComposing))
      event.preventDefault();
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const phrase = input.value.trim();
    if (!composing && phrase) onSpeak(phrase);
  });
  update();
  row.append(input, speak);
  form.append(heading, row);
  return form;
}
