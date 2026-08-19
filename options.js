// Options page for LARK.
// Depends on platforms.js, skills.js, preferences.js and theme.js.

document.addEventListener('DOMContentLoaded', async () => {
  const prefsClient = Lark.createPreferencesClient({
    runtime: chrome.runtime,
    storageChanges: chrome.storage.onChanged,
  });
  let prefs = await prefsClient.read();
  let preferencesWriteQueue = Promise.resolve();
  let skills = prefs.skills.items.map(skill => ({ ...skill }));

  const systemPromptEl = document.getElementById('systemPrompt');
  const charCountEl = document.getElementById('charCount');
  const resetPromptBtn = document.getElementById('resetPrompt');
  const saveStatusEl = document.getElementById('saveStatus');
  const exportBtn = document.getElementById('exportBtn');
  const importBtn = document.getElementById('importBtn');
  const importFileEl = document.getElementById('importFile');
  const skillsListEl = document.getElementById('skillsList');
  const addSkillBtn = document.getElementById('addSkill');
  const restoreSkillsBtn = document.getElementById('restoreSkills');
  const enabledGrid = document.getElementById('enabledGrid');
  const enabledCount = document.getElementById('enabledCount');
  const enableAllBtn = document.getElementById('enableAll');
  const defaultPlatformGrid = document.getElementById('defaultPlatformGrid');
  const themeOptions = document.querySelectorAll('input[name="themePref"]');

  renderFromPreferences();

  // ---- Appearance -----------------------------------------------------------

  themeOptions.forEach(option => {
    option.addEventListener('change', async event => {
      prefs = await savePatch({ appearance: { theme: event.target.value } });
      applyTheme(prefs.appearance.theme);
      syncThemeControls();
      showSaveStatus();
    });
  });

  // ---- Platforms ------------------------------------------------------------

  function renderEnabledGrid() {
    enabledGrid.innerHTML = '';
    for (const platform of Lark.Platforms.list()) {
      const label = document.createElement('label');
      label.className = 'llm-checkbox';

      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = prefs.platforms.enabled.includes(platform.id);
      input.value = platform.id;
      input.addEventListener('change', () => toggleEnabled(platform.id, input));

      const mark = document.createElement('span');
      mark.className = `llm-mark ${platform.id}`;
      mark.textContent = platform.name.charAt(0);
      mark.setAttribute('aria-hidden', 'true');

      const name = document.createElement('span');
      name.className = 'checkbox-label';
      name.textContent = platform.name;
      label.append(input, mark, name);
      enabledGrid.appendChild(label);
    }
    enabledCount.textContent = `${prefs.platforms.enabled.length} enabled`;
  }

  async function toggleEnabled(id, input) {
    const next = input.checked
      ? [...prefs.platforms.enabled, id]
      : prefs.platforms.enabled.filter(platformId => platformId !== id);
    if (!next.length) {
      input.checked = true;
      showSaveStatus('Keep at least one Platform enabled');
      return;
    }
    prefs = await savePatch({ platforms: { enabled: next } });
    renderEnabledGrid();
    renderDefaultPlatformGrid();
    showSaveStatus();
  }

  enableAllBtn.addEventListener('click', async () => {
    prefs = await savePatch({
      platforms: { enabled: Lark.Platforms.list().map(platform => platform.id) },
    });
    renderEnabledGrid();
    renderDefaultPlatformGrid();
    showSaveStatus();
  });

  function renderDefaultPlatformGrid() {
    defaultPlatformGrid.innerHTML = '';
    for (const platform of Lark.Platforms.list(prefs.platforms.enabled)) {
      const label = document.createElement('label');
      label.className = 'llm-option';
      label.dataset.llm = platform.id;

      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'defaultLLM';
      input.value = platform.id;
      input.checked = platform.id === prefs.platforms.default;
      input.addEventListener('change', async () => {
        prefs = await savePatch({ platforms: { default: platform.id } });
        showSaveStatus();
      });

      const card = document.createElement('div');
      card.className = 'llm-card';
      const mark = document.createElement('div');
      mark.className = `llm-icon ${platform.id}`;
      mark.textContent = platform.name.charAt(0);
      mark.setAttribute('aria-hidden', 'true');
      const name = document.createElement('span');
      name.className = 'llm-name';
      name.textContent = platform.name;
      const description = document.createElement('span');
      description.className = 'llm-desc';
      description.textContent = 'AI chat destination';
      card.append(mark, name, description);
      label.append(input, card);
      defaultPlatformGrid.appendChild(label);
    }
  }

  // ---- System prompt --------------------------------------------------------

  const savePrompt = debounce(async () => {
    prefs = await savePatch({ prompt: { system: systemPromptEl.value } });
    showSaveStatus();
  }, 500);
  systemPromptEl.addEventListener('input', () => {
    updateCharCount();
    savePrompt();
  });

  resetPromptBtn.addEventListener('click', async () => {
    systemPromptEl.value = DEFAULT_SYSTEM_PROMPT;
    updateCharCount();
    prefs = await savePatch({ prompt: { system: DEFAULT_SYSTEM_PROMPT } });
    showSaveStatus();
  });

  // ---- Skills ---------------------------------------------------------------

  addSkillBtn.addEventListener('click', async () => {
    skills.push({ id: makeSkillId('new skill'), name: 'New Skill', body: '', builtin: false });
    await persistSkills();
    renderSkills();
    const last = skillsListEl.querySelector('.skill-row:last-child .skill-name');
    if (last) { last.focus(); last.select(); }
  });

  restoreSkillsBtn.addEventListener('click', async () => {
    for (const definition of DEFAULT_SKILLS) {
      const existing = skills.find(skill => skill.id === definition.id);
      if (existing) Object.assign(existing, definition, { builtin: true });
      else skills.push({ ...definition, builtin: true });
    }
    await persistSkills();
    renderSkills();
  });

  function renderSkills() {
    skillsListEl.innerHTML = '';
    if (!skills.length) {
      const empty = document.createElement('p');
      empty.className = 'section-note';
      empty.textContent = 'No Skills. Add one, or restore the built-ins.';
      skillsListEl.appendChild(empty);
      return;
    }

    skills.forEach((skill, index) => {
      const row = document.createElement('div');
      row.className = 'skill-row';
      const head = document.createElement('div');
      head.className = 'skill-row-head';

      const name = document.createElement('input');
      name.type = 'text';
      name.className = 'skill-name';
      name.value = skill.name;
      name.placeholder = 'Skill name';
      name.addEventListener('input', debounce(async () => {
        skill.name = name.value;
        await persistSkills();
      }));

      const actions = document.createElement('div');
      actions.className = 'skill-row-actions';
      if (skill.builtin) {
        const badge = document.createElement('span');
        badge.className = 'skill-badge';
        badge.textContent = 'built-in';
        actions.appendChild(badge);
        const reset = document.createElement('button');
        reset.className = 'skill-action';
        reset.textContent = 'Reset';
        reset.title = 'Restore this Skill to its default wording';
        reset.addEventListener('click', async () => {
          const definition = DEFAULT_SKILLS.find(candidate => candidate.id === skill.id);
          if (!definition) return;
          Object.assign(skill, definition, { builtin: true });
          await persistSkills();
          renderSkills();
        });
        actions.appendChild(reset);
      }

      const remove = document.createElement('button');
      remove.className = 'skill-action danger';
      remove.textContent = 'Delete';
      remove.addEventListener('click', async () => {
        skills.splice(index, 1);
        const activeIds = prefs.skills.activeIds.filter(id => id !== skill.id);
        await persistSkills(activeIds);
        renderSkills();
      });
      actions.appendChild(remove);
      head.append(name, actions);

      const body = document.createElement('textarea');
      body.className = 'skill-body';
      body.rows = 3;
      body.value = skill.body;
      body.placeholder = 'What should the model do? e.g. "Answer as a markdown table."';
      body.addEventListener('input', debounce(async () => {
        skill.body = body.value;
        await persistSkills();
      }));

      row.append(head, body);
      skillsListEl.appendChild(row);
    });
  }

  async function persistSkills(activeIds = prefs.skills.activeIds) {
    prefs = await savePatch({ skills: { items: skills, activeIds } });
    skills = prefs.skills.items.map(skill => ({ ...skill }));
    showSaveStatus();
  }

  // ---- Export / import ------------------------------------------------------

  exportBtn.addEventListener('click', async () => {
    const exportDocument = { format: 'lark-preferences', ...await prefsClient.read() };
    const blob = new Blob([JSON.stringify(exportDocument, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'lark-settings.json';
    anchor.click();
    URL.revokeObjectURL(url);
  });

  importBtn.addEventListener('click', () => importFileEl.click());
  importFileEl.addEventListener('change', async event => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      await preferencesWriteQueue;
      prefs = await prefsClient.replace(JSON.parse(await file.text()), {
        expectedRevision: prefs.revision,
      });
      skills = prefs.skills.items.map(skill => ({ ...skill }));
      renderFromPreferences();
      showSaveStatus('Preferences imported');
    } catch (error) {
      console.error('Import error:', error);
      alert(error.message || 'Failed to import Preferences.');
    }
    importFileEl.value = '';
  });

  // ---- Shared ---------------------------------------------------------------

  // No expectedRevision here for the same reason as the side panel: these are ordinary
  // field edits that merge per section. The import path above keeps its optimistic
  // check, because replacing the whole document really can clobber someone's work.
  function savePatch(patch) {
    const operation = preferencesWriteQueue.then(async () => {
      prefs = await prefsClient.update(patch);
      return prefs;
    });
    preferencesWriteQueue = operation.catch(() => {});
    return operation;
  }

  function renderFromPreferences() {
    skills = prefs.skills.items.map(skill => ({ ...skill }));
    systemPromptEl.value = prefs.prompt.system;
    applyTheme(prefs.appearance.theme);
    syncThemeControls();
    updateCharCount();
    renderEnabledGrid();
    renderDefaultPlatformGrid();
    renderSkills();
  }

  function syncThemeControls() {
    themeOptions.forEach(option => {
      option.checked = option.value === prefs.appearance.theme;
    });
  }

  function updateCharCount() {
    charCountEl.textContent = `${systemPromptEl.value.length.toLocaleString()} characters`;
  }

  function debounce(fn, ms = 400) {
    let timeout;
    return (...args) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => fn(...args), ms);
    };
  }

  function showSaveStatus(message) {
    const text = document.getElementById('saveStatusText');
    if (text) text.textContent = message || 'Preferences saved automatically';
    saveStatusEl.classList.add('visible');
    setTimeout(() => saveStatusEl.classList.remove('visible'), 2000);
  }
});
