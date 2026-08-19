import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(...values) { values.forEach(value => this.values.add(value)); }
  remove(...values) { values.forEach(value => this.values.delete(value)); }
  toggle(value, force) {
    const enabled = force == null ? !this.values.has(value) : Boolean(force);
    if (enabled) this.values.add(value); else this.values.delete(value);
    return enabled;
  }
  contains(value) { return this.values.has(value); }
}

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.listeners = new Map();
    this.classList = new FakeClassList();
    this.style = {};
    this.dataset = {};
    this.attributes = {};
    this.textContent = '';
    this.innerHTML = '';
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.hidden = false;
  }
  append(...children) { children.forEach(child => this.appendChild(child)); }
  appendChild(child) { this.children.push(child); return child; }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  querySelectorAll(selector) {
    const descendants = [];
    const visit = node => {
      for (const child of node.children) {
        if (selector === 'input[name="llm"]' && child.tagName === 'INPUT' && child.name === 'llm') {
          descendants.push(child);
        }
        visit(child);
      }
    };
    visit(this);
    return descendants;
  }
  querySelector() { return null; }
  focus() {}
  select() {}
  click() {}
}

const html = fs.readFileSync('sidepanel.html', 'utf8');
const ids = [...html.matchAll(/id="([^"]+)"/g)].map(match => match[1]);
const elements = new Map(ids.map(id => [id, new FakeElement()]));
elements.get('pageUrl').textContent = 'Loading...';
let domReady;

const document = {
  getElementById: id => elements.get(id) || null,
  createElement: tag => new FakeElement(tag),
  addEventListener(type, listener) {
    if (type === 'DOMContentLoaded') domReady = listener;
  },
};

const noopEvent = { addListener() {}, removeListener() {} };
const seededSkills = (() => {
  const box = { globalThis: null, console, Math };
  box.globalThis = box;
  vm.runInNewContext(fs.readFileSync('skills.js', 'utf8'), box, { filename: 'skills.js' });
  // Top-level `const` lives in the context's lexical scope, not on the global object,
  // so it has to be read back by evaluating an expression in that same context.
  return vm.runInNewContext('DEFAULT_SKILLS', box).map(skill => ({ ...skill, builtin: true }));
})();

let preferences = {
  schemaVersion: 3,
  revision: 1,
  platforms: { enabled: ['chatgpt'], selected: ['chatgpt'], default: 'chatgpt' },
  prompt: { system: '' },
  skills: { items: seededSkills, activeIds: [] },
  appearance: { theme: 'dark' },
};

// Stands in for the worker: rejects a stale expectedRevision exactly like the real
// module, so a caller that still sends one is caught here.
const preferencesCalls = [];
function applyUpdate(patch, options = {}) {
  preferencesCalls.push(options);
  if (options.expectedRevision != null && options.expectedRevision !== preferences.revision) {
    const error = new Error('Preferences changed before this update could be saved.');
    error.code = 'PREFERENCES_CONFLICT';
    throw error;
  }
  preferences = {
    ...preferences,
    revision: preferences.revision + 1,
    skills: { ...preferences.skills, ...(patch.skills || {}) },
    platforms: { ...preferences.platforms, ...(patch.platforms || {}) },
    prompt: { ...preferences.prompt, ...(patch.prompt || {}) },
    appearance: { ...preferences.appearance, ...(patch.appearance || {}) },
  };
  return structuredClone(preferences);
}
const sandbox = {
  console,
  URL,
  structuredClone,
  setTimeout,
  clearTimeout,
  document,
  navigator: { clipboard: { writeText: async () => {} } },
  chrome: {
    runtime: { openOptionsPage() {} },
    storage: { onChanged: noopEvent },
    windows: { getCurrent: async () => ({ id: 7 }), WINDOW_ID_CURRENT: -2 },
    tabs: {
      query: async () => [{ id: 42, windowId: 7, active: true, url: 'https://example.com/article' }],
      onActivated: noopEvent,
      onUpdated: noopEvent,
    },
    scripting: { executeScript: async () => [] },
  },
  Lark: {
    createPreferencesClient: () => ({
      read: async () => structuredClone(preferences),
      update: async (patch, options) => applyUpdate(patch, options),
      observe: () => () => {},
    }),
    createSendRunClient: () => ({ prepare: async () => ({}), start: async () => ({}) }),
    Platforms: {
      list: () => [{ id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com/' }],
      get: () => ({ id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com/' }),
    },
  },
  applyTheme: () => 'dark',
  loadBasket: async () => [],
  clearBasket: async () => [],
  removeFromBasket: async () => [],
  addToBasket: async () => ({ added: true }),
  compareRepos: async () => ({ content: '', names: [] }),
  basketToInputs: value => value,
  githubReposOnPage: () => [],
  MAX_REPOS: 3,
};
sandbox.globalThis = sandbox;
const declaredScripts = [...html.matchAll(/<script src="([^"]+)"/g)].map(match => match[1]);
if (declaredScripts.includes('skills.js')) {
  vm.runInNewContext(fs.readFileSync('skills.js', 'utf8'), sandbox, { filename: 'skills.js' });
}
vm.runInNewContext(fs.readFileSync('sidepanel.js', 'utf8'), sandbox, { filename: 'sidepanel.js' });
assert.equal(typeof domReady, 'function', 'side panel did not register its startup handler');

let startupError = null;
try {
  await domReady();
} catch (error) {
  startupError = error;
}

assert.notEqual(
  elements.get('pageUrl').textContent,
  'Loading...',
  `side panel remained at Loading...${startupError ? ` (${startupError.message})` : ''}`,
);

// ---- Regression: selecting a Skill must not report a Preferences conflict ----------
//
// Reported symptom: clicking any Skill chip showed "Preferences changed before this
// update could be saved." Ordinary UI writes must not carry an expectedRevision, because
// a write is several worker round-trips and anything else writing in that window turned
// a plain chip click into a hard error.

const chips = elements.get('skillChips').children;
assert.ok(chips.length >= 3, `expected Skill chips to render, found ${chips.length}`);

for (const id of ['xpost', 'xthread', 'linkedin']) {
  assert.ok(
    seededSkills.some(skill => skill.id === id),
    `built-in Skill ${id} is missing from the seeded set`,
  );
}

// Another context advances the record between load and click — the exact race.
preferences = { ...preferences, revision: preferences.revision + 5 };

const status = elements.get('status');
status.textContent = '';
await chips[0].listeners.get('click')();

assert.ok(
  !/Preferences changed/i.test(status.textContent),
  `selecting a Skill surfaced a conflict: ${status.textContent}`,
);
assert.ok(
  preferencesCalls.length > 0 && preferencesCalls.every(options => options?.expectedRevision == null),
  'a Skill toggle must not send expectedRevision',
);
assert.deepEqual(
  JSON.parse(JSON.stringify(preferences.skills.activeIds)),
  [seededSkills[0].id],
  'the Skill toggle was persisted',
);

console.log('SIDEPANEL STARTUP OK');
console.log('SKILL SELECTION OK');
