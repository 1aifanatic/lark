// Popup script for LLM Content Extractor

// LLM URLs mapping
const LLM_URLS = {
  chatgpt: 'https://chatgpt.com/?model=auto',
  gemini: 'https://gemini.google.com/app',
  grok: 'https://grok.com/',
  claude: 'https://claude.ai/new',
  deepseek: 'https://chat.deepseek.com/',
  kimi: 'https://www.kimi.com/',
  qwen: 'https://chat.qwen.ai/'
};

const LLM_NAMES = {
  chatgpt: 'ChatGPT',
  gemini: 'Gemini',
  grok: 'Grok',
  claude: 'Claude',
  deepseek: 'DeepSeek',
  kimi: 'Kimi',
  qwen: 'Qwen'
};

document.addEventListener('DOMContentLoaded', async () => {
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
  const selectAllBtn = document.getElementById('selectAll');
  const clearAllBtn = document.getElementById('clearAll');
  const checkboxes = document.querySelectorAll('input[name="llm"]');
  const copyUrlBtn = document.getElementById('copyUrlBtn');
  const copyContentBtn = document.getElementById('copyContentBtn');
  const llmCounter = document.getElementById('llmCounter');

  let currentTab = null;
  let isYouTube = false;
  let lastExtractedContent = null;

  // Load saved LLM preferences
  const { selectedLLMs } = await chrome.storage.local.get('selectedLLMs');
  if (selectedLLMs && selectedLLMs.length > 0) {
    // Uncheck all first
    checkboxes.forEach(cb => cb.checked = false);
    // Check saved ones
    selectedLLMs.forEach(llm => {
      const cb = document.querySelector(`input[name="llm"][value="${llm}"]`);
      if (cb) cb.checked = true;
    });
  }

  // Save LLM selection on change
  checkboxes.forEach(cb => {
    cb.addEventListener('change', () => {
      saveSelectedLLMs();
      updateLLMCounter();
    });
  });

  // Initialize counter
  updateLLMCounter();

  // Select All button
  selectAllBtn.addEventListener('click', () => {
    checkboxes.forEach(cb => cb.checked = true);
    saveSelectedLLMs();
    updateLLMCounter();
  });

  // Clear All button
  clearAllBtn.addEventListener('click', () => {
    checkboxes.forEach(cb => cb.checked = false);
    saveSelectedLLMs();
    updateLLMCounter();
  });

  // Copy URL button
  copyUrlBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(currentTab.url);
      showToast('URL copied to clipboard!', 'success');
    } catch (error) {
      showToast('Failed to copy URL', 'error');
    }
  });

  // Copy Content button
  copyContentBtn.addEventListener('click', async () => {
    try {
      let content;
      if (isYouTube) {
        showProgress('Extracting transcript...');
        const response = await chrome.tabs.sendMessage(currentTab.id, {
          action: 'extractTranscript'
        });
        hideProgress();

        if (!response.success) {
          throw new Error(response.error || 'Failed to extract transcript');
        }

        const { systemPrompt } = await chrome.storage.local.get('systemPrompt');
        const prompt = systemPrompt || 'Please analyze the following content:';
        content = composeContent(prompt, response.transcript, true, currentTab.url, response.videoTitle);
      } else {
        const { systemPrompt } = await chrome.storage.local.get('systemPrompt');
        const prompt = systemPrompt || 'Please analyze the following webpage:';
        content = composeContent(prompt, currentTab.url, false, currentTab.url, currentTab.title);
      }

      await navigator.clipboard.writeText(content);
      lastExtractedContent = content;
      showToast('Content copied to clipboard!', 'success');
    } catch (error) {
      showToast(error.message || 'Failed to copy content', 'error');
    }
  });

  async function saveSelectedLLMs() {
    const selected = getSelectedLLMs();
    await chrome.storage.local.set({ selectedLLMs: selected });
    // Also save the first one as default for the YouTube button
    if (selected.length > 0) {
      await chrome.storage.local.set({ selectedLLM: selected[0] });
    }
  }

  function getSelectedLLMs() {
    const selected = [];
    checkboxes.forEach(cb => {
      if (cb.checked) selected.push(cb.value);
    });
    return selected;
  }

  // Get current tab info
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTab = tab;
    
    const url = new URL(tab.url);
    isYouTube = isYouTubeUrl(url);
    
    // Update UI based on page type
    if (isYouTube) {
      pageTypeEl.innerHTML = '<span class="type-badge youtube">YouTube Video</span>';
      btnText.textContent = 'Extract Transcript & Send';
    } else {
      pageTypeEl.innerHTML = '<span class="type-badge webpage">Webpage</span>';
      btnText.textContent = 'Extract URL & Send';
    }
    
    pageUrlEl.textContent = tab.url;
  } catch (error) {
    showStatus('error', 'Unable to access current tab');
    console.error('Tab access error:', error);
  }

  // Extract button click handler
  extractBtn.addEventListener('click', async () => {
    const selectedLLMs = getSelectedLLMs();
    
    if (selectedLLMs.length === 0) {
      showStatus('error', 'Please select at least one LLM');
      return;
    }

    if (!currentTab) {
      showStatus('error', 'No active tab found');
      return;
    }

    extractBtn.disabled = true;
    hideStatus();

    try {
      if (isYouTube) {
        await extractYouTubeTranscript(selectedLLMs);
      } else {
        await extractWebpageUrl(selectedLLMs);
      }
    } catch (error) {
      showStatus('error', error.message || 'An error occurred');
      console.error('Extraction error:', error);
    } finally {
      extractBtn.disabled = false;
      hideProgress();
    }
  });

  // Settings button click handler
  settingsBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // Keyboard shortcuts toggle
  const shortcutsToggle = document.getElementById('shortcutsToggle');
  const keyboardShortcuts = document.getElementById('keyboardShortcuts');

  shortcutsToggle.addEventListener('click', () => {
    keyboardShortcuts.classList.toggle('expanded');
  });

  // Helper functions
  function isYouTubeUrl(url) {
    const hostname = url.hostname.toLowerCase();
    return hostname.includes('youtube.com') || hostname.includes('youtu.be');
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

  async function extractYouTubeTranscript(selectedLLMs) {
    showProgress('Extracting transcript...');
    updateProgress(20);

    // Send message to content script to extract transcript
    const response = await chrome.tabs.sendMessage(currentTab.id, {
      action: 'extractTranscript'
    });

    if (!response.success) {
      throw new Error(response.error || 'Failed to extract transcript');
    }

    updateProgress(60, 'Preparing content...');

    // Get system prompt from storage
    const { systemPrompt } = await chrome.storage.local.get('systemPrompt');
    const prompt = systemPrompt || 'Please analyze the following content:';

    // Compose the final content
    const content = composeContent(prompt, response.transcript, true, currentTab.url, response.videoTitle);

    updateProgress(80, 'Opening LLMs...');

    // Send to all selected LLMs
    await sendToMultipleLLMs(content, selectedLLMs);

    updateProgress(100, 'Done!');
    const llmNames = selectedLLMs.map(l => LLM_NAMES[l]).join(', ');
    showStatus('success', `Sent to ${llmNames}`);
  }

  async function extractWebpageUrl(selectedLLMs) {
    showProgress('Preparing content...');
    updateProgress(40);

    // Get system prompt from storage
    const { systemPrompt } = await chrome.storage.local.get('systemPrompt');
    const prompt = systemPrompt || 'Please analyze the following webpage:';

    // Compose the final content
    const content = composeContent(prompt, currentTab.url, false, currentTab.url, currentTab.title);

    updateProgress(70, 'Opening LLMs...');

    // Send to all selected LLMs
    await sendToMultipleLLMs(content, selectedLLMs);

    updateProgress(100, 'Done!');
    const llmNames = selectedLLMs.map(l => LLM_NAMES[l]).join(', ');
    showStatus('success', `Sent to ${llmNames}`);
  }

  function composeContent(systemPrompt, content, isTranscript, url, title) {
    const separator = '\n\n---\n\n';
    let composed = systemPrompt + separator;
    
    if (isTranscript) {
      composed += `**Video Title:** ${title || 'Unknown'}\n`;
      composed += `**Video URL:** ${url}\n\n`;
      composed += `**Transcript:**\n${content}`;
    } else {
      composed += `**Page Title:** ${title || 'Unknown'}\n`;
      composed += `**URL:** ${content}`;
    }
    
    return composed;
  }

  async function sendToMultipleLLMs(content, selectedLLMs) {
    // Store content for the LLM injector to use
    await chrome.storage.local.set({
      pendingContent: content,
      pendingLLMs: selectedLLMs
    });

    // Open a new tab for each selected LLM
    for (let i = 0; i < selectedLLMs.length; i++) {
      const llm = selectedLLMs[i];
      const targetUrl = LLM_URLS[llm];

      // Small delay between opening tabs to avoid overwhelming
      if (i > 0) {
        await new Promise(resolve => setTimeout(resolve, 300));
      }

      chrome.tabs.create({ url: targetUrl });
    }
  }

  function updateLLMCounter() {
    const selected = getSelectedLLMs();
    const count = selected.length;
    llmCounter.textContent = `${count} selected`;

    if (count > 0) {
      llmCounter.classList.add('active');
    } else {
      llmCounter.classList.remove('active');
    }
  }

  function showToast(message, type = 'success') {
    showStatus(type, message);
    setTimeout(() => {
      hideStatus();
    }, 3000);
  }

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    // Cmd/Ctrl + Enter to extract and send
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      extractBtn.click();
    }

    // Cmd/Ctrl + Shift + C to copy content
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'C') {
      e.preventDefault();
      copyContentBtn.click();
    }

    // Cmd/Ctrl + Shift + U to copy URL
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'U') {
      e.preventDefault();
      copyUrlBtn.click();
    }
  });
});
