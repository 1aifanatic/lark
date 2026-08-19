# STATE — LARK

_Last updated: 2026-08-19_

Chrome MV3 extension (vanilla JS, no build step). Extracts a page URL or a YouTube
transcript, composes it with a system prompt, and pastes it into one or more LLM web UIs.
**Personal tool** — not headed for the Chrome Web Store.

---

## What works

- Extension loads clean: valid MV3 manifest, all four icons present.
- Popup and options page wire up correctly — every `getElementById` in `popup.js` and
  `options.js` resolves against its HTML, so no null-crash on open.
- Settings persist. `popup.js` and `options.js` both use `chrome.storage.local`
  consistently (note: `CLAUDE.MD` wrongly claims `chrome.storage.sync`).
- URL → LLM path works: the popup asks the service worker to open each selected LLM
  (see the 2026-08-17 (3) entry — it used to call `chrome.tabs.create` itself, which
  opened only the first platform) and `llm-injector.js` pastes the composed content.
- Prompt templates, export/import, clipboard copy, LLM multi-select, keyboard shortcuts.

## What's broken

| # | Thing | Status | Where |
|---|---|---|---|
| 1 | timedtext caption fetch | **Confirmed dead** — signed `baseUrl` returns HTTP 200 with 0 bytes (proof-of-origin `pot` gating). Tested plain, `fmt=json3`, `fmt=srv3`, browser headers. | `youtube-extractor.js` `fetchFromTimedText` |
| 2 | `get_transcript?key=` API | **Fails cookieless** — 400 `FAILED_PRECONDITION`, with and without `visitorData`. Unconfirmed whether session cookies rescue it in-browser. | `youtube-extractor.js` `fetchTranscriptAPI` |
| 3 | Transcript panel scrape | **Broken by code bug** — `:contains()` is invalid CSS, so `querySelector` throws `SyntaxError` instead of returning null, killing the `\|\|` fallback. | `youtube-extractor.js:606` |
| 4 | Multi-LLM open from the YouTube button | **Broken** — `window.open` in an `await` loop consumes transient user activation; only the first tab opens. | `youtube-extractor.js:185` |
| 5 | Double-paste | `visibilitychange` can re-run injection when you switch back to a tab. | `llm-injector.js:8` |
| 6 | Dead key | `popup.js` writes `pendingLLMs`; `llm-injector.js` reads `targetLLM`. Harmless, inconsistent. | both |

Net: the headline feature (YouTube transcript → LLM) is very likely non-functional.
Full findings staged in the wiki at `_raw/2026-08-16-youtube-transcript-api-gating.md`
and `_raw/2026-08-16-queryselector-contains-and-window-open-activation.md`.

---

## Plan (agreed 2026-08-16 via /grilling)

**Step 0** — Fix the two confirmed bugs: #3 `:contains()`, #4 `window.open` loop.
**Step 1** — Headless diagnosis of YouTube extraction (`--load-extension` + `--headless=new`,
throwaway profile). Determines whether #2 is recoverable. Logged-out only; logged-in
confirmation needs the user.
**Step 2** — Skills library. Migrate the six existing templates into it and delete the
template concept. Owns `composeContent`, so it lands before the features that use it.
**Step 3** — Article-text extraction for non-YouTube pages (currently sends URL only).
**Step 4** — GitHub repo comparison.
**Step 5** — YouTube repair proper, scoped by step 1.

## Decisions locked

- **Architecture stays paste-into-web-UI**, not direct API calls — rides existing
  subscriptions, keeps seven-vendor fan-out free. Consequence: the extension can never
  read the model's reply, so no summarise-in-popup, no chaining, no saved outputs.
- **Non-YouTube pages send extracted article text**, not just the URL; URL kept as a
  provenance header line.
- **Skills** = named, composable prompt modifiers that stack on top of content — not
  replacements for the system prompt. Shape `{ id, name, body, builtin }` in
  `chrome.storage.local`. Built-ins are editable with per-skill reset. Cap 3 per send.
  Compose as `system prompt → numbered skill bodies → --- → content`, plus a one-line
  restatement *after* long transcripts (models weight prompt-end more heavily).
  Export/import JSON extended to carry them.
- **Repo compare**: popup-only, no injected on-page GitHub button (avoids repeating the
  bug in #4 and the DOM-rot that killed transcripts). Two-field form, first field
  pre-filled from the current tab if it's a repo. Max 3 repos.
- **Repo data from the GitHub API only**, no page scraping. `api.github.com` sends
  `Access-Control-Allow-Origin: *` so no proxy or key is needed. Unauthenticated limit is
  60 req/hr per IP; ~4 calls per repo means ~6–7 comparisons/hour. Fail loudly on 403
  rather than degrading to a scraper. Include the README.
- **Rubric axes**: maintenance health, adoption, bus factor, documentation, license fit,
  lifecycle risk. Prompt must name the deciding axis and is explicitly allowed to answer
  "too close to call".
- **Transcript fallback if step 1 is bad news**: repair the panel scrape properly; fall
  back to URL-only when no panel. Explicitly *not* implementing BotGuard/`pot` generation.
- **Verification**: headless Chrome + node for anything automatable; a manual checklist
  for anything needing a logged-in YouTube or a live paste into an LLM. Results reported
  as "verified headless" vs "needs your eyes", never blended.

---

## Step 1 diagnosis results (2026-08-16, headless Chrome, logged out)

Method: launched `chrome --headless=new --remote-debugging-port`, drove it over CDP from
node, evaluated the **real `youtube-extractor.js` source** inside a
`Page.createIsolatedWorld` — which is what a content script actually gets, so page CSP and
Trusted Types don't apply. Harness scripts in the session scratchpad (`diag*.mjs`).

**Method 2 (timedtext) — confirmed dead in-browser.** `fetch(track.baseUrl)` →
`status 200, bytes 0`. Matches the earlier cookieless curl exactly. Not a parsing problem,
not a header problem: the body is empty.

**Method 1 (`get_transcript`) — the endpoint is retired.** Returns 400. The successor is
**`POST /youtubei/v1/get_panel`**, which returns **200** with ~35 KB containing
`transcriptSegmentViewModel` nodes (`{ simpleText, timestamp, … }`). Replicating that call
directly is blocked for now: its request body is **gzip-compressed** (`1f 8b 08`), and the
old `getTranscriptEndpoint.params` value is rejected by `get_panel` with
`400 invalid argument`. So we cannot cheaply hand-build the request.

**Method 3 (panel scrape) — viable, and the renderer was renamed.** This is why the old
selectors found nothing:

| Old (dead) | New (current) |
|---|---|
| `ytd-transcript-segment-renderer` | `transcript-segment-view-model` |
| `engagement-panel-searchable-transcript` | `PAmodern_transcript_view` |

On a 3:33 video with manual captions: panel opens, **24/24 segments render — the complete
transcript**, text confirmed present. Letting the page issue its own `get_panel` call and
reading the resulting DOM sidesteps the gzip/params problem entirely.

**The `:contains()` fix is verified.** `findClickableByText('transcript')` returns the
"Show transcript" control without throwing.

### Open risk — blocks the step 5 design

On a **1:00:46 video with auto-generated (`en/asr`) captions**, the same scrape returned
**0 segments**, and no scrollable container was found. That video definitely has captions
(`captionTracks: 1 × en/asr`, `getTranscriptEndpoint` present), so this is a real failure,
not "no transcript available". Cause undetermined — candidates: ASR panels render
differently, the 8 s wait was too short, or the modern panel didn't open for that video.

This matters more than anything else in the plan: **long + auto-generated is the dominant
real use case.** Resolve before committing to the panel-scrape implementation.

### Long-video risk: resolved (and it is a real limitation)

Chased it down. YouTube runs **two transcript panel implementations** and assigns them
per video:

- `PAmodern_transcript_view` → backed by `get_panel` → **populates, scrapes fine**.
- `engagement-panel-searchable-transcript` (legacy) → backed by the retired
  `get_transcript` → **opens empty, and stays empty**.

On the 1-hour test video, *every* control (`aria-label="Transcript"`, both
`aria-label="Show transcript"` buttons) opened the legacy panel, and forcing the modern
panel's `visibility` attribute does not load content — YouTube needs its own action
dispatch. So for legacy-panel videos there is currently **no working extraction path**,
and that is not something the extension can fix. It is an A/B rollout; presumably it
completes eventually.

The extractor therefore tries every strategy and **fails specifically** rather than
pretending, telling the user whether the video genuinely lacks captions or whether it got
the dead legacy panel.

---

## Work completed 2026-08-16

**Step 0 — confirmed bugs fixed.** `:contains()` replaced with `findClickableByText`;
`window.open` loop replaced with an `openTabs` message to the service worker.

**Step 5 — transcript extraction rewritten.** Method order now reflects reality: panel
scrape first, then timedtext, then `get_transcript` last (kept only because the logged-in
case is untested). Queries both renderer families, polls instead of fixed-sleeping,
expands the description to find the control on long videos, and scrolls the panel until
the segment count stabilises so long transcripts are not silently truncated. Segment text
is stripped of timestamp and accessibility-label prefixes.

**Step 2 — skills library.** New `skills.js`: `{id, name, body, builtin}` in
`chrome.storage.local`, 8 seeded built-ins, cap of 3 active. `composeMessage()` is now the
single composition seam used by the popup, the options page and the YouTube button.
Options page has a full editor (add / rename / edit / delete / per-skill reset / restore
built-ins). The old template system is gone. Export/import carries skills and selection.

**Step 3 — article extraction.** Non-YouTube pages now send readable page text via
`chrome.scripting.executeScript` under `activeTab` (no new host permissions). Scores
candidate containers by paragraph text, preserves headings and lists, de-duplicates
repeated lines, caps at 60k chars, and falls back to URL-only when a page yields too
little (or on `chrome://` pages where injection is refused).

**Step 4 — GitHub repo comparison.** New `github.js`: 2–3 repos, API only, 4 calls each
(repo, contributors, releases, README), six-axis rubric, optional purpose field, explicit
licence to answer "too close to call". Loud failure on rate limit with the reset time.
Popup pre-fills the first field when the current tab is a repo.

**Carry-overs.** Double-paste fixed via a `pendingStamp` guard (and pending content is no
longer deleted by whichever tab finishes first, which used to starve the other tabs in a
multi-LLM send). Dead `targetLLM` key removed. `CLAUDE.MD` storage drift corrected.

### Verification

19/19 automated checks pass against **live services** (headless Chrome driven over CDP,
real source files, real GitHub API, real YouTube):

- skills seed, persist, cap at 3
- `composeMessage` ordering, empty-meta handling, long-content restatement
- `parseRepoInput` across slug / URL / SSH / deep-link / junk
- `compareRepos` live against GitHub — rubric, purpose, stars, bus factor, licence, README
- input validation and the 404 path
- article extraction on a real Wikipedia page (19,708 chars, headings kept, nav dropped)
- `extractTranscript()` end to end on a modern-panel video — 2,089 chars, clean text

Harness: `scratchpad/verify2.mjs` and `lib.mjs`.

**Not verified — needs a human:**
1. The extension loading in a real Chrome (`--load-extension` is disabled in Chrome 145
   headless, so manifest wiring, the options page UI and popup rendering were checked
   structurally, not by loading).
2. Paste actually landing in ChatGPT / Claude / Gemini / etc. — needs logged-in sessions.
3. Whether `get_transcript` or the legacy panel behaves differently when logged in.

---

## UI pass 2026-08-17

Ran the `ui-ux-pro-max` design database (dials: variance 4, motion 3, density 8). It
recommended a "Modern Dark" system for developer tools, which the existing dark theme
already matches. **Deliberately ignored its palette suggestion** (slate + green): the
orange→amber gradient is this extension's brand identity and a generic palette is not
worth trading it for. Also skipped its Inter/GSAP recommendations — the UI already has a
webfont, and a popup that lives ~2 seconds has no use for scroll-triggered choreography.

### The real problem: the 600px cap

Chrome hard-caps an extension popup at **600px tall**. Adding skills and repo comparison
had pushed the popup to **1119px**, so the primary button and the entire repo form sat
below the fold. Measured, not guessed — every block's offset was read from a rendered
popup.

| | before | after |
|---|---|---|
| total height (ordinary page) | 1119px | **~545px** |
| primary CTA position | ~574px (at the fold) | **373px** |
| footer | below fold | **above fold** |

How the space was found: width 340→380px (fewer wrapped labels), LLM grid 2→3 columns,
Select All/Clear moved inline into the section header instead of a full-width row below the
grid, footer changed from stacked to a single row, dense spacing scale, and a shorter
single-line primary button. On a GitHub page with the repo form open it is 779px and
scrolls — acceptable, since the CTA is still at 373px and the user opened that form
deliberately.

### Accessibility fixes (all measured)

- **`--text-muted` was failing WCAG AA everywhere** — #606070 measured 3.20 / 3.02 / 2.79
  against the three surfaces. Now #8a8a9c: 5.83 / 5.50 / 5.09.
- **Added `--border-strong` (#5f5f7a)** for input borders. The old #2a2a3a measured
  1.32:1, well under the 3:1 needed for a control that signals "you can type here".
- **Both collapsible headers were `<div>`s with click handlers** — unreachable by keyboard
  and invisible to assistive tech. Now real `<button>`s with `aria-expanded`/`aria-controls`
  kept in sync.
- **Icon-only buttons had no accessible name** — added `aria-label` (title alone is not
  reliable).
- **Skill chips announce state** via `aria-pressed`.
- **`prefers-reduced-motion` was absent** despite ~20 transitions and two infinite
  keyframe animations. Now honoured in both stylesheets.
- **Focus rings** on every control. Two subtleties worth remembering, both caught by
  testing rather than reading: `:where()` has zero specificity, so the focus block **must
  be last in the file** or later `transition`/`outline` rules win on source order; and
  `transition: all` animates the outline in from 0, so focus indication needs
  `transition: none` to be instant. Verified 12/12 controls show `solid 2px rgb(247,201,75)`
  under real Tab keypresses.
- **No rendered text below 11px** (was 10px in three places).
- Font fallback is now a real system-UI stack rather than generic `sans-serif`, so the
  frame before the webfont arrives is close to the final one.

### Verification

- 9/9 accessibility checks pass in a rendered popup (`scratchpad/a11y.mjs`, `focus.mjs`).
- 19/19 functional checks still pass after the UI changes — no regression
  (`scratchpad/verify2.mjs`).
- Layout measured in both contexts (`scratchpad/fold.mjs`); screenshots captured before
  and after (`scratchpad/before-popup.png`, `final-popup.png`, `after-options.png`).

Harness note: the popup was rendered by serving the extension over `python -m http.server`
and injecting a `chrome.*` stub via `Page.addScriptToEvaluateOnNewDocument`, which runs
before page scripts — so `popup.js` ran for real. Remember
`Network.setCacheDisabled`, or edited CSS is served from cache and every measurement is
stale.

### Webfont round-trip — resolved 2026-08-17

Both stylesheets `@import`ed Outfit + Space Mono from `fonts.googleapis.com`. Rather than
bundling the files, the reskin below dropped webfonts entirely for system stacks
(`system-ui` for UI, `ui-serif` for display, `ui-monospace` for code). No network on popup
open, nothing to vendor, and the serif display suits the new visual language.

---

## Visual identity pass 2026-08-17 — warm paper / clay

Brief: "make the UI as if it was made by Anthropic." Read as *adopt that visual language*,
not *badge it as their product* — the extension keeps its own name and mark, and no
Anthropic wordmark or logo was added.

**The design database was overridden, deliberately.** `ui-ux-pro-max` returned "AI purple
+ generation pink" (#7C3AED / #EC4899) with Lora/Raleway — generic AI-tool colour and
wellness typography. Its warm-neutral results (`#FFFBEB` + `#78716C`, its "Notes & Writing
App" entry) corroborate the family but not the specifics. **The palette below comes from
Anthropic's observable design language, not a database match.**

### The system

| | Light (default) | Dark |
|---|---|---|
| page | `#F0EEE6` | `#1F1E1B` |
| surface / card | `#FAF9F5` / `#FFFFFF` | `#262622` / `#2C2B27` |
| ink / secondary / muted | `#141413` / `#5C5B55` / `#6E6C64` | `#F5F4EF` / `#B8B5AC` / `#9C998F` |
| hairline / hairline-strong | `#DEDBD0` / `#8A8578` | `#3A3833` / `#7A776C` |
| clay fill / clay ink / on-clay | `#B85C38` / `#954625` / `#FFFFFF` | `#E08A6A` / `#E5947A` / `#1F1E1B` |

Type: `ui-serif, Georgia` for display, `system-ui` for UI, `ui-monospace` for code/URLs.
Removed: gradients, orange glow shadows, the radial ambient wash, the sheen sweep on the
primary button, lift-on-hover transforms, the pulsing status dot, and the progress-bar
shimmer. Motion is 150ms on colour only. Radii 6/8px plus pills for chips and badges.

Dark mode is a full variant via `prefers-color-scheme`, so the previous dark-theme habit
is preserved rather than discarded.

### Two things the static audit missed and the live audit caught

Contrast was pre-computed before writing any CSS, and **the pre-computed table was still
wrong in two places**. Auditing the *rendered* page found them:

1. **Dark-mode accent pairing was broken.** The value audited (`#E08A6A`) and the value
   shipped (`#C4694A`) had diverged during writing, leaving white-on-clay at **3.84**.
   Fixed by inverting the pairing — lighter clay fill with dark ink measures **6.36**,
   which also reads better on a dark page than white on a darker fill.
2. **Translucent overlays change the background under them.** `.llm-counter.active`
   (clay ink on a clay wash) measured 4.38, and the `⌘+Enter` chip — white text at
   `opacity: 0.75` on a `rgba(255,255,255,.16)` panel over clay — measured **3.46 light /
   3.02 dark**. Fixed by darkening the accent ink to `#954625` and deleting the chip
   background and the opacity outright; plain `--on-clay` on clay is 4.54 / 6.36.

Lesson worth keeping: a static palette table cannot see composited translucency or a
token that drifted between audit and implementation. Audit the rendered page.

### Verification

- **Live contrast audit of both pages in both schemes: all rendered text meets AA**
  (`scratchpad/live-contrast.mjs`). It resolves real composited backgrounds, walks up for
  the first opaque ancestor, applies alpha compositing, uses the large-text 3:1 threshold
  where it applies, and skips `aria-hidden` subtrees since decorative content is exempt.
- **10/10 accessibility checks** (`scratchpad/a11y.mjs`), now scheme-aware — it asserts the
  audited token values in *both* palettes, so lightening `--ink-muted` later trips a test.
- **12/12 focus rings** under real Tab keypresses, `solid 2px` in the clay accent.
- 600px fit holds: primary CTA at 364px, footer fully above the fold.
- Screenshots: `light-popup.png`, `pop-dark-popup.png`, `opt-light-options.png`.

Harness note: **pin `prefers-color-scheme`**. Headless Chrome defaults to dark, so an
unpinned scheme makes every colour assertion a coin flip — this produced one false failure
before being fixed.

### Known cosmetic notes

- The Qwen brand glyph is `aria-hidden` (decorative, redundant with its adjacent "Qwen"
  label) and was darkened to `#231016` for plain legibility on the pink mark.
- The primary CTA and the repo panel's "Compare & Send" are both clay fills. They live in
  separate sections and are never the same decision, so this was left as is.

## Next

- Load unpacked and walk the three manual checks above.
- If legacy-panel videos remain common, consider prompting the user to open the transcript
  themselves rather than failing.

---

## Feature pass 2026-08-17 (2) — themes, powers, simplicity

Brief: "make the UI even more beautiful with light and dark modes, give more powers to
the extension, make it simple." Scope chosen: user-controlled themes, right-click sends,
a browser-wide command, five more LLM platforms, background-tab multi-send, and a single
source of truth for platforms.

### What changed

**Themes.** `theme.js` (new) resolves `themePref` (`system|light|dark`) in
`chrome.storage.local`, applies it as `data-theme` on `<html>`, and re-applies on OS
changes while the user is on `system`. Both stylesheets keep the `prefers-color-scheme`
block as the system default and add `html[data-theme="light"/"dark"]` override blocks —
the attribute selectors out-specify `:root`, which is what makes the toggle work.
Popup header has a sun/moon toggle (cycles from the *effective* theme; options page
restores "system"). Options page has an Appearance section with a System/Light/Dark
segmented control. `color-scheme` set per theme so form controls and scrollbars match.

**Powers.**
- Context menus: right-click → "Send to LLM" submenu with *Send this page* / *Send
  selection* / *Send this link*. `background.js` composes with skills + system prompt
  (importScripts `skills.js`, `llms.js`, `page-text.js`) and opens the selected LLMs.
- Browser-wide command: `Alt+Shift+X` (`commands` in manifest) → sends the current page.
- Five new platforms: Perplexity, Poe, Mistral Le Chat, HuggingChat, Copilot — wired
  through manifest host permissions + content-script matches, `llm-injector.js`
  selectors (a shared React-safe `injectToTextarea` covers them), the popup picker, the
  options grid, and the YouTube button's URL map. 12 platforms total.
- Multi-LLM sends: first tab foreground, the rest background (`active: i === 0`), so a
  send does not tear the user through focused tabs.
- YouTube embedded button restyled to the clay design language (theme-aware fill,
  colour-only hover, reduced-motion-aware spinner, proper error state) and renamed
  "Send to AI"; writes `pendingStamp`/`pendingLLMs` like the popup (dead `targetLLM`
  key gone for good).

**Simplicity.** New `llms.js` is the single platform list (`LLM_PLATFORMS` + derived
`LLM_NAMES`/`LLM_URLS`/`LLM_COLORS`); the popup picker is generated from it with brand
monogram chips (aria-hidden, decorative) instead of hand-written rows. First run
defaults to ChatGPT checked so the big button just works. Status line summarises long
LLM lists ("ChatGPT, Gemini, Claude +2"). Page text extraction moved to `page-text.js`
shared by popup and background. Export/import now carries `themePref`.

### Verification

- `node --check` passes on all 10 JS files; `manifest.json` parses.
- Structural check (`verify.mjs`): every `getElementById` id exists in its HTML, all
  platform ids have host permissions + injector handling, theme plumbing present,
  no stale `targetLLM`.
- **Needs a human:** reload at `chrome://extensions/`, check the popup/options in both
  themes, test a right-click send and `Alt+Shift+X`, and confirm paste landing on the
  new platforms (login-dependent).

### Design notes kept

- Monogram chips are decorative identity — the adjacent name is the accessible label,
  so brand colours are exempt from AA; dark-mode brand variants added for the tones
  that vanish on dark paper (grok, mistral, huggingchat, copilot, perplexity,
  deepseek).
- The 600px popup budget still holds with 12 platforms (~580px closed).

---

## Rename to LARK + multi-send fix, 2026-08-17 (3)

### The bug you hit: four platforms selected, only ChatGPT opened

Root cause found and fixed. `popup.js` ran the open-a-tab-per-platform loop itself:

```js
for (let i = 0; i < selected.length; i++) {
  if (i > 0) await new Promise(r => setTimeout(r, 300));
  chrome.tabs.create({ url: LLM_URLS[selected[i]], active: i === 0 });
}
```

Iteration 0 creates a tab with `active: true`. That moves focus off the popup, and
Chrome destroys the popup document the moment it loses focus — taking the running
function and its pending 300 ms timer with it. Iterations 1..n never happened. The
symptom is deterministic: **always exactly the first selected platform, never the rest.**
It also explains why the "Sent to …" success line never appeared.

**Fix:** the popup no longer opens anything. It writes `pendingContent` /
`pendingStamp` / `pendingLLMs`, then posts `{action: 'openTabs', urls}` to the service
worker. `openTabs()` in `background.js` — already used by the YouTube button for the
same reason — is now the single choke point, and the worker outlives the popup. Added a
250 ms stagger there so four chat SPAs do not all start loading on one frame.

This was never a platform-selection or storage problem, so Gemini / Claude / Perplexity
needed no changes.

### Verification

- `verify.mjs` extended with a real behavioural test: it runs `background.js` inside a
  `vm` sandbox against a recording `chrome` stub, fires the exact message the popup
  sends with four URLs, and asserts four `tabs.create` calls, in order, with only the
  first `active`. Plus static guards that `popup.js` never calls `chrome.tabs.create`
  and does delegate via `openTabs`.
- **Negative control run:** reverting the popup loop and truncating `openTabs` makes it
  report `openTabs opened 1 of 4 tabs (ChatGPT-only regression)`. The guard catches the
  exact symptom.
- `node --check` clean on all JS, manifest parses, full `verify.mjs` passes.

**Could not automate the last mile:** Chrome 145 has removed `--load-extension`
(confirmed — tried it with `--disable-features=DisableLoadExtensionCommandLineSwitch`
and the extension still does not load; only Chrome's built-in component extensions
appear as CDP targets). So the browser-level end-to-end — real popup, real focus loss,
real chat tabs — **needs your eyes**.

### Rename: LLM Content Extractor → LARK

*LLM Article Relay Kit.* Applied across `manifest.json` (now v1.2.0, new description),
both HTML titles and headers, `README.md`, `CLAUDE.MD`, all source comments and console
prefixes (`LARK:`), the export filename (`lark-settings.json`), the YouTube button id
(`lark-btn`) and label ("Send with LARK"), and the context-menu id (`lark-send`) and
title ("Send with LARK").

### New icon

A lark in flight — clay `#B85C38` silhouette, wings swept up, short tail, on a warm-paper
`#F0EEE6` squircle. Replaces the orange→amber gradient stacked-layers mark, which was
left over from the pre-reskin palette and no longer matched anything in the UI.

- **`icons/lark.svg` is the master**; the geometry lives there and nowhere else.
- `create-icons.js` was rewritten: it parses the `d` attribute out of that SVG and
  rasterises all four PNGs plus the per-size SVGs. Pure JS — path flattening, non-zero
  winding fill, 4×4 supersampling — so the no-build-tools rule holds.
- The same path is inlined as `currentColor` in the popup header, the options header and
  the YouTube button. Those three are copies; update them if the master changes.
- `generate-icons.html` now previews the new mark instead of generating the old one.
- Rendered and eyeballed at 16 / 48 / 128; the silhouette survives at toolbar size.



---

## Side-panel co-pilot + GitHub picking, 2026-08-17 (4)

Brief: "no urls will be manually copied — on a github page it has to have options for
selecting from there and adding to the extension for comparison; instead of a pop-up I
want the extension to be a side co-pilot." Plus, mid-session: an option to enable only
certain models.

### Popup → side panel

`sidepanel.html/css/js` (renamed from `popup.*` via `git mv`). Manifest gains the
`sidePanel` permission and `side_panel.default_path`, and **loses `action.default_popup`**
— leaving that in means the icon opens a popup and the panel never appears, so
`verify.mjs` now fails if it comes back. `background.js` calls
`setPanelBehavior({openPanelOnActionClick: true})` at top level, on every worker start,
not just `onInstalled`.

**The architectural change is that the panel is long-lived.** The popup read the active
tab once and died; the panel stays open while you browse. All page-specific rendering now
goes through `refreshForTab()`, re-run on `chrome.tabs.onActivated` and
`chrome.tabs.onUpdated`, scoped to the panel's own window.

CSS: `body` went from a fixed `380px` to `width: 100%; min-width: 280px` — the panel is
user-resizable. **The 600px height cap is gone**, which retires the constraint that shaped
the whole previous layout pass.

### Permission posture changed — worth knowing

`<all_urls>` had to be added, and this is not incidental. `activeTab` only grants access
to the tab the extension was *invoked* on. A popup only ever saw that one tab, so
`activeTab` was sufficient. A panel that stays open while you switch tabs gets no grant
for any of them, so article extraction and the repo scan would have silently failed on
every tab except the one the panel was opened from. `https://github.com/*` is declared
explicitly as well, for readability.

On reload Chrome will show the "read and change all your data on all websites" warning.
That is expected and is the cost of the panel.

### GitHub comparison: nothing is typed

`repoA`/`repoB`/`repoC` deleted. The purpose field stays — it is not a URL and it changes
the verdict.

New `compareBasket` in storage (`[{owner, name}]`, capped at 3) persists across
navigation, so you can queue one repo, browse to the next, and queue that too. Two ways
to fill it, **neither injecting UI into GitHub's DOM** (the locked decision against
on-page buttons still holds — that coupling is what killed transcript extraction):

1. `githubReposOnPage()` — injected with `chrome.scripting.executeScript`, the same
   pattern as `readableTextFromPage`. Returns the repos linked on the page, current repo
   first. Because it is serialised into the page it cannot close over anything in
   `github.js`, so it carries its own copy of the reserved-owner list; `verify.mjs` fails
   if it ever references outer scope.
2. Right-click → **Add to LARK comparison**, scoped to github.com, with the queue count
   on the toolbar badge (a context menu cannot show a toast).

Star counts beside candidates are scraped from the page as a **picking hint only** and are
never allowed into the payload — every figure in the comparison comes from the API.

Section shows on github.com; off GitHub with a non-empty queue it collapses to a one-line
`2 repos queued — Compare | Clear` bar, so a selection is never silently stranded.

### Available Platforms

New `enabledLLMs` key filters every picker. Absent means all enabled (no migration), and
`saveEnabledLLMs` refuses to store an empty list. Disabling a platform reconciles
`selectedLLMs` and the default `selectedLLM` rather than leaving a hidden platform
selected. The new options section is **generated from `LLM_PLATFORMS`**, which also fixes
real drift — the panel picker was generated while the options grid was hand-written.
Export/import carries the key.

---

### Verification

**Automated, all passing:**
- `node --check` on all 11 JS files; manifest parses.
- `verify.mjs` extended: side-panel wiring (permission, `default_path`, absence of
  `default_popup`, `setPanelBehavior`, tab listeners), typed repo fields gone, the scan
  function's scope-purity, github.com host permission, and a behavioural basket test
  (dedupe, cap at 3, `basketToInputs` ordering, removal, reserved-owner rejection) run in
  the `vm` sandbox against an in-memory storage stub. The `openTabs` test still passes.
- **Live GitHub scan test** (`scratchpad/scan-test.mjs`) — headless Chrome over CDP,
  evaluating the real function lifted out of `github.js` against actual pages.
- **Contrast audit of every new element**, rendered, in light + dark and in both the
  on-GitHub and off-GitHub states: all meet AA (lowest 4.54, the audited on-clay pairing).
- Screenshots of the panel (light/dark/off-GitHub) and options page.

**Three real bugs the harnesses caught, all fixed:**
1. **Temporal dead zone.** `let basket` was declared beside its own feature section, but
   start-up calls `refreshForTab()` → `renderRepoSection()` before that line runs, so it
   threw `Cannot access 'basket' before initialization` and the whole panel showed
   "Unable to access current tab". State used during start-up must be declared at the top.
2. **GitHub's marketing nav parses as repos.** The scan initially returned
   `solutions/use-case`, `resources/articles`, `resources/events` — logged-out nav links.
   Reserved-owner list extended.
3. **`facebook/react` now redirects to `react/react`.** Not our bug — GitHub moved it —
   but the test asserted the pre-redirect name. The assertion now compares against the URL
   actually landed on, which is also what a user sees.

**Needs your eyes** (Chrome 145 removed `--load-extension`, override flag included, so
nothing that requires an installed extension can be automated):
1. Icon click opens the panel; it survives tab navigation and updates as you browse.
2. On GitHub: candidate list correct, `+`/`✕` work, queue survives moving between repos,
   Compare & Send fires with 2 and 3.
3. Right-click a repo link → Add to LARK comparison; badge count updates.
4. Settings → Available Platforms: disabling removes from the panel and never leaves a
   disabled platform selected.
5. The `<all_urls>` permission prompt on reload.

## Next

- Walk the five manual checks above.
- Still outstanding from before: paste landing on the newer platforms (login-dependent),
  and legacy-panel YouTube videos remain unextractable by design.
- `STATE.md`'s "What works"/"What's broken" tables at the top are from 2026-08-16 and are
  now largely historical; the dated entries below them are authoritative.

---

## 2026-08-18 — Tab-bound delivery architecture

The stale-paste bug is fixed at the ownership boundary. The retired protocol stored one
global pending prompt that any later AI tab could consume. A Send Run now creates one
Delivery per selected Platform and binds it to the exact tab ID opened by the background
worker. The injector must claim that tab-specific Delivery, paste through a verified
Platform editor adapter, and settle a short-lived claim. Completed and expired runs are
removed from `chrome.storage.session`; old pending keys are deleted during migration.

Architecture is split into four small interfaces:

- `Preferences` owns the versioned atomic settings record and legacy migration.
- `Page Intake` owns pages, transcripts, selections, links, URL fallback, and truncation.
- `Platform` owns the catalog, exact URL matching, selectors, and editor adapters.
- `Send Run` owns prompt preparation, tab fan-out, claims, leases, retries, and cleanup.

Settings and Platform pickers now derive from these modules; the hand-written options
cards and `llms.js` were removed. GitHub comparison stays separate and enters Send Run as
Prepared Content.

Automated verification: `node architecture-tests.mjs` passes 20 domain tests, including
two concurrent runs to the same Platform, stale-tab rejection, lease expiry, transcript
and truncation policy, Preferences migration, and React/paragraph/Quill editors.
`node sidepanel-startup-test.mjs` guards against initialization freezing at `Loading...`;
`node verify.mjs` passes manifest and real service-worker runtime integration checks.
Live authenticated Platform DOMs and YouTube caption availability still require a manual
browser smoke test because they are third-party, login-dependent surfaces.

---

## Skill-selection conflict + social drafts, 2026-08-19 (v1.4.0)

### The reported bug: "Preferences changed before this update could be saved."

Selecting any Skill chip showed that error. Root cause found by reproduction, not reading.

`updatePreferences()` in the panel sent `expectedRevision` with every write. A write is
several service-worker round-trips (`sendMessage` out, handler, response back), so
anything else writing during that window — the Options page, a theme toggle, a background
read — made the check fail. There was a single retry, but the retry is itself `read()` then
`update()`, two more round-trips, so it could lose the same race and surface the error.

A second, compounding defect made it self-sustaining: `createPreferencesClient.observe()`
assigned every incoming snapshot blindly. Change events are asynchronous and a context
hears its own writes, so a snapshot for revision N routinely arrived after the panel
already held N+1 — walking `prefs.revision` **backwards**, which guaranteed the next write
conflicted, whose retry produced another late event, and so on.

Measured in a faithful simulation (worker + client + async change delivery): **37–62 stale
snapshots per 60 clicks**, and with realistic round-trip latency modelled, 4 user-visible
failures per 60 clicks with the exact reported message.

**Fix.**
1. Ordinary UI writes no longer send `expectedRevision`. `update()` merges section by
   section, so a Skill toggle and a concurrent theme change compose by construction.
   Optimistic locking is kept for `replace()` (import), where clobbering is real.
2. The client only ever hands out strictly newer snapshots — a revision watermark that
   `read`, `update`, `replace` and `observe` all advance.
3. `theme.js setThemePref` dropped its read-then-check round trip for the same reason.

After: 0 failures and 0 stale snapshots across repeated runs, with the final persisted
state matching the last click.

### New: X Post, X Thread, LinkedIn Post Skills

Three built-ins that turn the captured content into a publishable draft. The interesting
requirement was formatting: use ordinary Unicode punctuation, but **never** Unicode
look-alike letterforms for fake bold/italic (𝗕𝗼𝗹𝗱, ⒶⓁⓉ, ｆｕｌｌ) — screen readers announce
those as gibberish and they break search, copy-paste and translation. Markdown is banned
too, since neither platform renders it. That rule is repeated in all three bodies on
purpose: any Skill can be selected alone, so none may depend on another being active.

**Existing installs would not have seen them.** `normalizeRecord` keeps the stored Skill
list verbatim, so new built-ins only ever reached people who found "Restore Built-ins".
Added a one-time seeding migration keyed on `SCHEMA_VERSION` (2 → 3); a Skill deleted
afterwards stays deleted.

### Verification

- 24/24 architecture tests, side-panel startup test, `verify.mjs`, `node --check` on all
  scripts. Four new regression tests, **each negative-controlled** — reverting the fix
  reproduces the exact user-facing message and fails the test.
- The end-to-end test drives the real `sidepanel.js` through a fake DOM: it advances the
  record behind the panel's back, clicks a chip, and asserts no conflict surfaces and that
  no write carries `expectedRevision`.
- `verify.mjs` now reads the schema version from `preferences.js` instead of pinning it,
  so a migration bump cannot fail an unrelated check again.
- Icon generation confirmed byte-deterministic, and CI enforces it.

**Needs your eyes:** reload at `chrome://extensions/`, click Skill chips rapidly and
confirm no error toast; check the three new Skills appear without pressing "Restore
Built-ins"; send with one and confirm the draft has no fake-bold characters.

### Repository

Published: `CONTRIBUTING.md`, MIT `LICENSE`, `CHANGELOG.md`, `.gitignore`,
`.gitattributes`, issue/PR templates, and a GitHub Actions workflow running all three test
files plus an icon-freshness check.
