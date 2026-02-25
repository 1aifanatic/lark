// Background Service Worker for LLM Content Extractor

// Handle messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'injectContentToTab') {
    injectContentToTab(request.tabId, request.content)
      .then(() => sendResponse({ success: true }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
});

// Inject content script and then inject content
async function injectContentToTab(tabId, content) {
  try {
    // First, try to inject the content script if not already injected
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ['llm-injector.js']
    });
  } catch (e) {
    // Script might already be injected, that's fine
    console.log('Script injection note:', e.message);
  }
  
  // Wait a bit for script to initialize
  await sleep(500);
  
  // Send message to inject content
  try {
    await chrome.tabs.sendMessage(tabId, {
      action: 'injectContent',
      content: content
    });
  } catch (e) {
    console.error('Failed to send message to tab:', e);
    throw e;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Handle installation
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    // Set default settings on first install
    chrome.storage.local.set({
      selectedLLM: 'chatgpt',
      systemPrompt: `Please analyze the following content and provide:

1. A concise summary (2-3 paragraphs)
2. Key takeaways and main points
3. Any actionable insights or recommendations

Be thorough but focused. Highlight the most important information.`
    });
  }
});

