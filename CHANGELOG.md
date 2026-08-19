# Changelog

All notable changes to LARK are recorded here. Versions match `manifest.json`.

## 1.4.0

### Fixed
- **Selecting a Skill reported "Preferences changed before this update could be saved."**
  Ordinary settings writes were using optimistic locking. A write is several service-worker
  round-trips, so anything else writing in that window — a theme change, the Options page,
  a background task — turned a plain chip click into a hard error. Ordinary writes now
  merge section by section, which is what they always meant to do; optimistic locking is
  kept for importing settings, where replacing the whole document really can clobber work.
- **Settings snapshots could move backwards.** Change events are delivered asynchronously
  and a page also hears its own writes, so a snapshot for revision N could arrive after the
  page already held N+1. Replaying it walked the page's state backwards and made the next
  write look like a conflict — which is what made the error above self-sustaining once it
  started. The client now only ever hands out strictly newer snapshots.

### Added
- **X Post, X Thread and LinkedIn Post Skills.** Turn whatever you are reading into a
  publishable draft. They write plain text on purpose: no markdown, and no Unicode
  look-alike letters for fake bold or italics — screen readers announce those as gibberish
  and they break search, copy-paste and translation. Ordinary Unicode punctuation is used
  where it earns its place.
- Newly shipped built-in Skills now reach existing installs through a one-time migration.
  Previously they only appeared for people who found "Restore Built-ins" in Settings.
- Contributor setup: `CONTRIBUTING.md`, MIT `LICENSE`, issue and pull-request templates,
  and a GitHub Actions workflow running all three test files plus an icon-freshness check.

### Internal
- Four new regression tests, each checked against the old code to confirm it fails there:
  the snapshot-ordering guard, concurrent section merges, the Skill-seeding migration, and
  an end-to-end Skill click through the real side-panel code.
- `verify.mjs` reads the settings schema version from the source instead of pinning it.

## 1.3.0

### Added
- **The popup became a side panel.** It stays open while you browse instead of vanishing
  the moment you click anything, and it keeps up with whichever tab you are on.
- **GitHub comparison without typing.** On any GitHub page LARK lists the repos it finds
  there; click to queue two or three, or right-click any repo link → *Add to LARK
  comparison*. The queue survives while you browse between repos. No URLs to copy.
- **Available Platforms** in Settings — hide the AI platforms you never use.

### Changed
- `<all_urls>` is now required. `activeTab` only covers the tab the extension was invoked
  on, so a panel that stays open while you browse could not read any other tab without it.

## 1.2.0

### Changed
- Renamed to **LARK** (LLM Article Relay Kit), with a new lark-in-flight mark generated
  from a single master SVG.

### Fixed
- **Selecting several AI platforms only ever opened the first one.** The popup ran the
  open-a-tab-per-platform loop itself, and creating the first foreground tab moved focus
  off the popup, so Chrome destroyed the popup document mid-loop. Tab opening now happens
  in the service worker, which outlives the popup.
