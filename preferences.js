// Preferences domain module.
// Owns the versioned, normalized user Preferences record. Runtime contexts provide
// storage and the Platform catalog; callers never need to know persisted key names.

(function initPreferences(root) {
  const Lark = root.Lark = root.Lark || {};
  const RECORD_KEY = 'preferences';
  const SCHEMA_VERSION = 3;
  const MAX_ACTIVE_SKILLS = 3;
  const LEGACY_KEYS = [
    'selectedLLM', 'selectedLLMs', 'enabledLLMs',
    'systemPrompt', 'skills', 'activeSkills', 'themePref',
  ];

  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));

  function createPreferences({ storage, platformIds, defaults }) {
    if (!storage || typeof storage.get !== 'function' || typeof storage.set !== 'function') {
      throw new Error('Preferences requires a storage adapter');
    }

    const catalogIds = uniqueStrings(platformIds);
    if (!catalogIds.length) throw new Error('Preferences requires at least one Platform');

    const fallback = {
      systemPrompt: String(defaults?.systemPrompt || ''),
      skills: normalizeSkills(defaults?.skills),
      theme: normalizeTheme(defaults?.theme),
    };
    let writeQueue = Promise.resolve();

    async function read() {
      const stored = await storage.get([
        RECORD_KEY,
        ...LEGACY_KEYS,
      ]);

      if (stored[RECORD_KEY]) {
        const current = seedSkillsAddedSinceRecordWasWritten(stored[RECORD_KEY]);
        let normalized = normalizeRecord(current, current.revision || 1);
        if (JSON.stringify(normalized) !== JSON.stringify(current)) {
          normalized = normalizeRecord(current, Math.max(1, Number(current.revision) || 1) + 1);
          await storage.set({ [RECORD_KEY]: normalized });
        }
        if (LEGACY_KEYS.some(key => key in stored)) await storage.remove(LEGACY_KEYS);
        return clone(normalized);
      }

      const migrated = normalizeRecord({
        platforms: {
          enabled: stored.enabledLLMs,
          selected: stored.selectedLLMs,
          default: stored.selectedLLM,
        },
        prompt: { system: stored.systemPrompt },
        skills: { items: stored.skills, activeIds: stored.activeSkills },
        appearance: { theme: stored.themePref },
      }, 1);
      await storage.set({ [RECORD_KEY]: migrated });
      await storage.remove(LEGACY_KEYS);
      return clone(migrated);
    }

    function update(patch, options = {}) {
      const operation = writeQueue.then(async () => {
        const current = await read();
        if (options.expectedRevision != null && options.expectedRevision !== current.revision) {
          throw preferenceError('PREFERENCES_CONFLICT', 'Preferences changed before this update could be saved.');
        }

        const candidate = mergeRecord(current, patch);
        const normalized = normalizeRecord(candidate, current.revision + 1);
        await storage.set({ [RECORD_KEY]: normalized });
        return clone(normalized);
      });
      writeQueue = operation.catch(() => {});
      return operation;
    }

    function replace(document, options = {}) {
      const operation = writeQueue.then(async () => {
        const current = await read();
        if (options.expectedRevision != null && options.expectedRevision !== current.revision) {
          throw preferenceError('PREFERENCES_CONFLICT', 'Preferences changed before this import could be saved.');
        }

        const candidate = importDocument(document);
        validateCandidate(candidate);
        const normalized = normalizeRecord(candidate, current.revision + 1);
        await storage.set({ [RECORD_KEY]: normalized });
        return clone(normalized);
      });
      writeQueue = operation.catch(() => {});
      return operation;
    }

    function importDocument(document) {
      if (!document || typeof document !== 'object' || Array.isArray(document)) {
        throw preferenceError('PREFERENCES_IMPORT_FORMAT', 'Imported Preferences must be an object.');
      }
      if (document.schemaVersion != null && Number(document.schemaVersion) > SCHEMA_VERSION) {
        throw preferenceError('PREFERENCES_IMPORT_VERSION', 'Imported Preferences use a newer unsupported version.');
      }
      if (document.platforms || document.prompt || document.appearance) return clone(document);

      // Legacy export format from versions that stored each preference separately.
      return {
        platforms: {
          enabled: document.enabledLLMs,
          selected: document.selectedLLMs,
          default: document.selectedLLM,
        },
        prompt: { system: document.systemPrompt },
        skills: { items: document.skills, activeIds: document.activeSkills },
        appearance: { theme: document.themePref },
      };
    }

    function validateCandidate(candidate) {
      const platformGroups = [candidate?.platforms?.enabled, candidate?.platforms?.selected];
      for (const group of platformGroups) {
        if (group == null) continue;
        if (!Array.isArray(group)) {
          throw preferenceError('PREFERENCES_IMPORT_FORMAT', 'Platform choices must be arrays.');
        }
        const unknown = group.find(id => !catalogIds.includes(id));
        if (unknown) throw preferenceError('PREFERENCES_UNKNOWN_PLATFORM', `Unknown Platform: ${unknown}`);
      }
      if (Array.isArray(candidate?.platforms?.enabled) && candidate.platforms.enabled.length === 0) {
        throw preferenceError('PREFERENCES_NO_ENABLED_PLATFORM', 'At least one Platform must remain enabled.');
      }
      if (candidate?.platforms?.default != null && !catalogIds.includes(candidate.platforms.default)) {
        throw preferenceError('PREFERENCES_UNKNOWN_PLATFORM', `Unknown Platform: ${candidate.platforms.default}`);
      }
      const theme = candidate?.appearance?.theme;
      if (theme != null && !['system', 'light', 'dark'].includes(theme)) {
        throw preferenceError('PREFERENCES_INVALID_THEME', `Unknown theme preference: ${theme}`);
      }
      if (candidate?.skills?.items != null && !Array.isArray(candidate.skills.items)) {
        throw preferenceError('PREFERENCES_INVALID_SKILL', 'Skills must be an array.');
      }
      if (candidate?.skills?.activeIds != null && !Array.isArray(candidate.skills.activeIds)) {
        throw preferenceError('PREFERENCES_INVALID_SKILL', 'Active Skill IDs must be an array.');
      }
    }

    // Built-in Skills shipped after a record was written would otherwise never reach an
    // existing install: normalizeRecord keeps the stored list verbatim, so only the
    // "Restore Built-ins" button in Options would surface them. Gated on schemaVersion so
    // it runs once per upgrade — a Skill deleted afterwards stays deleted.
    function seedSkillsAddedSinceRecordWasWritten(candidate) {
      if ((Number(candidate?.schemaVersion) || 1) >= SCHEMA_VERSION) return candidate;
      const items = candidate?.skills?.items;
      if (!Array.isArray(items)) return candidate;

      const present = new Set(items.map(skill => skill && skill.id));
      const missing = fallback.skills.filter(skill => !present.has(skill.id));
      if (!missing.length) return candidate;

      return {
        ...candidate,
        skills: { ...candidate.skills, items: [...items, ...clone(missing)] },
      };
    }

    function normalizeRecord(candidate, revision) {
      const enabledInput = uniqueStrings(candidate?.platforms?.enabled);
      const enabled = catalogIds.filter(id => enabledInput.includes(id));
      if (!enabled.length) enabled.push(...catalogIds);

      const hasSelectedList = Array.isArray(candidate?.platforms?.selected);
      const selectedInput = uniqueStrings(candidate?.platforms?.selected);
      const selected = catalogIds.filter(id => enabled.includes(id) && selectedInput.includes(id));
      if (!selected.length && (!hasSelectedList || selectedInput.length)) {
        const requestedDefault = candidate?.platforms?.default;
        selected.push(enabled.includes(requestedDefault) ? requestedDefault : enabled[0]);
      }

      const requestedDefault = candidate?.platforms?.default;
      const defaultPlatform = enabled.includes(requestedDefault)
        ? requestedDefault
        : selected[0] || enabled[0];

      const hasSkillList = Array.isArray(candidate?.skills?.items);
      const items = hasSkillList
        ? normalizeSkills(candidate.skills.items)
        : clone(fallback.skills);
      const skillIds = new Set(items.map(skill => skill.id));
      const activeIds = uniqueStrings(candidate?.skills?.activeIds)
        .filter(id => skillIds.has(id))
        .slice(0, MAX_ACTIVE_SKILLS);

      const requestedPrompt = candidate?.prompt?.system;
      const system = typeof requestedPrompt === 'string'
        ? requestedPrompt
        : fallback.systemPrompt;

      return {
        schemaVersion: SCHEMA_VERSION,
        revision: Math.max(1, Number(revision) || 1),
        platforms: { enabled, selected, default: defaultPlatform },
        prompt: { system },
        skills: { items, activeIds },
        appearance: { theme: normalizeTheme(candidate?.appearance?.theme || fallback.theme) },
      };
    }

    return Object.freeze({ read, update, replace });
  }

  function createPreferencesClient({ runtime, storageChanges }) {
    if (!runtime || typeof runtime.sendMessage !== 'function') {
      throw new Error('Preferences client requires the runtime adapter');
    }

    const request = async (action, payload = {}) => {
      const response = await runtime.sendMessage({ action, ...payload });
      if (!response || response.ok !== true) throw deserializeError(response?.error);
      return response.value;
    };

    // Watermark of the newest revision this client has handed out. Any snapshot at or
    // below it is old news.
    let lastObserved = 0;
    const settle = value => {
      lastObserved = Math.max(lastObserved, Number(value?.revision) || 0);
      return value;
    };

    const read = async () => settle(await request('preferences.read'));
    const update = async (patch, options = {}) =>
      settle(await request('preferences.update', { patch, options }));
    const replace = async (document, options = {}) =>
      settle(await request('preferences.replace', { document, options }));
    // Change events are delivered asynchronously and a context also hears its own
    // writes, so a snapshot for revision N can land after the caller already holds
    // N+1. Delivering it would walk the caller's snapshot backwards, and every
    // subsequent write would then look like a conflict. Only ever move forward.
    const observe = listener => {
      if (!storageChanges || typeof storageChanges.addListener !== 'function') return () => {};
      const onChanged = (changes, area) => {
        if (area !== 'local' || !changes[RECORD_KEY]?.newValue) return;
        const next = changes[RECORD_KEY].newValue;
        const revision = Number(next.revision) || 0;
        if (revision <= lastObserved) return;
        lastObserved = revision;
        listener(clone(next));
      };
      storageChanges.addListener(onChanged);
      return () => storageChanges.removeListener?.(onChanged);
    };

    return Object.freeze({ read, update, replace, observe });
  }

  function mergeRecord(current, patch) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      throw preferenceError('PREFERENCES_INVALID_PATCH', 'Preferences update must be an object.');
    }
    return {
      ...clone(current),
      ...clone(patch),
      platforms: { ...clone(current.platforms), ...clone(patch.platforms || {}) },
      prompt: { ...clone(current.prompt), ...clone(patch.prompt || {}) },
      skills: { ...clone(current.skills), ...clone(patch.skills || {}) },
      appearance: { ...clone(current.appearance), ...clone(patch.appearance || {}) },
    };
  }

  function preferenceError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  function deserializeError(serialized) {
    const error = new Error(serialized?.message || 'Preferences request failed.');
    error.code = serialized?.code || 'PREFERENCES_REQUEST_FAILED';
    if (serialized?.details) error.details = serialized.details;
    return error;
  }

  function uniqueStrings(values) {
    if (!Array.isArray(values)) return [];
    return [...new Set(values.filter(value => typeof value === 'string' && value))];
  }

  function normalizeSkills(skills) {
    if (!Array.isArray(skills)) return [];
    return skills
      .filter(skill => skill && typeof skill.id === 'string' && skill.id &&
        typeof skill.name === 'string' && typeof skill.body === 'string')
      .map(skill => ({
        id: skill.id,
        name: skill.name,
        body: skill.body,
        builtin: Boolean(skill.builtin),
      }));
  }

  function normalizeTheme(theme) {
    return ['system', 'light', 'dark'].includes(theme) ? theme : 'system';
  }

  Lark.createPreferences = createPreferences;
  Lark.createPreferencesClient = createPreferencesClient;
})(globalThis);
