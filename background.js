// Background Service Worker for LARK
//
// Handles: message routing from the side panel, the right-click context menus, the
// browser-wide keyboard command (Alt+Shift+X), and the comparison basket badge. Shares
// the skill definitions, Platform catalog, Page Intake and GitHub helpers
// with the other surfaces.

importScripts(
  'platforms.js',
  'skills.js',
  'preferences.js',
  'page-text.js',
  'page-intake.js',
  'send-run.js',
  'github.js'
);

const preferences = Lark.createPreferences({
  storage: chrome.storage.local,
  platformIds: Lark.Platforms.list().map(platform => platform.id),
  defaults: {
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    skills: DEFAULT_SKILLS.map(skill => ({ ...skill, builtin: true })),
    theme: 'system',
  },
});

const pageIntake = Lark.createPageIntake({
  resolveTab: resolveIntakeTab,
  readArticle: tab => readPageText(tab.id),
  readTranscript: async tab => {
    const response = await chrome.tabs.sendMessage(tab.id, { action: 'extractTranscript' });
    if (!response?.success || !response.transcript) {
      const error = new Error(response?.error || 'Failed to extract transcript');
      error.code = 'INTAKE_TRANSCRIPT_UNAVAILABLE';
      throw error;
    }
    return { body: response.transcript, title: response.videoTitle || tab.title || '' };
  },
});

const runStorage = chrome.storage.session;
const sendRun = Lark.createSendRun({
  preferences,
  pageIntake,
  platforms: Lark.Platforms,
  compose: composeMessage,
  tabs: { create: options => chrome.tabs.create(options) },
  runStore: Lark.createChromeRunStore(runStorage),
});

// One-way cleanup from the retired global-slot delivery protocol. New Deliveries
// live only in session storage and are bound to their created tab IDs.
chrome.storage.local.remove(['pendingContent', 'pendingStamp', 'pendingLLMs']).catch(() => {});

// Clicking the toolbar icon opens the side panel. Runs on every worker start rather than
// only onInstalled, because the worker is torn down and restarted constantly and the
// behaviour has to be registered each time.
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(e => console.log('Side panel behaviour not set:', e.message));

// ---- Runtime module interfaces -----------------------------------------------

const runtimeHandlers = {
  'preferences.read': () => preferences.read(),
  'preferences.update': request => preferences.update(request.patch, request.options),
  'preferences.replace': request => preferences.replace(request.document, request.options),
  'sendRun.prepare': (request, sender) => sendRun.prepare(request.intent, {
    context: runtimeIntakeContext(sender),
  }),
  'sendRun.start': (request, sender) => sendRun.start(request.intent, {
    ...(request.options || {}),
    context: runtimeIntakeContext(sender),
  }),
  'sendRun.claim': (request, sender) => {
    const platform = sender.tab?.url ? Lark.Platforms.match(sender.tab.url) : null;
    if (!platform || platform.id !== request.platformId) return null;
    return sendRun.claim({ tabId: sender.tab.id, platformId: platform.id });
  },
  'sendRun.settle': request => sendRun.settle(request.settlement),
};

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const handler = runtimeHandlers[request?.action];
  if (!handler) return undefined;
  Promise.resolve()
    .then(() => handler(request, sender))
    .then(value => sendResponse({ ok: true, value }))
    .catch(error => sendResponse({ ok: false, error: serializeRuntimeError(error) }));
  return true;
});

function runtimeIntakeContext(sender) {
  return sender?.tab ? { senderTab: sender.tab } : {};
}

async function resolveIntakeTab(intent, context) {
  if (context?.senderTab?.id != null) return context.senderTab;
  if (intent?.tabId != null) {
    const tab = await chrome.tabs.get(intent.tabId);
    if (intent.expectedUrl && tab.url !== intent.expectedUrl) {
      const error = new Error('The page changed before content could be captured.');
      error.code = 'INTAKE_SOURCE_CHANGED';
      throw error;
    }
    return tab;
  }
  const query = { active: true };
  if (intent?.windowId != null) query.windowId = intent.windowId;
  else query.currentWindow = true;
  const [tab] = await chrome.tabs.query(query);
  return tab || null;
}

function serializeRuntimeError(error) {
  return {
    code: error?.code || 'LARK_RUNTIME_FAILED',
    message: error?.message || 'LARK request failed.',
    retryable: Boolean(error?.retryable),
    ...(error?.details ? { details: error.details } : {}),
  };
}

// ---- Context menus + browser-wide command -----------------------------------

const CONTEXT_MENU_ID = 'lark-send';

chrome.runtime.onInstalled.addListener(async (details) => {
  // Reading once creates defaults for a new install or lazily migrates an existing
  // installation's flat preference keys into the versioned Preferences record.
  await preferences.read();

  // Root parent + one child per context. A parent with children shows a submenu,
  // which keeps the right-click menu tidy.
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: CONTEXT_MENU_ID,
      title: 'Send with LARK',
      contexts: ['page', 'selection', 'link'],
    });
    chrome.contextMenus.create({
      id: 'send-page',
      parentId: CONTEXT_MENU_ID,
      title: 'Send this page',
      contexts: ['page'],
    });
    chrome.contextMenus.create({
      id: 'send-selection',
      parentId: CONTEXT_MENU_ID,
      title: 'Send selection',
      contexts: ['selection'],
    });
    chrome.contextMenus.create({
      id: 'send-link',
      parentId: CONTEXT_MENU_ID,
      title: 'Send this link',
      contexts: ['link'],
    });

    // Repo picking, path B. A top-level item rather than a child of "Send with LARK",
    // because it queues rather than sends. Scoped to github.com so it never appears
    // anywhere it cannot work.
    chrome.contextMenus.create({
      id: 'add-repo',
      title: 'Add to LARK comparison',
      contexts: ['link', 'page'],
      documentUrlPatterns: ['*://github.com/*', '*://www.github.com/*'],
      targetUrlPatterns: ['*://github.com/*', '*://www.github.com/*'],
    });
  });

  await refreshBasketBadge();
});

// The basket count rides on the toolbar icon — a context menu cannot show a toast, so
// this is the only feedback the right-click path can give.
async function refreshBasketBadge() {
  try {
    const basket = await loadBasket();
    await chrome.action.setBadgeText({ text: basket.length ? String(basket.length) : '' });
    await chrome.action.setBadgeBackgroundColor({ color: '#B85C38' });
  } catch (e) {
    console.log('Badge update failed:', e.message);
  }
}

// Keeps the badge honest when the side panel adds or removes repos.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.compareBasket) refreshBasketBadge();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'add-repo') {
    addRepoFromContext(info, tab);
    return;
  }

  const kind = info.menuItemId === 'send-page' ? 'page'
    : info.menuItemId === 'send-selection' ? 'selection'
    : info.menuItemId === 'send-link' ? 'link'
    : null;
  if (kind) sendContext(kind, info, tab);
});

// Right-click → "Add to LARK comparison". Prefers the link you clicked; falls back to
// the repo the page itself is, so right-clicking anywhere on a repo page queues it.
async function addRepoFromContext(info, tab) {
  const target = info.linkUrl || info.pageUrl || (tab && tab.url) || '';
  const repo = parseRepoInput(target);

  if (!repo || !isLikelyRepo(repo.owner, repo.name)) {
    console.log('LARK: no repo in', target);
    return;
  }

  const { added, reason, basket } = await addToBasket(repo.owner, repo.name);
  await refreshBasketBadge();
  console.log(added
    ? `LARK: queued ${repo.owner}/${repo.name} (${basket.length}/${MAX_REPOS})`
    : `LARK: not queued (${reason})`);
}

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'extract-send') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.id != null) await sendContext('page', {}, tab);
});

// Compose and send whatever the current context points at, then open the LLMs.
async function sendContext(kind, info, tab) {
  if (!tab || tab.id == null || !tab.url) return;

  try {
    const intent = kind === 'selection'
      ? { kind: 'selection', text: info.selectionText }
      : kind === 'link'
        ? { kind: 'link', url: info.linkUrl }
        : { kind: 'page' };
    await sendRun.start(intent, { context: { senderTab: tab } });
  } catch (error) {
    console.error('LARK send failed:', error);
  }
}

// activeTab covers injection on the user's gesture (right-click / command), so no
// broad host permission is needed. Returns null on restricted pages.
async function readPageText(tabId) {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: readableTextFromPage,
    });
    const out = result?.result;
    if (!out || !out.text) return null;

    return out;
  } catch (e) {
    console.log('Page text extraction unavailable:', e.message);
    return null;
  }
}
