# Project Context for AI Assistants

## Project Overview
LARK (LLM Article Relay Kit) is a Chrome extension that extracts webpage URLs, article text or YouTube video transcripts and sends them directly to various LLM platforms (ChatGPT, Google Gemini, Grok, Claude, Kimi, DeepSeek, Qwen, Perplexity, Poe, Mistral, HuggingChat, Copilot) with customizable prompts.

## Project Type
Chrome Browser Extension (Manifest V3)

## Tech Stack
- Vanilla JavaScript (no frameworks)
- Chrome Extension APIs (Manifest V3)
- Content Scripts for YouTube and LLM platforms
- Service Worker (background.js)
- HTML/CSS for UI

## Key Files & Architecture

### Core Extension Files
- `manifest.json` - Extension configuration, permissions, commands, and content script declarations
- `background.js` - Service worker and composition root: owns Chrome transport/storage,
  Page Intake adapters, Preferences, and Send Run coordination
- `sidepanel.html/css/js` - The side panel: the main user interaction surface. Long-lived, so it tracks tab changes (see the constraint note below).
- `options.html/css/js` - Settings page for customization
- `platforms.js` - **Single source of truth** for supported Platforms: catalog,
  exact URL matching, selectors, editor strategies, paste verification, and cursor placement
- `preferences.js` - Versioned, atomic Preferences model plus the UI runtime client;
  migrates legacy flat storage keys into the canonical `preferences` record
- `page-intake.js` - Captures pages, transcripts, selections, links, URL fallbacks,
  and Prepared Content into one canonical intake result
- `send-run.js` - Prepares prompts and owns tab-bound Delivery lifecycle, claim leases,
  retries, expiry, and cleanup
- `theme.js` - Light/dark/system theme resolution from Preferences. Loaded in `<head>`
  before the stylesheet.
- `page-text.js` - Page-text extraction shared by the side panel and the background worker (`readableTextFromPage`, `getSelectionText`).

### Content Scripts
- `youtube-extractor.js` - Injected into YouTube pages to extract video transcripts
  - Extracts transcripts using YouTube's engagement panel API
  - Adds an embedded "Send with LARK" button on YouTube video pages (theme-aware clay styling)
  - Handles YouTube SPA navigation with MutationObserver
- `llm-injector.js` - Injected into Platform pages; claims only the Delivery bound to
  its exact tab, pastes through `Platforms.paste()`, verifies, and settles the claim

### Utility Files
- `generate-icons.html` - Tool for generating extension icons
- `create-icons.js` - Icon generation logic
- `icons/` - Extension icon assets (16, 32, 48, 128 sizes)

## Core Functionality

### Content Extraction
1. **Regular Webpages**: Extracts page URL and title
2. **YouTube Videos**:
   - Extracts full video transcripts from YouTube's caption data
   - Supports manual and auto-generated captions
   - Prefers English transcripts with fallback options
   - Removes timestamps for clean text output

### LLM Integration
Supports sending content to (the Platform catalog lives in `platforms.js`):
- ChatGPT (chat.openai.com, chatgpt.com)
- Google Gemini (gemini.google.com)
- Grok (x.com/i/grok, grok.com)
- Claude (claude.ai)
- Kimi (kimi.com, www.kimi.com)
- DeepSeek (chat.deepseek.com)
- Qwen (chat.qwen.ai)
- Perplexity (perplexity.ai)
- Poe (poe.com)
- Mistral Le Chat (chat.mistral.ai)
- HuggingChat (huggingface.co/chat)
- Copilot (copilot.microsoft.com)

### User Features
- Customizable system prompts
- **Skills** — named, composable prompt modifiers that stack on top of the system prompt
  (up to 3 per send). Replaced the old prompt-template system, which overwrote the prompt
  one at a time. Defined in `skills.js`, edited on the options page.
- **Social drafts** — the `xpost`, `xthread` and `linkedin` Skills produce publishable
  drafts. Their bodies forbid markdown and Unicode look-alike letterforms (fake bold /
  italic), which screen readers announce as gibberish and which break search and
  copy-paste. Each body repeats that rule because any Skill can be used alone.
- **Article extraction** — non-YouTube pages send readable page text, not just the URL.
- **GitHub repo comparison** — compares 2-3 repos from the GitHub API against a six-axis
  rubric. Repos are picked off the GitHub page you are on, or via right-click — never
  typed. The section only appears on github.com. See `github.js`.
- Versioned Preferences export/import (Platform choices, prompt, Skills, and appearance)
- One-click extraction and sending (first LLM foreground, rest background)
- **Available Platforms** — hide the platforms you never use; Preferences filter the
  panel picker and default-Platform grid, and disabling a selected Platform reconciles
  the current selection atomically.
- **Light / dark / system theme** — sun/moon toggle in the panel header, System/Light/Dark
  control on the options page. Resolved by `theme.js` as `data-theme` on `<html>`.
- **Right-click → Send with LARK** — send the current page, a text selection, or a link
  (context menus, handled in `background.js`)
- **Browser-wide command** — `Alt+Shift+X` sends the current page to your selected LLMs
- **NEW:** Quick copy URL to clipboard button
- **NEW:** Copy content to clipboard without sending to LLM
- **NEW:** Live LLM selection counter
- **NEW:** Keyboard shortcuts (⌘/Ctrl+Enter, ⌘/Ctrl+Shift+C, ⌘/Ctrl+Shift+U)
- **NEW:** Collapsible keyboard shortcuts help section
- **NEW:** Toast notifications for user feedback
- **NEW:** Enhanced button hover effects and animations

## Project Structure
```
lark/
├── manifest.json          # Extension config (permissions, commands, content scripts)
├── sidepanel.html/css/js  # Main UI (Chrome side panel)
├── options.html/css/js    # Settings page
├── background.js          # Service worker composition root + Chrome adapters
├── platforms.js           # Platform catalog, URL matching, editor adapters
├── preferences.js         # Versioned settings model + runtime client
├── page-intake.js         # Canonical page/transcript/selection/link intake
├── send-run.js            # Exact-tab Delivery lifecycle
├── theme.js               # Light/dark/system theme resolution
├── page-text.js           # Readable page-text extraction
├── skills.js              # Skills defaults + pure message composition
├── github.js              # GitHub repo comparison + on-page repo scan + basket
├── youtube-extractor.js   # YouTube transcript extraction
├── llm-injector.js        # LLM content injection
├── architecture-tests.mjs # Domain-module regression tests
├── verify.mjs             # Manifest + service-worker integration checks
├── generate-icons.html    # Visual preview of the mark (not the generator)
├── create-icons.js        # Rasterises icons/lark.svg into the four PNGs
├── icons/
│   ├── lark.svg           # MASTER mark — the only place the geometry lives
│   ├── icon16.png         # generated
│   ├── icon32.png         # generated
│   ├── icon48.png         # generated
│   └── icon128.png        # generated
└── README.md              # User documentation
```

## Brand

**LARK** — *LLM Article Relay Kit*. The mark is a lark in flight: a clay `#B85C38`
silhouette on a warm-paper `#F0EEE6` squircle, wings swept up, short tail.

The geometry lives in `icons/lark.svg` and nowhere else. `node create-icons.js` parses
the `d` attribute out of it and rasterises the four PNGs plus the per-size SVGs (pure
JS, 4×4 supersampled, no dependencies — keeps the no-build-tools rule). The same path
string is inlined in three UI surfaces as `currentColor`: the panel header, the options
header, and the YouTube button. **Change the SVG, re-run the generator, then update
those three inline copies.**

## Permissions Required
- `activeTab` - Access current tab's URL
- `storage` - Save user settings locally
- `scripting` - Inject content scripts
- `tabs` - Query and update tabs
- `contextMenus` - Right-click "Send with LARK" menu
- `sidePanel` - The main UI surface
- Host permissions for YouTube, all supported LLM platforms, and `github.com`
- `<all_urls>` — **required by the side panel, not optional.** `activeTab` only grants
  access to the tab the extension was *invoked* on. The panel stays open while you browse
  to other tabs, and it gets no grant for those, so page-text extraction and the GitHub
  repo scan would silently fail on every tab except the one you opened the panel from.
  This was not needed while the UI was a popup, which only ever saw one tab.

## Development Notes

### YouTube Transcript Extraction
- Uses YouTube's internal engagement panel API
- Watches for SPA navigation changes with MutationObserver
- Adds an embedded button directly on YouTube video pages
- Handles various caption formats and language preferences

### Content Script Injection
- Content scripts are declaratively registered in manifest.json
- YouTube extractor runs at document_end on YouTube URLs
- LLM injector runs at document_end on all LLM platform URLs
- Communication between the side panel and content scripts via chrome.runtime messaging

### Storage
- Uses chrome.storage.local for user settings (NOT storage.sync — an earlier version of
  this file claimed sync; the code has always used local)
- Preferences are one versioned `preferences` record containing Platform choices, the
  system prompt, Skills, and appearance. `preferences.js` migrates and removes the old
  flat keys on first read; all writes are validated and replace the record atomically.
- Send Runs are ephemeral records in `chrome.storage.session`, keyed by run ID. They
  contain exact tab IDs, claim leases, retry counts, and expiry times. They are never a
  global "next Platform tab" clipboard and are removed when terminal or expired.
- `compareBasket` is `[{owner, name}]`, capped at 3.
- Settings export/import uses the canonical versioned Preferences document.

## Common Tasks

### Adding a New LLM Platform
1. Add one definition to `DEFINITIONS` in `platforms.js` (id, name, URL, colour, exact
   hosts, editor kind, selectors). The panel and options grids derive from it.
2. Add host permission + content script match to manifest.json
3. Reuse an existing editor adapter or add one inside `platforms.js`; do not add hostname
   branches to `llm-injector.js`.
4. Add URL matching and paste-verification cases to `architecture-tests.mjs`. No static
   Platform card is needed.

### Modifying Transcript Extraction
- Edit youtube-extractor.js
- Main function: `extractTranscript()`
- Consider YouTube's SPA navigation and DOM changes

### Updating UI/Styles
- sidepanel.html/css - Main extension UI
- options.html/css - Settings page
- Both use the warm-paper/clay token system with light + dark variants. Light tokens
  live in `:root`, the system dark variant in the `prefers-color-scheme` block, and the
  forced variants in `html[data-theme="light"/"dark"]` blocks (which must stay in sync).
  Do not lighten `--ink-muted` below its audited AA contrast.

### Testing
1. Run `node architecture-tests.mjs` for Preferences, Page Intake, Platform, and Send Run
   behavior (including concurrent runs and claim expiry).
2. Run `node sidepanel-startup-test.mjs` to ensure initialization reaches the active tab
   and replaces the `Loading...` placeholder.
3. Run `node verify.mjs` for manifest/script order and background runtime integration.
4. Load the unpacked extension from chrome://extensions/.
5. Test a captioned YouTube video and content injection on each live Platform; their DOMs
   are third-party surfaces and can change independently of the extension.
6. Verify settings migration/persistence, both themes, and the browser-wide command.

## Known Considerations

### YouTube Specifics
- YouTube is a Single Page Application (SPA)
- Need to watch for URL changes with MutationObserver
- Caption availability varies by video
- Auto-generated captions may not always be available

### LLM Platform Variations
- Each LLM platform has different DOM structures
- Content injection methods may need platform-specific handling
- Login states can affect content injection success

### Browser Extension Limitations
- Manifest V3 requires service workers (not background pages)
- Content scripts run in isolated contexts
- Need explicit host permissions for each domain

### Send Runs and tab opening go through the service worker, always
The service worker is the single composition root for sending. A caller submits a content
intent to `sendRun.start`; the worker reads one Preferences snapshot, captures Page Intake,
composes once, creates the selected Platform tabs, and records a Delivery for each exact
tab ID in `chrome.storage.session`.

`llm-injector.js` cannot consume a generic pending prompt. It must claim a Delivery using
its sender tab ID and matched Platform, then settle a random, leased claim token after the
shared Platform adapter verifies the paste. Unrelated tabs receive no content, concurrent
runs remain distinct, expired runs are removed, and terminal runs leave no payload behind.

`verify.mjs` guards the runtime boundary and `architecture-tests.mjs` covers exact-tab
claims, concurrent runs, claim expiry, bounded retries, and cleanup. Keep UI modules and
content scripts free of direct `chrome.tabs.create` and delivery storage writes.

### Ordinary Preferences writes must not send `expectedRevision`
A write is several service-worker round-trips. Sending an expected revision meant that
anything else writing in that window — the Options page, a theme toggle, a background
task — turned a plain Skill-chip click into "Preferences changed before this update could
be saved."

`update()` merges section by section, so a Skill toggle and a concurrent theme change
compose by construction. Optimistic locking is kept only for `replace()` (importing
Preferences), where the whole document is swapped and clobbering is real.

Two related invariants:
- `createPreferencesClient` only ever hands out **strictly newer** snapshots. Change
  events are asynchronous and a context hears its own writes, so a snapshot for revision N
  can arrive after the caller holds N+1; replaying it walked state backwards and made the
  next write look like a conflict. That is what made the error self-sustaining.
- Built-in Skills added in a later version reach existing installs through a one-time
  migration keyed on `SCHEMA_VERSION`, because `normalizeRecord` keeps the stored Skill
  list verbatim. Bump `SCHEMA_VERSION` when adding one. A Skill the user deletes
  afterwards stays deleted.

`architecture-tests.mjs` and `sidepanel-startup-test.mjs` cover all three.

### The side panel is long-lived — nothing may cache the active tab
This is now the most important constraint in the UI code. The panel stays open while the
user browses, so `sidepanel.js` re-reads the tab in `refreshForTab()` on
`chrome.tabs.onActivated` and `chrome.tabs.onUpdated`, scoped to the panel's own window.
Any new page-specific feature must render from `refreshForTab()`, not from a one-shot read
at start-up.

Corollary that already bit once: state used by `refreshForTab()` must be **declared at the
top of the module**, not further down beside its feature section. Start-up calls
`refreshForTab()` before those later `let`s initialise, and a `let` in the temporal dead
zone throws.

### The GitHub comparison never types a URL
Repos are picked, never entered. Two paths, both avoiding injected UI on GitHub's pages:
1. `githubReposOnPage()` in `github.js` is injected with `chrome.scripting.executeScript`
   and returns the repos linked on the current page. It is **serialised into the page**, so
   it must stay entirely self-contained — no reference to anything in `github.js` scope.
   It carries its own copy of the reserved-owner list for that reason; keep it in sync with
   `RESERVED_REPO_OWNERS`.
2. Right-click → "Add to LARK comparison" (`background.js`), scoped to github.com.

Both fill `compareBasket`. Star counts shown beside candidates are scraped from the page as
a *picking hint only* — every figure in the actual comparison comes from the GitHub API.
Keep that line: a scraper feeding the payload is what killed transcript extraction.

Reserved-owner filtering is not optional. GitHub's logged-out marketing nav is full of
two-segment paths (`/solutions/use-case`, `/resources/articles`, `/topics/javascript`) that
`parseRepoInput` will happily read as `owner/name`.

## Future Enhancement Ideas
- Support for more LLM platforms
- Batch processing of multiple videos
- Transcript timestamp preservation option
- Custom extraction rules per website
- Integration with local LLM APIs

## Style Guidelines
- Light/dark/system theme in the warm-paper + clay design language (serif display,
  hairline rules, no gradients or glow)
- Clean, minimal interface design
- Consistent button and form styling
- Responsive layout — the side panel is user-resizable, so nothing may assume a fixed width

## Code Patterns Used
- Message passing between the side panel, content scripts and the service worker
- Promise-based async operations
- MutationObserver for DOM watching
- Chrome storage API for persistence
- Skill-based prompt composition (`composeMessage` in `skills.js`)

## Recent Improvements (2026-01)
1. **Copy to Clipboard Features**
   - Added copy URL button next to page URL display
   - Added copy content button (copies transcript/URL with system prompt)
   - Both use modern clipboard API with toast notifications

2. **Enhanced UX**
   - Live counter showing number of selected LLMs
   - Counter highlights when LLMs are selected
   - Toast notifications for user feedback (auto-dismiss after 3s)

3. **Keyboard Shortcuts**
   - ⌘/Ctrl + Enter: Extract and send to LLMs
   - ⌘/Ctrl + Shift + C: Copy content to clipboard
   - ⌘/Ctrl + Shift + U: Copy URL to clipboard
   - Collapsible help section showing all shortcuts

4. **Visual Improvements**
   - Keyboard hint badge on main action button
   - Improved button layouts and spacing
   - Better hover states and animations
   - Copy button next to URL for quick access

## When Working on This Project
1. Test changes by reloading the extension at chrome://extensions/
2. Check browser console for content script errors
3. Verify permissions are granted in manifest.json
4. Test on actual YouTube videos and LLM platforms
5. Ensure backwards compatibility with saved settings
6. Maintain the warm-paper/clay theme token system (light, dark and forced `data-theme`
   variants must stay in sync)
7. Follow the vanilla JS pattern (no build tools/frameworks)
8. Test keyboard shortcuts on both Mac and Windows
9. Verify clipboard operations work correctly
