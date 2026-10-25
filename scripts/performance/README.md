# Measure performance

These tools compare production builds using synthetic boards. Generated results belong in ignored `test-results/performance`, not the source repository. The catalogue baseline under `tests/fixtures` is an intentional regression oracle.

Build a baseline revision and a candidate revision into separate directories. Run both with the same machine, browser and scripts. Stop other build and browser jobs while measuring. The browser script uses Playwright's Chromium from `npx playwright install chromium`; set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to use another Chromium executable.

```sh
SAYBOARD_DIST=/absolute/path/to/baseline/dist node scripts/performance/browser.mjs test-results/performance/baseline.json
SAYBOARD_DIST=dist node scripts/performance/browser.mjs test-results/performance/candidate.json
node scripts/performance/catalogue.mjs test-results/performance/catalogue-candidate.json
```

Set `SAYBOARD_CATALOGUE_SOURCE` to the baseline catalogue's absolute TypeScript path to measure it with the same source benchmark. Keep its catalogue JSON and dependencies available beside that source. Run `summarize.mjs`, `compare.mjs` and `profile-summary.mjs` with the recorded input and output paths shown by their usage messages.

## Method

The browser script serves gzip-compressed production assets over localhost. Each
20- and 60-tile fixture includes a category with a separate page. Desktop uses
1280×900 at native CPU speed; the mobile scenario uses a 390×844 touch viewport and
Chromium's 4× CPU slowdown. This simulates CPU and viewport constraints, not an
actual phone or a cellular connection.

Each scenario runs seven independent browser contexts. Each context first loads
with an empty HTTP cache, then reloads with the same HTTP cache. A small init
script writes the same board before each navigation. CDP script/task durations
are current-document counters captured before interactions. Paint metrics use
Navigation/Paint Timing and an LCP observer. JS transfer sizes include Resource
Timing overhead; warm resources report zero transfer bytes.

Interactions measure synchronous JavaScript handlers using `performance.now()`:
30 category/Home roundtrips, one tile dispatch to a stub local device voice,
opening caregiver editing, opening a word's symbol picker, and three rounds of
the fixed search corpus. The report takes the median within each category/search
batch, then the median and min/max across seven independent contexts. Handler
measurements exclude subsequent painting. Assertions require the expected tile
count, actual speech dispatch, and no page errors.

The catalogue benchmark measures the first search/suggestion corpus, then runs
10 warm-up rounds and seven measured batches of 20 corpus rounds. Results are
milliseconds per query or phrase. The single cold import and first corpus are
diagnostic values, not repeated startup comparisons. Raw results retain every
sample. Use `summarize.mjs` for median and min/max summaries.
