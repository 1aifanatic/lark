import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

function memoryStorage(seed = {}) {
  const data = structuredClone(seed);
  return {
    data,
    async get(keys) {
      if (keys == null) return structuredClone(data);
      const list = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(list.filter(key => key in data).map(key => [key, structuredClone(data[key])]));
    },
    async set(values) {
      Object.assign(data, structuredClone(values));
    },
    async remove(keys) {
      for (const key of (Array.isArray(keys) ? keys : [keys])) delete data[key];
    },
  };
}

function memoryRunStore() {
  const runs = new Map();
  return {
    runs,
    async list() { return [...runs.values()].map(value => structuredClone(value)); },
    async save(run) { runs.set(run.id, structuredClone(run)); },
    async remove(runId) { runs.delete(runId); },
  };
}

function loadScript(file, additions = {}) {
  const sandbox = { console, structuredClone, setTimeout, clearTimeout, URL, ...additions };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
  return sandbox;
}

test('Preferences migrates legacy choices into one normalized record', async () => {
  const storage = memoryStorage({
    selectedLLM: 'claude',
    selectedLLMs: ['claude', 'chatgpt'],
    enabledLLMs: ['chatgpt', 'claude'],
    systemPrompt: 'Answer precisely.',
    skills: [
      { id: 'summary', name: 'Summary', body: 'Summarize it.', builtin: true },
      { id: 'custom', name: 'Custom', body: 'Use examples.', builtin: false },
    ],
    activeSkills: ['custom'],
    themePref: 'dark',
  });
  const { Lark } = loadScript('preferences.js');
  const preferences = Lark.createPreferences({
    storage,
    platformIds: ['chatgpt', 'gemini', 'claude'],
    defaults: {
      systemPrompt: 'Default prompt',
      skills: [{ id: 'summary', name: 'Summary', body: 'Default summary.', builtin: true }],
      theme: 'system',
    },
  });

  const snapshot = await preferences.read();

  assert.deepEqual(JSON.parse(JSON.stringify(snapshot)), {
    schemaVersion: 3,
    revision: 1,
    platforms: {
      enabled: ['chatgpt', 'claude'],
      selected: ['chatgpt', 'claude'],
      default: 'claude',
    },
    prompt: { system: 'Answer precisely.' },
    skills: {
      items: [
        { id: 'summary', name: 'Summary', body: 'Summarize it.', builtin: true },
        { id: 'custom', name: 'Custom', body: 'Use examples.', builtin: false },
      ],
      activeIds: ['custom'],
    },
    appearance: { theme: 'dark' },
  });
  assert.deepEqual(storage.data.preferences, JSON.parse(JSON.stringify(snapshot)));
});

test('Preferences update reconciles Platform choices atomically', async () => {
  const storage = memoryStorage();
  const { Lark } = loadScript('preferences.js');
  const preferences = Lark.createPreferences({
    storage,
    platformIds: ['chatgpt', 'gemini', 'claude'],
    defaults: { systemPrompt: 'Default', skills: [], theme: 'system' },
  });
  await preferences.read();

  const snapshot = await preferences.update({
    platforms: {
      enabled: ['gemini'],
      selected: ['chatgpt'],
      default: 'claude',
    },
  });

  assert.deepEqual(JSON.parse(JSON.stringify(snapshot.platforms)), {
    enabled: ['gemini'],
    selected: ['gemini'],
    default: 'gemini',
  });
  assert.equal(snapshot.revision, 2);
  assert.deepEqual(storage.data.preferences, JSON.parse(JSON.stringify(snapshot)));
});

test('Preferences durably upgrades an older canonical record', async () => {
  const storage = memoryStorage({
    preferences: {
      schemaVersion: 1,
      revision: 7,
      platforms: { enabled: ['chatgpt'], selected: ['chatgpt'], default: 'chatgpt' },
      prompt: { system: 'Keep this.' },
      skills: { items: [], activeIds: [] },
      appearance: { theme: 'dark' },
    },
  });
  const { Lark } = loadScript('preferences.js');
  const preferences = Lark.createPreferences({
    storage,
    platformIds: ['chatgpt', 'gemini'],
    defaults: { systemPrompt: 'Default', skills: [], theme: 'system' },
  });

  const snapshot = await preferences.read();

  assert.equal(snapshot.schemaVersion, 3);
  assert.equal(snapshot.revision, 8);
  assert.equal(snapshot.prompt.system, 'Keep this.');
  assert.deepEqual(storage.data.preferences, JSON.parse(JSON.stringify(snapshot)));
});

test('Preferences preserves intentionally empty prompt and Skill list', async () => {
  const storage = memoryStorage();
  const { Lark } = loadScript('preferences.js');
  const preferences = Lark.createPreferences({
    storage,
    platformIds: ['chatgpt'],
    defaults: {
      systemPrompt: 'Default prompt',
      skills: [{ id: 'summary', name: 'Summary', body: 'Summarize.', builtin: true }],
      theme: 'system',
    },
  });
  await preferences.read();

  const snapshot = await preferences.update({
    prompt: { system: '' },
    skills: { items: [], activeIds: [] },
  });

  assert.equal(snapshot.prompt.system, '');
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot.skills.items)), []);
});

test('Preferences preserves an intentional empty Platform selection', async () => {
  const storage = memoryStorage();
  const { Lark } = loadScript('preferences.js');
  const preferences = Lark.createPreferences({
    storage,
    platformIds: ['chatgpt', 'gemini'],
    defaults: { systemPrompt: 'Default', skills: [], theme: 'system' },
  });
  await preferences.read();

  const snapshot = await preferences.update({ platforms: { selected: [] } });

  assert.deepEqual(JSON.parse(JSON.stringify(snapshot.platforms)), {
    enabled: ['chatgpt', 'gemini'], selected: [], default: 'chatgpt',
  });
});

test('Preferences replace rejects an invalid import without changing saved Preferences', async () => {
  const storage = memoryStorage();
  const { Lark } = loadScript('preferences.js');
  const preferences = Lark.createPreferences({
    storage,
    platformIds: ['chatgpt', 'gemini'],
    defaults: { systemPrompt: 'Default', skills: [], theme: 'system' },
  });
  const before = await preferences.read();
  const invalid = JSON.parse(JSON.stringify(before));
  invalid.appearance.theme = 'neon';

  await assert.rejects(
    preferences.replace(invalid),
    error => error.code === 'PREFERENCES_INVALID_THEME'
  );
  assert.deepEqual(storage.data.preferences, JSON.parse(JSON.stringify(before)));
});

test('Preferences seeds newly shipped built-in Skills into an existing record once', async () => {
  // An existing install already has skills.items stored, and normalizeRecord keeps that
  // list verbatim — so without this, a Skill added in a new version would only ever
  // appear for people who found "Restore Built-ins" in Options.
  const storage = memoryStorage({
    preferences: {
      schemaVersion: 2,
      revision: 9,
      platforms: { enabled: ['chatgpt'], selected: ['chatgpt'], default: 'chatgpt' },
      prompt: { system: 'Mine.' },
      skills: {
        items: [
          { id: 'summary', name: 'Renamed By Me', body: 'My own wording.', builtin: true },
          { id: 'mine', name: 'Mine', body: 'Custom.', builtin: false },
        ],
        activeIds: ['mine'],
      },
      appearance: { theme: 'dark' },
    },
  });
  const { Lark } = loadScript('preferences.js');
  const preferences = Lark.createPreferences({
    storage,
    platformIds: ['chatgpt', 'claude'],
    defaults: {
      systemPrompt: 'Default',
      skills: [
        { id: 'summary', name: 'Summary', body: 'Stock wording.', builtin: true },
        { id: 'linkedin', name: 'LinkedIn Post', body: 'Write a LinkedIn post.', builtin: true },
      ],
      theme: 'system',
    },
  });

  const snapshot = await preferences.read();
  const ids = snapshot.skills.items.map(skill => skill.id);

  assert.ok(ids.includes('linkedin'), 'the newly shipped Skill was seeded');
  assert.ok(ids.includes('mine'), 'a custom Skill is untouched');
  assert.equal(
    snapshot.skills.items.find(skill => skill.id === 'summary').name,
    'Renamed By Me',
    'an edited built-in keeps the wording the user gave it',
  );
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot.skills.activeIds)), ['mine']);

  // Seeding is keyed on schemaVersion, so a Skill deleted afterwards stays deleted.
  await preferences.update({ skills: { items: snapshot.skills.items.filter(s => s.id !== 'linkedin') } });
  const after = await preferences.read();
  assert.ok(
    !after.skills.items.some(skill => skill.id === 'linkedin'),
    'a seeded Skill the user deletes is not resurrected on the next read',
  );
});

test('Preferences client never hands back a snapshot older than one it already gave', async () => {
  // Change events arrive asynchronously and a context hears its own writes, so a
  // snapshot for revision N can be delivered after the caller already holds N+1.
  // Replaying it walked the caller's revision backwards, which made the next ordinary
  // write look like a conflict and surfaced "Preferences changed before this update
  // could be saved." on a plain Skill chip click.
  const { Lark } = loadScript('preferences.js');
  const changeListeners = [];
  const client = Lark.createPreferencesClient({
    runtime: {
      sendMessage: async () => ({
        ok: true,
        value: { schemaVersion: 2, revision: 5, skills: { items: [], activeIds: [] } },
      }),
    },
    storageChanges: {
      addListener: fn => changeListeners.push(fn),
      removeListener: () => {},
    },
  });

  const seen = [];
  client.observe(snapshot => seen.push(snapshot.revision));

  await client.read(); // establishes revision 5 as the watermark
  const emit = revision => changeListeners.forEach(fn => fn(
    { preferences: { newValue: { schemaVersion: 2, revision } } },
    'local',
  ));

  emit(4); // stale, predates the read
  emit(5); // the read's own write echoing back
  emit(6); // genuinely newer
  emit(6); // duplicate delivery
  emit(5); // late straggler arriving after 6

  assert.deepEqual(seen, [6], 'only strictly newer revisions may reach the listener');
});

test('Preferences update without an expected revision merges instead of conflicting', async () => {
  // A Skill toggle and a concurrent theme change touch different sections, so they must
  // compose rather than one of them failing.
  const storage = memoryStorage();
  const { Lark } = loadScript('preferences.js');
  const preferences = Lark.createPreferences({
    storage,
    platformIds: ['chatgpt', 'claude'],
    defaults: {
      systemPrompt: 'Default',
      skills: [{ id: 'summary', name: 'Summary', body: 'Summarize.', builtin: true }],
      theme: 'system',
    },
  });
  const start = await preferences.read();

  const [skillWrite, themeWrite] = await Promise.all([
    preferences.update({ skills: { activeIds: ['summary'] } }),
    preferences.update({ appearance: { theme: 'dark' } }),
  ]);

  const final = await preferences.read();
  // JSON round-trip because the record is built inside the vm realm, so its arrays
  // fail a strict prototype comparison against a host array.
  assert.deepEqual(JSON.parse(JSON.stringify(final.skills.activeIds)), ['summary'], 'the Skill toggle survived');
  assert.equal(final.appearance.theme, 'dark', 'the concurrent theme change survived');
  assert.equal(final.revision, start.revision + 2, 'both writes advanced the revision');
  assert.ok(skillWrite.revision !== themeWrite.revision, 'writes are serialized, not merged in place');
});

test('Preferences still refuses a stale expected revision where clobbering matters', async () => {
  // Optimistic locking is kept for imports, which replace the whole document.
  const storage = memoryStorage();
  const { Lark } = loadScript('preferences.js');
  const preferences = Lark.createPreferences({
    storage,
    platformIds: ['chatgpt', 'claude'],
    defaults: { systemPrompt: 'Default', skills: [], theme: 'system' },
  });
  const start = await preferences.read();
  await preferences.update({ appearance: { theme: 'dark' } });

  await assert.rejects(
    () => preferences.replace(
      { platforms: { enabled: ['chatgpt'], selected: ['chatgpt'], default: 'chatgpt' } },
      { expectedRevision: start.revision },
    ),
    error => error.code === 'PREFERENCES_CONFLICT',
  );
});

test('Page Intake falls back from a short article to the current page URL', async () => {
  const { Lark } = loadScript('page-intake.js');
  const pageIntake = Lark.createPageIntake({
    resolveTab: async () => ({
      id: 42,
      windowId: 7,
      url: 'https://example.com/current',
      title: 'Current page',
    }),
    readArticle: async () => ({ text: 'Too short', chars: 9 }),
    readTranscript: async () => { throw new Error('not used'); },
  });

  const intake = await pageIntake.capture({ kind: 'page', windowId: 7 });

  assert.deepEqual(JSON.parse(JSON.stringify(intake)), {
    kind: 'url',
    body: 'https://example.com/current',
    contentLabel: 'URL',
    displayLabel: 'URL',
    meta: [['Page Title', 'Current page']],
    diagnostics: { fallbackUsed: true, reason: 'article-too-short' },
    source: {
      tabId: 42,
      windowId: 7,
      url: 'https://example.com/current',
      title: 'Current page',
    },
  });
});

test('Page Intake captures a text selection without article fallback', async () => {
  const { Lark } = loadScript('page-intake.js');
  const pageIntake = Lark.createPageIntake({
    resolveTab: async () => ({ id: 8, windowId: 2, url: 'https://example.com/story', title: 'Story' }),
    readArticle: async () => { throw new Error('must not run'); },
    readTranscript: async () => { throw new Error('must not run'); },
  });

  const intake = await pageIntake.capture({ kind: 'selection', text: '  chosen words  ' });

  assert.equal(intake.kind, 'selection');
  assert.equal(intake.body, 'chosen words');
  assert.deepEqual(JSON.parse(JSON.stringify(intake.meta)), [
    ['Page Title', 'Story'],
    ['URL', 'https://example.com/story'],
  ]);
});

test('Page Intake captures a context-menu link as canonical content', async () => {
  const { Lark } = loadScript('page-intake.js');
  const pageIntake = Lark.createPageIntake({
    resolveTab: async () => ({ id: 9, windowId: 2, url: 'https://example.com/source', title: 'Source' }),
    readArticle: async () => { throw new Error('must not run'); },
    readTranscript: async () => { throw new Error('must not run'); },
  });

  const intake = await pageIntake.capture({ kind: 'link', url: ' https://example.net/item ' });

  assert.deepEqual(JSON.parse(JSON.stringify({
    kind: intake.kind,
    body: intake.body,
    contentLabel: intake.contentLabel,
    meta: intake.meta,
  })), {
    kind: 'link',
    body: 'https://example.net/item',
    contentLabel: 'Link',
    meta: [['Page Title', 'Source'], ['URL', 'https://example.com/source']],
  });
});

test('Page Intake accepts Prepared Content without reading a tab', async () => {
  const { Lark } = loadScript('page-intake.js');
  const pageIntake = Lark.createPageIntake({
    resolveTab: async () => { throw new Error('must not run'); },
    readArticle: async () => { throw new Error('must not run'); },
    readTranscript: async () => { throw new Error('must not run'); },
  });

  const intake = await pageIntake.capture({
    kind: 'prepared',
    body: 'Repository facts',
    contentLabel: 'Repository Comparison',
    displayLabel: 'comparison',
    meta: [['Compared', 'alpha vs beta']],
  });

  assert.equal(intake.kind, 'prepared');
  assert.equal(intake.body, 'Repository facts');
  assert.equal(intake.contentLabel, 'Repository Comparison');
});

test('Page Intake captures and labels a YouTube transcript', async () => {
  const { Lark } = loadScript('page-intake.js');
  const pageIntake = Lark.createPageIntake({
    resolveTab: async () => ({ id: 14, windowId: 3, url: 'https://www.youtube.com/watch?v=abc', title: 'Fallback title' }),
    readArticle: async () => { throw new Error('must not run'); },
    readTranscript: async tab => ({ body: '00:00 Opening\n00:10 Details', title: `Video from ${tab.id}` }),
  });

  const intake = await pageIntake.capture({ kind: 'page' });

  assert.equal(intake.kind, 'transcript');
  assert.equal(intake.body, '00:00 Opening\n00:10 Details');
  assert.deepEqual(JSON.parse(JSON.stringify(intake.meta)), [
    ['Video Title', 'Video from 14'],
    ['Video URL', 'https://www.youtube.com/watch?v=abc'],
  ]);
});

test('Page Intake truncates long article content exactly once', async () => {
  const { Lark } = loadScript('page-intake.js');
  const article = 'x'.repeat(60025);
  const pageIntake = Lark.createPageIntake({
    resolveTab: async () => ({ id: 15, windowId: 3, url: 'https://example.com/long', title: 'Long read' }),
    readArticle: async () => ({ text: article, chars: article.length }),
    readTranscript: async () => { throw new Error('must not run'); },
  });

  const intake = await pageIntake.capture({ kind: 'page' });

  assert.equal(intake.kind, 'article');
  assert.equal(intake.body, `${'x'.repeat(60000)}\n\n[truncated]`);
  assert.deepEqual(JSON.parse(JSON.stringify(intake.diagnostics)), { truncated: true, originalChars: 60025 });
});

test('Platform registry identifies supported URLs without loose hostname matches', async () => {
  const { Lark } = loadScript('platforms.js');
  const cases = [
    ['https://chatgpt.com/', 'chatgpt'],
    ['https://chat.openai.com/c/123', 'chatgpt'],
    ['https://gemini.google.com/app', 'gemini'],
    ['https://x.com/i/grok', 'grok'],
    ['https://grok.com/', 'grok'],
    ['https://claude.ai/new', 'claude'],
    ['https://chat.deepseek.com/', 'deepseek'],
    ['https://www.kimi.com/', 'kimi'],
    ['https://chat.qwen.ai/', 'qwen'],
    ['https://www.perplexity.ai/', 'perplexity'],
    ['https://poe.com/', 'poe'],
    ['https://chat.mistral.ai/chat', 'mistral'],
    ['https://huggingface.co/chat/', 'huggingchat'],
    ['https://copilot.microsoft.com/', 'copilot'],
  ];

  for (const [url, expected] of cases) assert.equal(Lark.Platforms.match(url)?.id, expected);
  assert.equal(Lark.Platforms.match('https://notchatgpt.com/'), null);
  assert.equal(Lark.Platforms.match('https://example.com/?next=https://claude.ai'), null);
});

test('Platform paste writes and verifies a React textarea through its adapter', async () => {
  class FakeTextarea {
    constructor() {
      this.tagName = 'TEXTAREA';
      this._value = '';
      this.selectionStart = 0;
      this.selectionEnd = 0;
      this.events = [];
    }
    get value() { return this._value; }
    set value(next) { this._value = String(next); }
    focus() {}
    dispatchEvent(event) { this.events.push(event.type); return true; }
  }
  const input = new FakeTextarea();
  const fakeWindow = {
    HTMLTextAreaElement: FakeTextarea,
    Event,
    InputEvent: Event,
    getSelection: () => ({ removeAllRanges() {}, addRange() {} }),
  };
  const fakeDocument = {
    querySelector: () => input,
    createElement: () => ({}),
    createRange: () => ({ selectNodeContents() {}, collapse() {} }),
  };
  const { Lark } = loadScript('platforms.js');

  const result = await Lark.Platforms.paste({
    url: 'https://chatgpt.com/',
    document: fakeDocument,
    window: fakeWindow,
    content: 'new draft',
    deadlineMs: 20,
  });

  assert.equal(input.value, 'new draft');
  assert.equal(result.platformId, 'chatgpt');
  assert.equal(result.verified, true);
  assert.ok(input.events.includes('input'));
  assert.ok(input.events.indexOf('beforeinput') < input.events.indexOf('input'));
});

test('Platform paste writes paragraph-based and Quill editors through shared adapters', async () => {
  class FakeEditor {
    constructor(className = '') {
      this.tagName = 'DIV';
      this.classList = { contains: value => className.split(' ').includes(value) };
      this.children = [];
      this.events = [];
    }
    set innerHTML(value) { this.children = []; this._text = value; }
    get innerHTML() { return this._text || ''; }
    get textContent() { return this.children.length ? this.children.map(child => child.textContent).join('\n') : (this._text || ''); }
    set textContent(value) { this.children = []; this._text = String(value); }
    get innerText() { return this.textContent; }
    appendChild(child) { this.children.push(child); }
    focus() {}
    dispatchEvent(event) { this.events.push(event.type); return true; }
  }
  const fakeWindow = {
    Event,
    InputEvent: Event,
    getSelection: () => ({ removeAllRanges() {}, addRange() {} }),
  };
  const makeDocument = editor => ({
    querySelector: () => editor,
    createElement: () => ({ textContent: '' }),
    createRange: () => ({ selectNodeContents() {}, collapse() {} }),
  });
  const { Lark } = loadScript('platforms.js');
  const paragraphs = new FakeEditor();
  const quill = new FakeEditor('ql-editor');

  const chatgpt = await Lark.Platforms.paste({
    url: 'https://chatgpt.com/', document: makeDocument(paragraphs), window: fakeWindow,
    content: 'first\n\nthird', deadlineMs: 20,
  });
  const gemini = await Lark.Platforms.paste({
    url: 'https://gemini.google.com/app', document: makeDocument(quill), window: fakeWindow,
    content: 'alpha\nbeta', deadlineMs: 20,
  });

  assert.equal(chatgpt.editorKind, 'paragraphs');
  assert.equal(gemini.editorKind, 'quill');
  assert.deepEqual(paragraphs.children.map(child => child.textContent), ['first', '\u200B', 'third']);
  assert.deepEqual(quill.children.map(child => child.textContent), ['alpha', 'beta']);
  assert.ok(paragraphs.events.includes('input'));
  assert.ok(quill.events.includes('input'));
});

test('Send Run binds Deliveries to created tabs and rejects unrelated replay', async () => {
  const { Lark } = loadScript('send-run.js');
  const runStore = memoryRunStore();
  const opened = [];
  let nextTabId = 100;
  const sendRun = Lark.createSendRun({
    preferences: {
      read: async () => ({
        revision: 4,
        platforms: { enabled: ['chatgpt', 'gemini'], selected: ['chatgpt', 'gemini'], default: 'chatgpt' },
        prompt: { system: 'Analyze.' },
        skills: { items: [], activeIds: [] },
      }),
    },
    pageIntake: {
      capture: async () => ({
        kind: 'prepared', body: 'Facts', contentLabel: 'Content', displayLabel: 'content', meta: [], diagnostics: {}, source: null,
      }),
    },
    platforms: {
      get: id => ({
        chatgpt: { id: 'chatgpt', url: 'https://chatgpt.com/' },
        gemini: { id: 'gemini', url: 'https://gemini.google.com/app' },
      })[id] || null,
    },
    compose: ({ content }) => `Composed: ${content}`,
    tabs: {
      create: async options => {
        const tab = { id: nextTabId++, ...options };
        opened.push(tab);
        return tab;
      },
    },
    runStore,
    clock: () => 1_000,
    createId: (() => { let value = 0; return prefix => `${prefix}-${++value}`; })(),
    sleep: async () => {},
  });

  const receipt = await sendRun.start({ kind: 'prepared', body: 'Facts' });
  const unrelated = await sendRun.claim({ tabId: 999, platformId: 'chatgpt' });
  const chatgpt = await sendRun.claim({ tabId: 100, platformId: 'chatgpt' });

  assert.deepEqual(opened.map(tab => ({ url: tab.url, active: tab.active })), [
    { url: 'https://chatgpt.com/', active: true },
    { url: 'https://gemini.google.com/app', active: false },
  ]);
  assert.equal(receipt.runId, 'run-1');
  assert.equal(unrelated, null);
  assert.equal(chatgpt.content, 'Composed: Facts');
  assert.equal(chatgpt.tabId, 100);
});

test('Send Run completes a claimed Delivery once and removes the finished run', async () => {
  const { Lark } = loadScript('send-run.js');
  const runStore = memoryRunStore();
  const sendRun = Lark.createSendRun({
    preferences: {
      read: async () => ({
        revision: 1,
        platforms: { enabled: ['chatgpt'], selected: ['chatgpt'], default: 'chatgpt' },
        prompt: { system: 'Analyze.' },
        skills: { items: [], activeIds: [] },
      }),
    },
    pageIntake: { capture: async () => ({ kind: 'prepared', body: 'One', contentLabel: 'Content', displayLabel: 'content', meta: [] }) },
    platforms: { get: id => id === 'chatgpt' ? { id, url: 'https://chatgpt.com/' } : null },
    compose: ({ content }) => content,
    tabs: { create: async options => ({ id: 55, ...options }) },
    runStore,
    clock: () => 10_000,
    createId: (() => { let value = 0; return prefix => `${prefix}-${++value}`; })(),
    sleep: async () => {},
  });
  await sendRun.start({ kind: 'prepared', body: 'One' });
  const claim = await sendRun.claim({ tabId: 55, platformId: 'chatgpt' });

  const settled = await sendRun.settle({ claimToken: claim.claimToken, status: 'delivered' });
  const duplicate = await sendRun.claim({ tabId: 55, platformId: 'chatgpt' });

  assert.equal(settled.targetStatus, 'delivered');
  assert.equal(settled.runStatus, 'completed');
  assert.equal(duplicate, null);
  assert.equal(runStore.runs.size, 0);
});

test('Send Run keeps partial fan-out and focuses the first tab that actually opens', async () => {
  const { Lark } = loadScript('send-run.js');
  const runStore = memoryRunStore();
  const attempts = [];
  const sendRun = Lark.createSendRun({
    preferences: {
      read: async () => ({
        revision: 1,
        platforms: { enabled: ['chatgpt', 'gemini'], selected: ['chatgpt', 'gemini'], default: 'chatgpt' },
        prompt: { system: 'Analyze.' }, skills: { items: [], activeIds: [] },
      }),
    },
    pageIntake: { capture: async () => ({ kind: 'prepared', body: 'One', contentLabel: 'Content', displayLabel: 'content', meta: [] }) },
    platforms: { get: id => ({ id, url: id === 'chatgpt' ? 'https://chatgpt.com/' : 'https://gemini.google.com/app' }) },
    compose: ({ content }) => content,
    tabs: {
      create: async options => {
        attempts.push(options);
        if (options.url.includes('chatgpt')) throw new Error('blocked');
        return { id: 77, ...options };
      },
    },
    runStore,
    clock: () => 1,
    createId: prefix => `${prefix}-partial`,
    sleep: async () => {},
  });

  const receipt = await sendRun.start({ kind: 'prepared', body: 'One' });

  assert.equal(receipt.status, 'partial');
  assert.equal(receipt.deliveries[0].status, 'failed');
  assert.equal(receipt.deliveries[1].status, 'opened');
  assert.equal(attempts[1].active, true);
});

test('Concurrent Send Runs to the same Platform keep content bound to distinct tabs', async () => {
  const { Lark } = loadScript('send-run.js');
  const runStore = memoryRunStore();
  let nextTabId = 200;
  let nextId = 0;
  const sendRun = Lark.createSendRun({
    preferences: { read: async () => ({
      revision: 1,
      platforms: { enabled: ['chatgpt'], selected: ['chatgpt'], default: 'chatgpt' },
      prompt: { system: '' }, skills: { items: [], activeIds: [] },
    }) },
    pageIntake: { capture: async intent => ({
      kind: 'prepared', body: intent.body, contentLabel: 'Content', displayLabel: 'content', meta: [],
    }) },
    platforms: { get: id => id === 'chatgpt' ? { id, url: 'https://chatgpt.com/' } : null },
    compose: ({ content }) => `prompt:${content}`,
    tabs: { create: async options => ({ id: nextTabId++, ...options }) },
    runStore,
    clock: () => 1_000,
    createId: prefix => `${prefix}-${++nextId}`,
    sleep: async () => {},
  });

  const [first, second] = await Promise.all([
    sendRun.start({ kind: 'prepared', body: 'first run' }),
    sendRun.start({ kind: 'prepared', body: 'second run' }),
  ]);
  const firstClaim = await sendRun.claim({ tabId: first.deliveries[0].tabId, platformId: 'chatgpt' });
  const secondClaim = await sendRun.claim({ tabId: second.deliveries[0].tabId, platformId: 'chatgpt' });

  assert.notEqual(first.deliveries[0].tabId, second.deliveries[0].tabId);
  assert.equal(firstClaim.content, 'prompt:first run');
  assert.equal(secondClaim.content, 'prompt:second run');
});

test('Send Run lease expiry permits bounded retry and never leaks to another tab', async () => {
  const { Lark } = loadScript('send-run.js');
  const runStore = memoryRunStore();
  let now = 5_000;
  let nextId = 0;
  const sendRun = Lark.createSendRun({
    preferences: { read: async () => ({
      revision: 1,
      platforms: { enabled: ['chatgpt'], selected: ['chatgpt'], default: 'chatgpt' },
      prompt: { system: '' }, skills: { items: [], activeIds: [] },
    }) },
    pageIntake: { capture: async () => ({ kind: 'prepared', body: 'leased', contentLabel: 'Content', displayLabel: 'content', meta: [] }) },
    platforms: { get: id => id === 'chatgpt' ? { id, url: 'https://chatgpt.com/' } : null },
    compose: ({ content }) => content,
    tabs: { create: async options => ({ id: 300, ...options }) },
    runStore,
    clock: () => now,
    createId: prefix => `${prefix}-${++nextId}`,
    sleep: async () => {},
    policy: { claimLeaseMs: 100, maxAttempts: 2 },
  });
  await sendRun.start({ kind: 'prepared', body: 'leased' });

  const first = await sendRun.claim({ tabId: 300, platformId: 'chatgpt' });
  const whileLeased = await sendRun.claim({ tabId: 300, platformId: 'chatgpt' });
  const unrelated = await sendRun.claim({ tabId: 301, platformId: 'chatgpt' });
  now += 101;
  const retry = await sendRun.claim({ tabId: 300, platformId: 'chatgpt' });
  now += 101;
  const exhausted = await sendRun.claim({ tabId: 300, platformId: 'chatgpt' });

  assert.ok(first.claimToken);
  assert.equal(whileLeased, null);
  assert.equal(unrelated, null);
  assert.notEqual(retry.claimToken, first.claimToken);
  assert.equal(exhausted, null);
  assert.equal(runStore.runs.size, 0);
});

let failures = 0;
for (const { name, fn } of tests) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures++;
    console.error(`FAIL ${name}`);
    console.error(error && error.stack ? error.stack : error);
  }
}

console.log(`${tests.length - failures}/${tests.length} architecture tests passed`);
process.exitCode = failures ? 1 : 0;
