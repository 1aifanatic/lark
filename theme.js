// theme.js — user-controlled light / dark / system theme.
//
// Shared by the side panel and the options page. The durable choice belongs to the
// Preferences module; this file only resolves and applies the effective appearance.
//
// Must be loaded in <head> (before the stylesheet paints) so the first frame is
// already correct. It applies the stored preference as soon as storage answers and
// the system default immediately, so there is no flash either way.

const THEME_PREFS = ['system', 'light', 'dark'];
const themePreferences = Lark.createPreferencesClient({
  runtime: chrome.runtime,
  storageChanges: chrome.storage.onChanged,
});

function systemTheme() {
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

// Applies the effective theme to the document. Returns the effective theme.
function applyTheme(pref) {
  const effective = pref === 'light' || pref === 'dark' ? pref : systemTheme();
  document.documentElement.setAttribute('data-theme', effective);
  return effective;
}

async function getThemePref() {
  const snapshot = await themePreferences.read();
  return THEME_PREFS.includes(snapshot.appearance.theme) ? snapshot.appearance.theme : 'system';
}

async function setThemePref(pref) {
  if (!THEME_PREFS.includes(pref)) pref = 'system';
  // Last writer wins on the appearance section; no read-then-check round trip, which
  // was itself a window for a spurious conflict.
  const next = await themePreferences.update({ appearance: { theme: pref } });
  applyTheme(next.appearance.theme);
  return next.appearance.theme;
}

// Kick off theme resolution. Call from a script in <head>.
function initTheme() {
  // Default (system) applies synchronously — no flash before storage answers.
  applyTheme('system');
  getThemePref().then(applyTheme);

  // Follow live OS changes while the user has not pinned a mode.
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      getThemePref().then(pref => { if (pref === 'system') applyTheme('system'); });
    });
  }

  themePreferences.observe(snapshot => applyTheme(snapshot.appearance.theme));
}

initTheme();
