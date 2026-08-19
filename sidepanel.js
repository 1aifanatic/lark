// Side panel script for LARK.
// Depends on platforms.js, preferences.js, send-run.js, skills.js and github.js.
//
// Unlike the popup this replaced, the panel is long-lived: it stays open while you
// browse, so nothing here may assume the active tab is fixed. Everything page-specific
// goes through refreshForTab(), which re-runs on every tab switch and navigation.

document.addEventListener('DOMContentLoaded', async () => {
  const prefsClient = Lark.createPreferencesClient({
    runtime: chrome.runtime,
    storageChanges: chrome.storage.onChanged,
  });
  const sendRunClient = Lark.createSendRunClient(chrome.runtime);
  let prefs = await prefsClient.read();
  let preferencesWriteQueue = Promise.resolve();
  const pageTypeEl = document.getElementById('pageType');
  const pageUrlEl = document.getElementById('pageUrl');
  const extractBtn = document.getElementById('extractBtn');
  const btnText = document.getElementById('btnText');
  const statusContainer = document.getElementById('statusContainer');
  const statusEl = document.getElementById('status');
  const progressContainer = document.getElementById('progressContainer');
  const progressFill = document.getElementById('progressFill');
  const progressText = document.getElementById('progressText');
  const settingsBtn = document.getElementById('settingsBtn');
  const themeToggle = document.getElementById('themeToggle');
  const selectAllBtn = document.getElementById('selectAll');
  const clearAllBtn = document.getElementById('clearAll');
  const copyUrlBtn = document.getElementById('copyUrlBtn');
  const copyContentBtn = document.getElementById('copyContentBtn');
  const llmCounter = document.getElementById('llmCounter');
  const skillChipsEl = document.getElementById('skillChips');
  const skillCounter = document.getElementById('skillCounter');
  const repoCompare = document.getElementById('repoCompare');
  const repoCounter = document.getElementById('repoCounter');
  const repoFound = document.getElementById('repoFound');
  const repoBasketEl = document.getElementById('repoBasket');
  const compareBtn = document.getElementById('compareBtn');
  const repoPurpose = document.getElementById('repoPurpose');
  const repoReminder = document.getElementById('repoReminder');
  const repoReminderText = document.getElementById('repoReminderText');
  const repoReminderCompare = document.getElementById('repoReminderCompare');
  const repoReminderClear = document.getElementById('repoReminderClear');

  let currentTab = null;
  let isYouTube = false;
  let allSkills = [];
  let activeSkillIds = [];
  // Declared up here with the rest of the state, not down in the GitHub section:
  // refreshForTab() runs during start-up and reaches renderRepoSection(), which would
  // otherwise hit the temporal dead zone on a `let` further down the file.
  let basket = [];
  let candidates = [];

  // ---- Platform picker (generated from the Platform module) --------------------
  //
  // Only platforms enabled in Settings are shown. Absent preference means all of them.

  const llmCheckboxesEl = document.getElementById('llmCheckboxes');
  let checkboxes = [];
  renderPlatformPicker();

  function renderPlatformPicker() {
    llmCheckboxesEl.innerHTML = '';
    for (const platform of Lark.Platforms.list(prefs.platforms.enabled)) {
      const label = document.createElement('label');
      label.className = 'llm-checkbox';

      const input = document.createElement('input');
      input.type = 'checkbox';
      input.name = 'llm';
      input.value = platform.id;
      input.checked = prefs.platforms.selected.includes(platform.id);
      input.addEventListener('change', () => {
        saveSelectedPlatforms().catch(showPreferencesError);
        updateLLMCounter();
      });

      const mark = document.createElement('span');
      mark.className = `llm-mark ${platform.id}`;
      mark.textContent = platform.name.charAt(0);
      mark.setAttribute('aria-hidden', 'true');

      const name = document.createElement('span');
      name.className = 'checkbox-label';
      name.textContent = platform.name;

      label.append(input, mark, name);
      llmCheckboxesEl.appendChild(label);
    }
    checkboxes = [...llmCheckboxesEl.querySelectorAll('input[name="llm"]')];
    updateLLMCounter();
  }

  selectAllBtn.addEventListener('click', () => {
    checkboxes.forEach(cb => cb.checked = true);
    saveSelectedPlatforms().catch(showPreferencesError);
    updateLLMCounter();
  });

  clearAllBtn.addEventListener('click', () => {
    checkboxes.forEach(cb => cb.checked = false);
    saveSelectedPlatforms().catch(showPreferencesError);
    updateLLMCounter();
  });

  async function saveSelectedPlatforms() {
    const selected = getSelectedPlatformIds();
    prefs = await updatePreferences({
      platforms: { selected, default: selected[0] || prefs.platforms.default },
    });
    checkboxes.forEach(checkbox => {
      checkbox.checked = prefs.platforms.selected.includes(checkbox.value);
    });
  }

  function getSelectedPlatformIds() {
    const selected = [];
    checkboxes.forEach(cb => { if (cb.checked) selected.push(cb.value); });
    return selected;
  }

  function updateLLMCounter() {
    const count = getSelectedPlatformIds().length;
    llmCounter.textContent = `${count} selected`;
    llmCounter.classList.toggle('active', count > 0);
  }

  // ---- Theme toggle -----------------------------------------------------------

  themeToggle.addEventListener('click', async () => {
    // Cycle from the *effective* theme, so a "system" preference toggles to the
    // opposite of what is currently shown. Options page restores "system" mode.
    const effective = applyTheme(prefs.appearance.theme);
    try {
      prefs = await updatePreferences({
        appearance: { theme: effective === 'dark' ? 'light' : 'dark' },
      });
      applyTheme(prefs.appearance.theme);
    } catch (error) {
      showPreferencesError(error);
    }
  });

  // ---- Skills -----------------------------------------------------------------

  allSkills = prefs.skills.items;
  activeSkillIds = prefs.skills.activeIds.filter(id => allSkills.some(s => s.id === id));
  renderSkillChips();

  // The panel is long-lived, so Preferences changed in Options must appear without
  // closing and reopening it.
  prefsClient.observe(next => {
    prefs = next;
    allSkills = next.skills.items;
    activeSkillIds = next.skills.activeIds.filter(id => allSkills.some(skill => skill.id === id));
    renderPlatformPicker();
    applyTheme(next.appearance.theme);
    renderSkillChips();
  });

  function renderSkillChips() {
    skillChipsEl.innerHTML = '';

    if (!allSkills.length) {
      const note = document.createElement('span');
      note.className = 'empty-note';
      note.textContent = 'No skills yet — add some in Settings.';
      skillChipsEl.appendChild(note);
      updateSkillCounter();
      return;
    }

    for (const skill of allSkills) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'skill-chip';
      chip.textContent = skill.name;
      chip.title = skill.body;

      const active = activeSkillIds.includes(skill.id);
      // A chip is a toggle, so its state has to be announced, not just coloured.
      chip.setAttribute('aria-pressed', String(active));
      if (active) chip.classList.add('active');
      // Cap is a feature: past three, the instruction block starts competing with
      // the content for the model's attention.
      if (!active && activeSkillIds.length >= MAX_ACTIVE_SKILLS) chip.classList.add('disabled');

      chip.addEventListener('click', async () => {
        if (activeSkillIds.includes(skill.id)) {
          activeSkillIds = activeSkillIds.filter(id => id !== skill.id);
        } else {
          if (activeSkillIds.length >= MAX_ACTIVE_SKILLS) {
            showToast(`Up to ${MAX_ACTIVE_SKILLS} skills at once — deselect one first`, 'error');
            return;
          }
          activeSkillIds.push(skill.id); // selection order is composition order
        }
        try {
          prefs = await updatePreferences({ skills: { activeIds: activeSkillIds } });
          renderSkillChips();
        } catch (error) {
          showPreferencesError(error);
        }
      });

      skillChipsEl.appendChild(chip);
    }

    updateSkillCounter();
  }

  function updateSkillCounter() {
    skillCounter.textContent = `${activeSkillIds.length} of ${MAX_ACTIVE_SKILLS}`;
    skillCounter.classList.toggle('active', activeSkillIds.length > 0);
  }

  // ---- Current tab ------------------------------------------------------------
  //
  // The popup read the tab once and died. The panel has to keep up with you instead, so
  // every page-specific element re-renders on tab switches and navigations. Scoped to
  // the panel's own window, otherwise activity in another window repaints this one.

  const panelWindowId = await panelWindow();

  async function panelWindow() {
    try {
      return (await chrome.windows.getCurrent()).id;
    } catch {
      return chrome.windows.WINDOW_ID_CURRENT;
    }
  }

  async function refreshForTab() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, windowId: panelWindowId });
      if (!tab) return;
      currentTab = tab;

      isYouTube = isYouTubeUrl(tab.url);
      pageTypeEl.innerHTML = isYouTube
        ? '<span class="type-badge youtube">YouTube Video</span>'
        : '<span class="type-badge webpage">Webpage</span>';
      btnText.textContent = isYouTube ? 'Extract Transcript & Send' : 'Extract Page & Send';
      pageUrlEl.textContent = tab.url || '';

      await renderRepoSection();
    } catch (error) {
      showStatus('error', 'Unable to access current tab');
      console.error('Tab access error:', error);
    }
  }

  await refreshForTab();

  chrome.tabs.onActivated.addListener(info => {
    if (info.windowId === panelWindowId) refreshForTab();
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (!tab.active || tab.windowId !== panelWindowId) return;
    // url fires on navigation; status:complete catches the page settling afterwards,
    // which is when the repo scan actually has a DOM worth reading.
    if (changeInfo.url || changeInfo.status === 'complete') refreshForTab();
  });

  // ---- Content building -------------------------------------------------------

  // Copy uses the same preparation seam as a Send Run, without opening tabs.
  async function buildPageContent(onProgress = () => {}) {
    onProgress(isYouTube ? 'Extracting transcript...' : 'Reading page...');
    const prepared = await sendRunClient.prepare({ kind: 'page', windowId: panelWindowId });
    return {
      label: prepared.intake.displayLabel,
      content: prepared.content,
    };
  }

  // ---- Actions ----------------------------------------------------------------

  extractBtn.addEventListener('click', async () => {
    const selected = getSelectedPlatformIds();
    if (selected.length === 0) return showStatus('error', 'Please select at least one LLM');
    if (!currentTab) return showStatus('error', 'No active tab found');

    extractBtn.disabled = true;
    hideStatus();

    try {
      showProgress('Working...');
      updateProgress(20);
      const receipt = await sendRunClient.start(
        { kind: 'page', windowId: panelWindowId },
        { platformIds: selected }
      );

      updateProgress(100, 'Done!');
      showStatus('success', `Sent ${receipt.displayLabel} to ${summarizeNames(selected)}`);
    } catch (error) {
      showStatus('error', error.message || 'An error occurred');
      console.error('Extraction error:', error);
    } finally {
      extractBtn.disabled = false;
      hideProgress();
    }
  });

  copyContentBtn.addEventListener('click', async () => {
    try {
      const { content, label } = await buildPageContent(t => showProgress(t));
      hideProgress();
      await navigator.clipboard.writeText(content);
      showToast(`Copied ${label} to clipboard`, 'success');
    } catch (error) {
      hideProgress();
      showToast(error.message || 'Failed to copy content', 'error');
    }
  });

  copyUrlBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(currentTab.url);
      showToast('URL copied to clipboard!', 'success');
    } catch {
      showToast('Failed to copy URL', 'error');
    }
  });

  settingsBtn.addEventListener('click', () => chrome.runtime.openOptionsPage());

  // ---- GitHub repo comparison -------------------------------------------------
  //
  // Nothing is typed. Candidates are read off the GitHub page you are on, and the basket
  // persists in storage so you can queue one repo, browse to the next, and queue that
  // too. Right-click → "Add to LARK comparison" fills the same basket.
  // (`basket` and `candidates` are declared with the other state at the top.)

  async function renderRepoSection() {
    basket = await loadBasket();
    const onGitHub = isGitHubUrl(currentTab && currentTab.url);

    repoCompare.hidden = !onGitHub;
    repoReminder.hidden = onGitHub || basket.length === 0;

    if (!onGitHub) {
      // Off GitHub the section collapses, but a queued selection must not vanish
      // silently — the slim bar keeps it reachable from anywhere.
      repoReminderText.textContent =
        `${basket.length} repo${basket.length === 1 ? '' : 's'} queued`;
      return;
    }

    candidates = await scanReposOnPage();
    renderCandidates();
    renderBasket();
  }

  // activeTab is not enough here: the panel stays open across tab switches and only the
  // tab you invoked the extension on is covered, so github.com is declared in
  // host_permissions. Failure is non-fatal — the basket and right-click still work.
  async function scanReposOnPage() {
    try {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId: currentTab.id },
        func: githubReposOnPage,
      });
      return Array.isArray(result && result.result) ? result.result : [];
    } catch (e) {
      console.log('Repo scan unavailable:', e.message);
      return [];
    }
  }

  function renderCandidates() {
    repoFound.innerHTML = '';

    if (!candidates.length) {
      const note = document.createElement('span');
      note.className = 'empty-note';
      note.textContent = 'No repositories found on this page.';
      repoFound.appendChild(note);
      return;
    }

    const queued = new Set(basket.map(r => `${r.owner}/${r.name}`.toLowerCase()));

    for (const repo of candidates) {
      const full = `${repo.owner}/${repo.name}`;
      const already = queued.has(full.toLowerCase());

      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'repo-row' + (already ? ' added' : '');
      row.disabled = already || basket.length >= MAX_REPOS;
      row.title = already ? 'Already queued' : `Add ${full} to the comparison`;

      const sign = document.createElement('span');
      sign.className = 'repo-sign';
      sign.textContent = already ? '✓' : '+';
      sign.setAttribute('aria-hidden', 'true');

      const label = document.createElement('span');
      label.className = 'repo-name';
      label.textContent = full;

      row.append(sign, label);

      if (repo.stars) {
        // Read off the page as a picking hint only. Every figure in the comparison
        // itself comes from the API.
        const stars = document.createElement('span');
        stars.className = 'repo-stars';
        stars.textContent = `★ ${repo.stars}`;
        row.appendChild(stars);
      }

      row.addEventListener('click', () => addRepo(repo.owner, repo.name));
      repoFound.appendChild(row);
    }
  }

  function renderBasket() {
    repoBasketEl.innerHTML = '';
    repoCounter.textContent = `${basket.length} of ${MAX_REPOS}`;
    repoCounter.classList.toggle('active', basket.length > 0);
    compareBtn.disabled = basket.length < 2;

    if (!basket.length) {
      const note = document.createElement('span');
      note.className = 'empty-note';
      note.textContent = 'Pick two or three above, or right-click any repo link.';
      repoBasketEl.appendChild(note);
      return;
    }

    for (const repo of basket) {
      const full = `${repo.owner}/${repo.name}`;

      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'repo-row queued';
      row.title = `Remove ${full}`;
      row.setAttribute('aria-label', `Remove ${full} from the comparison`);

      const sign = document.createElement('span');
      sign.className = 'repo-sign';
      sign.textContent = '✕';
      sign.setAttribute('aria-hidden', 'true');

      const label = document.createElement('span');
      label.className = 'repo-name';
      label.textContent = full;

      row.append(sign, label);
      row.addEventListener('click', () => dropRepo(repo.owner, repo.name));
      repoBasketEl.appendChild(row);
    }
  }

  async function addRepo(owner, name) {
    const { added, reason } = await addToBasket(owner, name);
    if (!added && reason === 'full') {
      showToast(`Up to ${MAX_REPOS} repos at once — remove one first`, 'error');
      return;
    }
    basket = await loadBasket();
    renderCandidates();
    renderBasket();
  }

  async function dropRepo(owner, name) {
    basket = await removeFromBasket(owner, name);
    renderCandidates();
    renderBasket();
  }

  // The context menu writes straight to storage, so mirror it while the panel is open.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.compareBasket) renderRepoSection();
  });

  async function runComparison() {
    const selected = getSelectedPlatformIds();
    if (selected.length === 0) return showStatus('error', 'Please select at least one LLM');

    basket = await loadBasket();
    if (basket.length < 2) return showStatus('error', 'Add at least two repositories to compare');

    compareBtn.disabled = true;
    hideStatus();

    try {
      showProgress('Reading GitHub API...');
      updateProgress(30);

      const { content: comparison, names } =
        await compareRepos(basketToInputs(basket), repoPurpose.value);

      updateProgress(80, 'Opening LLMs...');
      await sendRunClient.start({
        kind: 'prepared',
        body: comparison,
        contentLabel: 'Repository Comparison',
        displayLabel: 'comparison',
        meta: [],
      }, { platformIds: selected });

      updateProgress(100, 'Done!');
      showStatus('success', `Comparing ${names.join(' vs ')}`);
    } catch (error) {
      showStatus('error', error.message || 'Comparison failed');
      console.error('Compare error:', error);
    } finally {
      compareBtn.disabled = basket.length < 2;
      hideProgress();
    }
  }

  compareBtn.addEventListener('click', runComparison);
  repoReminderCompare.addEventListener('click', runComparison);
  repoReminderClear.addEventListener('click', async () => {
    basket = await clearBasket();
    await renderRepoSection();
  });

  function summarizeNames(ids) {
    const names = ids.map(id => Lark.Platforms.get(id)?.name || id);
    return names.length > 3
      ? `${names.slice(0, 3).join(', ')} +${names.length - 3}`
      : names.join(', ');
  }

  const shortcutsToggle = document.getElementById('shortcutsToggle');
  const keyboardShortcuts = document.getElementById('keyboardShortcuts');
  shortcutsToggle.addEventListener('click', () => {
    const open = keyboardShortcuts.classList.toggle('expanded');
    shortcutsToggle.setAttribute('aria-expanded', String(open));
  });

  // Both take a raw string and never throw: the panel sees every tab you visit,
  // including chrome:// and about:blank, where URL parsing fails.
  function isYouTubeUrl(raw) {
    return hostnameOf(raw).includes('youtube.com') || hostnameOf(raw).includes('youtu.be');
  }

  function isGitHubUrl(raw) {
    return hostnameOf(raw) === 'github.com' || hostnameOf(raw) === 'www.github.com';
  }

  function hostnameOf(raw) {
    try {
      return new URL(raw).hostname.toLowerCase();
    } catch {
      return '';
    }
  }

  function showStatus(type, message) {
    statusEl.className = `status ${type}`;
    statusEl.textContent = message;
    statusContainer.classList.add('visible');
  }

  function hideStatus() {
    statusContainer.classList.remove('visible');
  }

  function showProgress(text) {
    progressText.textContent = text;
    progressContainer.classList.add('visible');
  }

  function updateProgress(percent, text) {
    progressFill.style.width = `${percent}%`;
    if (text) progressText.textContent = text;
  }

  function hideProgress() {
    progressContainer.classList.remove('visible');
    progressFill.style.width = '0%';
  }

  function showToast(message, type = 'success') {
    showStatus(type, message);
    setTimeout(hideStatus, 3000);
  }

  // Ordinary UI writes carry no expectedRevision on purpose. Toggling a Skill chip is
  // not a conflict-sensitive edit: update() merges section by section, so a Skill
  // toggle here and a theme change in Options compose cleanly instead of fighting.
  // Optimistic locking is kept where clobbering actually matters — importing
  // Preferences, which replaces the whole document.
  //
  // It used to send one, and because a write is several worker round-trips, any other
  // write landing in that window surfaced "Preferences changed before this update
  // could be saved." on a plain chip click. The local queue below is what keeps this
  // panel's own writes in order.
  function updatePreferences(patch) {
    const operation = preferencesWriteQueue.then(async () => {
      prefs = await prefsClient.update(patch);
      return prefs;
    });
    preferencesWriteQueue = operation.catch(() => {});
    return operation;
  }

  function showPreferencesError(error) {
    showToast(error?.message || 'Could not save Preferences', 'error');
  }

  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      extractBtn.click();
    }
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'C') {
      e.preventDefault();
      copyContentBtn.click();
    }
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'U') {
      e.preventDefault();
      copyUrlBtn.click();
    }
  });
});
