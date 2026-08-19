// Structural and runtime integration verification for LARK.
// Usage: node verify.mjs

import fs from 'node:fs';
import vm from 'node:vm';

let failures = 0;
const fail = message => { console.log('FAIL: ' + message); failures++; };

const files = [
  'platforms.js', 'preferences.js', 'page-intake.js', 'send-run.js',
  'theme.js', 'page-text.js', 'skills.js', 'github.js',
  'sidepanel.js', 'options.js', 'background.js', 'llm-injector.js',
  'youtube-extractor.js',
];

// 1. Every DOM id used by a page script exists in its HTML.
function idsInHtml(file) {
  const html = fs.readFileSync(file, 'utf8');
  return new Set([...html.matchAll(/id="([^"]+)"/g)].map(match => match[1]));
}
function idsUsedInJs(file) {
  const source = fs.readFileSync(file, 'utf8');
  return new Set([...source.matchAll(/getElementById\('([^']+)'\)/g)].map(match => match[1]));
}
for (const [html, script] of [['sidepanel.html', 'sidepanel.js'], ['options.html', 'options.js']]) {
  const ids = idsInHtml(html);
  for (const id of idsUsedInJs(script)) {
    if (!ids.has(id)) fail(`${script} uses missing #${id} in ${html}`);
  }
}

// 2. Declared files exist and module ordering preserves plain-script dependencies.
for (const file of files) if (!fs.existsSync(file)) fail(`missing file ${file}`);
const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
const sidepanelHtml = fs.readFileSync('sidepanel.html', 'utf8');
const optionsHtml = fs.readFileSync('options.html', 'utf8');
const backgroundSource = fs.readFileSync('background.js', 'utf8');
const injectorSource = fs.readFileSync('llm-injector.js', 'utf8');
const panelSource = fs.readFileSync('sidepanel.js', 'utf8');

function appearsBefore(text, first, second) {
  return text.indexOf(first) >= 0 && text.indexOf(first) < text.indexOf(second);
}
if (!appearsBefore(sidepanelHtml, 'preferences.js', 'theme.js')) fail('side panel loads theme before Preferences');
if (!appearsBefore(optionsHtml, 'preferences.js', 'theme.js')) fail('options loads theme before Preferences');
if (!appearsBefore(sidepanelHtml, 'platforms.js', 'sidepanel.js')) fail('side panel loads caller before Platform');
if (!appearsBefore(sidepanelHtml, 'send-run.js', 'sidepanel.js')) fail('side panel loads caller before Send Run client');
if (!appearsBefore(sidepanelHtml, 'skills.js', 'sidepanel.js')) fail('side panel loads caller before Skills constants');
if (!optionsHtml.includes('id="defaultPlatformGrid"')) fail('options lacks the dynamic default Platform grid');
if (/data-llm=/.test(optionsHtml)) fail('options duplicates static Platform cards');
if (fs.existsSync('llms.js')) fail('retired llms.js still exists');

const youtubeScripts = manifest.content_scripts.find(entry => entry.matches.some(match => match.includes('youtube.com')))?.js || [];
const platformScripts = manifest.content_scripts.find(entry => entry.matches.some(match => match.includes('chatgpt.com')))?.js || [];
if (youtubeScripts.join('|') !== 'send-run.js|youtube-extractor.js') {
  fail('YouTube content-script order must be send-run.js then youtube-extractor.js');
}
if (platformScripts.join('|') !== 'platforms.js|send-run.js|llm-injector.js') {
  fail('Platform content-script order must be platforms.js, send-run.js, llm-injector.js');
}

// 3. The Platform interface, not source parsing, drives static manifest verification.
const platformSandbox = { URL, console, setTimeout, clearTimeout };
platformSandbox.globalThis = platformSandbox;
vm.runInNewContext(fs.readFileSync('platforms.js', 'utf8'), platformSandbox, { filename: 'platforms.js' });
const catalog = platformSandbox.Lark.Platforms.list();
const hostPermissions = manifest.host_permissions.join('\n');
const platformMatches = manifest.content_scripts
  .flatMap(entry => entry.js.includes('llm-injector.js') ? entry.matches : [])
  .join('\n');
for (const platform of catalog) {
  const host = new URL(platform.url).hostname.replace(/^www\./, '');
  if (!hostPermissions.includes(host)) fail(`manifest has no host permission for ${platform.id}`);
  if (!platformMatches.includes(host)) fail(`manifest has no injector match for ${platform.id}`);
}
if (catalog.length !== 12) fail(`expected 12 Platforms, found ${catalog.length}`);

// 4. Architecture guardrails: callers use interfaces; obsolete protocols stay gone.
if (!backgroundSource.includes("'sendRun.start'")) fail('background does not route the Send Run interface');
if (!backgroundSource.includes("'preferences.update'")) fail('background does not route the Preferences interface');
if (!panelSource.includes('sendRunClient.start')) fail('side panel bypasses the Send Run interface');
if (!panelSource.includes('prefsClient.update')) fail('side panel bypasses the Preferences interface');
if (!injectorSource.includes('sendRunClient.claim')) fail('injector does not claim a tab-bound Delivery');
if (!injectorSource.includes('Lark.Platforms.paste')) fail('injector bypasses Platform adapters');

const activeSources = files.map(file => fs.readFileSync(file, 'utf8')).join('\n');
for (const obsolete of ['targetLLM', "action: 'openTabs'", "action: 'ackPendingInjection'", "action: 'injectContent'"]) {
  if (activeSources.includes(obsolete)) fail(`obsolete protocol remains: ${obsolete}`);
}
if (/chrome\.storage\.local\.(get|set)/.test(panelSource)) fail('side panel accesses Preferences storage directly');
if (/chrome\.storage\.local\.(get|set)/.test(fs.readFileSync('options.js', 'utf8'))) fail('options accesses Preferences storage directly');
if (/hostname\.includes/.test(injectorSource)) fail('injector still owns hostname decision branches');
if (/chrome\.tabs\.create|window\.open/.test(panelSource)) fail('side panel opens Platform tabs directly');

// Long-lived panel and GitHub constraints remain load-bearing.
if (!manifest.permissions.includes('sidePanel')) fail('manifest lacks sidePanel permission');
if (manifest.side_panel?.default_path !== 'sidepanel.html') fail('manifest side-panel path is wrong');
if (!backgroundSource.includes('setPanelBehavior')) fail('toolbar action does not open the side panel');
if (!panelSource.includes('chrome.tabs.onActivated')) fail('side panel does not track tab switches');
if (!panelSource.includes('chrome.tabs.onUpdated')) fail('side panel does not track navigation');
if (!hostPermissions.includes('github.com')) fail('GitHub scan has no host permission');

const githubSource = fs.readFileSync('github.js', 'utf8');
const scanStart = githubSource.indexOf('function githubReposOnPage');
const scanEnd = githubSource.indexOf('\nasync function ghFetch', scanStart);
const injectedScan = githubSource.slice(scanStart, scanEnd > 0 ? scanEnd : undefined);
if (/\bMAX_REPOS\b|\bGITHUB_API\b|\bRESERVED_REPO_OWNERS\b|\bparseRepoInput\b/.test(injectedScan)) {
  fail('githubReposOnPage closes over module scope and cannot be serialized');
}

// 5. Run the real background worker through its runtime interface.
{
  const createdTabs = [];
  const runtimeListeners = [];
  const localData = {};
  const sessionData = {};
  const noopEvent = () => ({ addListener() {}, removeListener() {} });
  const storageArea = data => ({
    async get(keys) {
      if (keys == null) return structuredClone(data);
      const list = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(list.filter(key => key in data).map(key => [key, structuredClone(data[key])]));
    },
    async set(values) { Object.assign(data, structuredClone(values)); },
    async remove(keys) { for (const key of (Array.isArray(keys) ? keys : [keys])) delete data[key]; },
  });

  const sandbox = {
    console: { log() {}, error() {} },
    URL, fetch, structuredClone, setTimeout, clearTimeout,
    importScripts(...names) {
      for (const name of names) vm.runInContext(fs.readFileSync(name, 'utf8'), context, { filename: name });
    },
    chrome: {
      runtime: { onMessage: { addListener: listener => runtimeListeners.push(listener) }, onInstalled: noopEvent() },
      contextMenus: { onClicked: noopEvent(), removeAll() {}, create() {} },
      commands: { onCommand: noopEvent() },
      storage: { local: storageArea(localData), session: storageArea(sessionData), onChanged: noopEvent() },
      scripting: { executeScript: async () => [{ result: null }] },
      sidePanel: { setPanelBehavior: async () => {} },
      action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
      windows: { getCurrent: async () => ({ id: 1 }), WINDOW_ID_CURRENT: -2 },
      tabs: {
        create: async options => {
          const tab = { id: 100 + createdTabs.length, ...options };
          createdTabs.push(tab);
          return tab;
        },
        get: async id => createdTabs.find(tab => tab.id === id),
        query: async () => [],
        sendMessage: async () => ({}),
      },
    },
  };
  const context = vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync('background.js', 'utf8'), context, { filename: 'background.js' });

  const request = (message, sender = {}) => new Promise((resolve, reject) => {
    const handled = runtimeListeners[0](message, sender, resolve);
    if (handled !== true) reject(new Error(`runtime action was not handled: ${message.action}`));
  });

  // Read the expected schema version out of the module rather than pinning it here,
  // so bumping it for a migration does not silently fail an unrelated check.
  const expectedSchemaVersion = Number(
    (fs.readFileSync('preferences.js', 'utf8').match(/SCHEMA_VERSION\s*=\s*(\d+)/) || [])[1]
  );
  if (!expectedSchemaVersion) fail('could not read SCHEMA_VERSION from preferences.js');

  const initialPreferences = await request({ action: 'preferences.read' });
  if (!initialPreferences.ok || initialPreferences.value?.schemaVersion !== expectedSchemaVersion) {
    fail('Preferences runtime interface did not return the canonical record');
  } else {
    const changedPreferences = await request({
      action: 'preferences.update',
      patch: { appearance: { theme: 'dark' } },
      options: { expectedRevision: initialPreferences.value.revision },
    });
    if (!changedPreferences.ok || changedPreferences.value?.appearance?.theme !== 'dark') {
      fail('Preferences runtime interface did not save an atomic update');
    }
  }

  const started = await request({
    action: 'sendRun.start',
    intent: { kind: 'prepared', body: 'Known facts', contentLabel: 'Content', displayLabel: 'content' },
    options: { platformIds: ['chatgpt', 'gemini', 'claude', 'perplexity'] },
  });
  if (!started.ok) fail(`Send Run failed to start: ${started.error?.message}`);
  if (createdTabs.length !== 4) fail(`Send Run opened ${createdTabs.length} of 4 tabs`);
  if (createdTabs.filter(tab => tab.active).length !== 1 || !createdTabs[0]?.active) {
    fail('Send Run must focus exactly its first Platform tab');
  }

  const unrelated = await request(
    { action: 'sendRun.claim', platformId: 'chatgpt' },
    { tab: { id: 999, url: 'https://chatgpt.com/' } },
  );
  if (!unrelated.ok || unrelated.value !== null) fail('an unrelated Platform tab claimed a Delivery');

  const claimed = await request(
    { action: 'sendRun.claim', platformId: 'chatgpt' },
    { tab: { id: createdTabs[0].id, url: createdTabs[0].url } },
  );
  if (!claimed.ok || !claimed.value?.content?.includes('Known facts')) {
    fail('the exact created tab could not claim its Delivery');
  } else {
    const settled = await request({
      action: 'sendRun.settle',
      settlement: { claimToken: claimed.value.claimToken, status: 'delivered' },
    });
    if (!settled.ok || settled.value?.targetStatus !== 'delivered') fail('Delivery did not settle');
  }

  // The existing comparison basket remains behaviorally verified through its interface.
  const run = expression => vm.runInContext(expression, context);
  await run('clearBasket()');
  await run("addToBasket('facebook', 'react')");
  await run("addToBasket('vuejs', 'core')");
  await run("addToBasket('sveltejs', 'svelte')");
  const overflow = await run("addToBasket('angular', 'angular')");
  if (overflow.added || overflow.reason !== 'full') fail('comparison basket exceeded its cap');
  const duplicate = await run("addToBasket('FaceBook', 'React')");
  if (duplicate.added || duplicate.reason !== 'already') fail('comparison basket accepted a duplicate');
  await run('clearBasket()');
}

console.log(failures === 0 ? 'VERIFY OK' : `${failures} failure(s)`);
process.exit(failures ? 1 : 0);
