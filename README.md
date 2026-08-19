# LARK

**L**LM **A**rticle **R**elay **K**it.

A Chrome extension that extracts webpage content — article text, page URLs, or YouTube
video transcripts — and sends it straight to your favorite LLM with customizable prompts.
Paste into the LLM's own web UI, so your existing logins and subscriptions just work.

## ✨ Features

### Core Functionality
- **Smart Page Detection** — knows whether you're on a regular webpage or a YouTube video
- **Article extraction** — non-YouTube pages send readable page text, not just the URL
- **YouTube Transcript Extraction** — full transcripts via YouTube's transcript panel
- **12 LLM platforms** — ChatGPT, Gemini, Claude, Grok, DeepSeek, Kimi, Qwen, Perplexity,
  Poe, Mistral Le Chat, HuggingChat, Copilot — send to several at once
- **Skills** — named, composable prompt modifiers that stack on top of your system prompt
  (up to 3 per send), fully editable in Settings
- **Social drafts** — *X Post*, *X Thread* and *LinkedIn Post* Skills turn whatever you are
  reading into a publishable draft. They write **plain text**: no markdown, and no
  Unicode look-alike letters for fake bold or italics — screen readers announce those as
  gibberish and they break search, copy-paste and translation. Ordinary Unicode
  punctuation (→ • — “ ” …) is used where it earns its place.
- **Custom System Prompts** — define what the model should do with the content
- **Choose your platforms** — hide the ones you never use in Settings → Available Platforms
- **GitHub repo comparison** — on any GitHub page, LARK lists the repos it finds there;
  click to queue 2–3 (or right-click any repo link → *Add to LARK comparison*), then send
  them to your LLMs judged against a six-axis rubric. No URLs to copy, ever. The queue
  survives while you browse between repos.
- **Copy to clipboard** — copy the composed content or just the URL

### New Ways to Send
- **Right-click → Send with LARK** — send the current page, a text selection, or a link
  without opening the panel
- **Browser-wide shortcut** — `Alt+Shift+X` extracts the current page and sends it to
  your selected LLMs from anywhere
- **YouTube embedded button** — a "Send with LARK" button right on the video page

### Appearance
- **Light, dark, or system theme** — toggle light/dark from the panel header, or pick
  System/Light/Dark in Settings (warm paper + clay design language)
- **Keyboard shortcuts** — ⌘/Ctrl+Enter (extract & send), ⌘/Ctrl+Shift+C (copy content),
  ⌘/Ctrl+Shift+U (copy URL), Alt+Shift+X (browser-wide send)
- Toast notifications, live selection counter, progress bar, reduced-motion support

## 🚀 Installation

1. Open Chrome and go to `chrome://extensions/`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** and select this folder (the one containing `manifest.json`)
4. Pin the extension from the puzzle-piece menu for quick access

## 📖 Usage

### Side panel
1. Click the extension icon — LARK opens as a side panel and **stays open while you browse**
2. Navigate to any webpage or YouTube video; the panel keeps up with the tab you're on
3. Tick the LLM(s) you want (ChatGPT is preselected on first run)
4. Optionally add Skills, then click **Extract & Send** (or press ⌘/Ctrl+Enter)

The first LLM opens in the foreground; the rest open in the background and the content
is pasted into each.

### Comparing GitHub repos
1. Open any GitHub page — a repo, search results, trending, a profile, or an awesome-list
   README. The panel lists the repos it found there, with star counts.
2. Click **+** on two or three of them. Or right-click any repo link anywhere and choose
   **Add to LARK comparison** — the toolbar badge shows how many are queued.
3. The queue persists, so you can browse from repo to repo adding as you go.
4. Optionally say what you need it for — it changes the verdict — then **Compare & Send**.

Every figure in the comparison is read from the GitHub API, not scraped from the page.
Unauthenticated that's 60 requests/hour, roughly 6–7 comparisons; it fails loudly with the
reset time rather than degrading.

### Right-click menu
- **Send this page** — sends readable article text (falls back to the URL)
- **Send selection** — sends exactly the text you highlighted
- **Send this link** — sends the link itself

### Keyboard command
Press `Alt+Shift+X` anywhere to send the current page to your selected LLMs. You can
remap it at `chrome://extensions/shortcuts`.

## ⚙️ Settings (options page)

- **Appearance** — System / Light / Dark theme
- **Available Platforms** — tick only the platforms you actually use; the rest disappear
  from the panel and from the default-platform list
- **Default LLM Platform** — used by the YouTube button and the browser-wide shortcut
- **System Prompt** — the instruction prepended to every send (with character count)
- **Skills** — add, rename, edit, delete, reset, or restore the built-in skills
- **Export / Import** — all settings as a JSON file

## 🔧 Troubleshooting

### Transcript not available
- The video may have no captions, or YouTube may have served the retired legacy panel —
  the error message tells you which, and reloading the page or opening the transcript
  manually first can help.

### Content not pasting
- Make sure you're logged into the LLM platform
- The injection waits for the chat input to appear; give it a few seconds
- Reload the extension from `chrome://extensions/` after updating
- A Send Run is bound to the exact tabs LARK opens. Opening an AI site later will not
  reuse or paste content from an earlier run.

## 📁 File Structure

```
├── manifest.json          # Extension config (permissions, commands, content scripts)
├── sidepanel.html/css/js  # Main UI (Chrome side panel)
├── options.html/css/js    # Settings page
├── background.js          # Service worker: runtime coordination and browser adapters
├── platforms.js           # Platform catalog, URL matching, and editor adapters
├── preferences.js         # Versioned settings model, migration, and runtime client
├── page-intake.js         # Page/selection/link/transcript capture policy
├── send-run.js            # Exact-tab delivery lifecycle, leases, and cleanup
├── theme.js               # Light/dark/system theme resolution
├── page-text.js           # Readable page-text extraction
├── skills.js              # Skills defaults + pure message composition
├── github.js              # GitHub comparison + on-page repo scan
├── youtube-extractor.js   # YouTube transcript extraction + embedded button
├── llm-injector.js        # Pastes content into each LLM's chat input
├── architecture-tests.mjs # Domain-module regression tests
├── sidepanel-startup-test.mjs # Side-panel initialization regression test
├── verify.mjs             # Manifest and runtime integration checks
├── generate-icons.html    # Icon generator tool
├── create-icons.js        # Rasterises icons/lark.svg into the PNGs
├── icons/                 # lark.svg master + generated PNGs (16/32/48/128)
└── README.md              # This file
```

## 🔒 Permissions

- **activeTab** — access the current tab (article extraction on user gesture)
- **storage** — save settings locally
- **scripting** — inject content scripts
- **tabs** — query and open tabs
- **contextMenus** — the right-click "Send with LARK" menu
- **sidePanel** — the main UI surface
- **Host permissions** — YouTube, the 12 LLM platforms, GitHub and the GitHub API
- **All sites** — needed because the side panel stays open while you browse. `activeTab`
  only covers the tab you opened the panel from, so without this, reading the page and
  finding repos would fail on every other tab.

## 📄 License

MIT License — feel free to use and modify as needed.
