# Contributing to LARK

Thanks for looking. LARK is a Chrome extension that grabs the page, article or YouTube
transcript you are on and drops it into as many AI chats as you like. It is deliberately
small: **vanilla JavaScript, no build step, no dependencies.** You can clone it, load it
and be editing the real thing in about a minute.

## Getting set up

```bash
git clone https://github.com/<owner>/lark.git
cd lark
```

1. Open `chrome://extensions/`
2. Turn on **Developer mode** (top right)
3. **Load unpacked** → pick the folder containing `manifest.json`
4. Pin LARK, click the icon — it opens as a side panel

After any change: hit the reload arrow on the LARK card at `chrome://extensions/`. Editing
`sidepanel.*` or `options.*` only needs the page reopened; changing `background.js` or a
content script needs the extension reloaded.

There is nothing to install. No `npm install`, no bundler, no transpiler. Node is used
only to run the tests, and only the standard library.

## Running the tests

```bash
node architecture-tests.mjs      # domain modules: Preferences, Page Intake, Platforms, Send Run
node sidepanel-startup-test.mjs  # the panel boots and a Skill click does not error
node verify.mjs                  # manifest wiring + the real worker over its message interface
```

All three must pass before you open a pull request. They are fast (a second or two) and
need no network. `node --check <file>` on anything you touched is a good habit too.

If you change the icon, re-run `node create-icons.js` — it rasterises `icons/lark.svg`
into the four PNGs.

## How this codebase is organised

Behaviour lives in small modules that are testable without a browser. Each takes its
Chrome dependencies as adapters, so tests hand them in-memory fakes.

| File | Owns |
|---|---|
| `platforms.js` | The catalog of AI platforms: URL matching, editor selectors, paste + verification |
| `preferences.js` | The versioned settings record, migrations, and the client used by pages |
| `page-intake.js` | Deciding what "the content" is: article, transcript, selection, link, URL |
| `send-run.js` | The delivery lifecycle: which tab gets which payload, leases, retries, cleanup |
| `skills.js` | Skill definitions and message composition |
| `github.js` | Repo comparison, the on-page repo scan, and the comparison basket |
| `background.js` | The composition root: owns the Chrome APIs and wires the modules together |

`sidepanel.js`, `options.js` and the content scripts are **surfaces**. They render and
collect input; they do not own rules. If you find yourself putting a decision in a
surface, it probably belongs in a module.

## Rules worth knowing before you change things

These are not style preferences. Each one is here because breaking it caused a real bug.

**Tab opening goes through the service worker.** `openTabs()` in `background.js` is the
only place tabs are created. Content scripts cannot call `chrome.tabs`, and `window.open`
is popup-blocked after the first call. `verify.mjs` fails if `sidepanel.js` calls
`chrome.tabs.create`.

**The side panel is long-lived — never cache the active tab.** It stays open while the
user browses. Anything page-specific must render from `refreshForTab()`, which re-runs on
tab switches and navigations. State that `refreshForTab()` touches must be declared at the
top of the module, or start-up hits the temporal dead zone.

**Ordinary settings writes must not send `expectedRevision`.** A write is several worker
round-trips; anything else writing in that window would turn a plain click into
"Preferences changed before this update could be saved." Optimistic locking is kept for
importing settings, where replacing the whole document really can clobber someone's work.

**Never let scraped values into a payload.** The GitHub comparison reads the page only to
learn *which* repos you are looking at. Every figure in the comparison comes from the API.
Star counts shown while picking are a hint and nothing more. A scraper feeding the payload
is what killed transcript extraction once already.

**Keep colour tokens in sync.** `sidepanel.css` and `options.css` each define the palette
four times: `:root`, the `prefers-color-scheme` block, and both `html[data-theme]` blocks.
Change one, change all four. Contrast was audited on the rendered page — do not lighten
`--ink-muted`.

## Adding an AI platform

1. Add one entry to `DEFINITIONS` in `platforms.js` — id, name, URL, colour, exact hosts,
   editor kind, selectors. The panel and options grids derive from it.
2. Add the host permission and the content-script match in `manifest.json`.
3. Reuse an existing editor adapter, or add one inside `platforms.js`. Do **not** add
   hostname branches to `llm-injector.js`.
4. Add URL-matching and paste-verification cases to `architecture-tests.mjs`.

`verify.mjs` will tell you if you missed the manifest half.

## Adding a Skill

Skills are prompt fragments in `DEFAULT_SKILLS` in `skills.js` — `{ id, name, body }`.
Users can edit them, so write the body as a clear instruction rather than something that
depends on another Skill being active. Existing installs pick up newly shipped Skills
through a one-time migration keyed on `SCHEMA_VERSION` in `preferences.js`; bump it if you
add one, and add a case to `architecture-tests.mjs`.

## Pull requests

- One change per PR, with a short description of the behaviour before and after.
- Say how you verified it. "All three test files pass" plus what you clicked in the
  browser is ideal.
- Add a test when you fix a bug. A regression test that does not fail against the old
  code is not a regression test — check it both ways.
- Keep the existing voice in comments: explain *why*, not what the line does.
- Anything needing a logged-in AI account or a real YouTube video cannot be automated.
  Say plainly what you checked by hand and what you did not.

## Reporting bugs

Open an issue with:

- What you did, what you expected, what happened
- Your Chrome version and OS
- The page you were on, if it matters (a YouTube URL, a GitHub page)
- Anything in the console: right-click the panel → Inspect, and for the worker use the
  "service worker" link on the LARK card at `chrome://extensions/`

Transcript problems are worth flagging specially: YouTube runs more than one transcript
panel implementation and one of them cannot be read at all. The error message says which
one you hit.

## Scope

LARK pastes into the AI platforms' own web UIs on purpose, rather than calling their APIs.
That is what makes it free to fan out to a dozen vendors on subscriptions you already pay
for. The consequence is that LARK can never read the reply — so features that depend on
reading model output (summarise-in-panel, chaining, saved answers) are out of scope by
design, not by omission.

## Code of conduct

Be decent. Assume good faith, keep criticism about the code, and take the hint if someone
asks you to drop something.
