import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { chromium, webkit, devices } from "playwright";

// Run against the built app and a Vite dev server for the model fixture. Real browser engines execute the app; only the
// unavailable OS speech service is simulated. This does not test audible iOS audio.
const url = process.env.SAYBOARD_TEST_URL || "http://127.0.0.1:5181";
const moduleUrl = process.env.SAYBOARD_MODULE_URL || url;
const scenarios = (
  process.env.SAYBOARD_TEST_SCENARIOS ||
  "late-voices,saved-voice-arrives,missing-saved-voice,model-first-tap,suspended-model-audio,remote-only,blocked-storage,no-model-apis,native-startup"
).split(",");
const board = JSON.parse(
  await readFile(
    new URL("../fixtures/legacy-custom-board.json", import.meta.url),
  ),
);
const report = [];
for (const [name, browserType] of [
  ["webkit", webkit],
  ["chromium", chromium],
]) {
  const browser = await browserType.launch({ headless: true });
  try {
    for (const scenario of scenarios) {
      const context = await browser.newContext({
        ...devices["iPhone 13"],
        defaultBrowserType: undefined,
      });
      const page = await context.newPage();
      const errors = [];
      const requests = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("request", (request) => requests.push(request.url()));
      if (scenario !== "native-startup")
        await page.addInitScript(
          ({ scenario, board }) => {
            window.__speechCalls = [];
            window.__insideTap = false;
            document.addEventListener(
              "click",
              () => {
                window.__insideTap = true;
                setTimeout(() => {
                  window.__insideTap = false;
                }, 0);
              },
              true,
            );
            const local = {
              voiceURI: "iphone-local",
              name: "Device local",
              lang: "en-US",
              localService: true,
            };
            const remote = {
              voiceURI: "remote",
              name: "Remote",
              lang: "en-US",
              localService: false,
            };
            window.__voices =
              scenario === "late-voices"
                ? []
                : scenario === "remote-only"
                  ? [remote]
                  : [remote, local];
            window.__localVoice = local;
            window.__savedVoice = {
              ...local,
              voiceURI: "saved-local",
              name: "Saved local",
            };
            class Utterance {
              constructor(text) {
                this.text = text;
              }
            }
            Object.defineProperty(window, "SpeechSynthesisUtterance", {
              value: Utterance,
            });
            Object.defineProperty(window, "speechSynthesis", {
              value: {
                getVoices: () => window.__voices,
                addEventListener: () => {},
                cancel: () => {},
                speak: (utterance) => {
                  window.__speechCalls.push({
                    text: utterance.text,
                    voice: utterance.voice?.voiceURI,
                    insideTap: window.__insideTap,
                  });
                  // Simulates the initial iOS gesture requirement, not OS sound.
                  if (!window.__insideTap) return;
                  utterance.onstart?.();
                  setTimeout(() => utterance.onend?.(), 10);
                },
              },
            });
            if (scenario === "saved-voice-arrives")
              localStorage.setItem(
                "sayboard-v1",
                JSON.stringify({ ...board, voice: "saved-local" }),
              );
            if (scenario === "missing-saved-voice")
              localStorage.setItem("sayboard-v1", JSON.stringify(board));
            if (scenario === "model-first-tap")
              localStorage.setItem("sayboard-speech-choice-v1", "model");
            if (scenario === "no-model-apis") {
              for (const name of ["Worker", "WebAssembly", "AudioContext"])
                Object.defineProperty(window, name, { value: undefined });
            }
            if (scenario === "blocked-storage")
              Object.defineProperty(window, "localStorage", {
                get() {
                  throw new DOMException("Storage blocked", "SecurityError");
                },
              });
          },
          { scenario, board },
        );
      await page.goto(
        ["model-first-tap", "suspended-model-audio"].includes(scenario)
          ? moduleUrl
          : url,
      );
      await page.locator(".tile").first().waitFor();
      assert.deepEqual(errors, [], `${name} ${scenario} startup errors`);
      assert.equal(
        requests.some((request) =>
          /huggingface|kokoro\.worker|ort-wasm/.test(request),
        ),
        false,
        "Startup must not fetch model/runtime",
      );
      if (scenario === "native-startup") {
        report.push({
          engine: name,
          scenario,
          platform: await page.evaluate(() => ({
            speech: "speechSynthesis" in window,
            voices: window.speechSynthesis?.getVoices().length,
            audio: typeof AudioContext,
            wasm: typeof WebAssembly,
            webgpu: !!navigator.gpu,
          })),
        });
      } else if (
        ["model-first-tap", "suspended-model-audio"].includes(scenario)
      ) {
        // Exercise both a persisted unloaded preference and a loaded uncached
        // model, using a small deterministic model instead of downloading 117 MB.
        if (scenario === "model-first-tap")
          await page
            .getByRole("button", { name: "Say Yes", exact: true })
            .tap();
        await page.evaluate(async (scenario) => {
          const suspended = scenario === "suspended-model-audio";
          if (suspended) {
            class Context {
              state = "suspended";
              resume() {
                return new Promise(() => {});
              }
              close() {
                return Promise.resolve();
              }
            }
            Object.defineProperty(window, "AudioContext", { value: Context });
          }
          const { SpeechEngine } = await import("/src/speech/engine.ts");
          const { BrowserSpeechOutput } =
            await import("/src/speech/browser-output.ts");
          const model = {
            identity: "gesture-test",
            load: async () => {},
            dispose: () => {},
            generate: async () => {
              if (!suspended)
                await new Promise((resolve) => setTimeout(resolve, 1200));
              return { samples: new Float32Array([0.1]), sampleRate: 24000 };
            },
          };
          window.__engine = new SpeechEngine(new BrowserSpeechOutput(), model);
          await window.__engine.loadModel();
          if (suspended)
            await window.__engine.preparePhrases(["Model first tap"]);
          const button = document.createElement("button");
          button.textContent = "Uncached model phrase";
          button.onclick = () =>
            window.__engine.speak("Model first tap", {
              systemVoiceURI: window.__localVoice.voiceURI,
            });
          document.body.append(button);
        }, scenario);
        await page
          .getByRole("button", { name: "Uncached model phrase", exact: true })
          .tap();
        await page.waitForTimeout(1400);
        const calls = await page.evaluate(() => window.__speechCalls);
        assert.deepEqual(
          calls.map((call) => call.text),
          scenario === "model-first-tap"
            ? ["Yes", "Model first tap"]
            : ["Model first tap"],
        );
        assert.ok(
          calls.every((call) => call.insideTap),
          "Device fallback must start in the original tap",
        );
        report.push({ engine: name, scenario, calls });
      } else {
        if (scenario === "late-voices")
          await page.evaluate(() => {
            window.__voices = [window.__localVoice];
          });
        if (scenario === "saved-voice-arrives")
          await page.evaluate(() => {
            window.__voices = [window.__localVoice, window.__savedVoice];
          });
        await page
          .getByRole("button", {
            name: ["missing-saved-voice", "saved-voice-arrives"].includes(
              scenario,
            )
              ? "Say Drink"
              : "Say Yes",
            exact: true,
          })
          .tap();
        await page.waitForTimeout(30);
        const calls = await page.evaluate(() => window.__speechCalls);
        if (scenario === "remote-only") {
          assert.deepEqual(calls, []);
          await page.getByRole("dialog").waitFor();
        } else {
          assert.equal(
            calls.length,
            1,
            `${name} ${scenario} should invoke speech`,
          );
          assert.equal(
            calls[0].voice,
            scenario === "saved-voice-arrives" ? "saved-local" : "iphone-local",
          );
          assert.equal(calls[0].insideTap, true);
          if (["missing-saved-voice", "saved-voice-arrives"].includes(scenario))
            assert.equal(
              await page.evaluate(
                () => JSON.parse(localStorage.getItem("sayboard-v1")).voice,
              ),
              scenario === "saved-voice-arrives" ? "saved-local" : board.voice,
              "Preserve saved preference",
            );
          await page.locator("#status").filter({ hasText: "Said:" }).waitFor();
        }
        report.push({ engine: name, scenario, calls });
      }
      assert.deepEqual(errors, [], `${name} ${scenario} runtime errors`);
      await context.close();
    }
  } finally {
    await browser.close();
  }
}
await mkdir("test-results", { recursive: true });
await writeFile(
  "test-results/iphone-speech.json",
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
