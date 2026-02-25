// LLM Injector Content Script
// Handles injecting content into various LLM chat interfaces

// Check for pending content on page load
checkAndInjectContent();

// Also listen for when the page becomes visible (for preloaded tabs)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    checkAndInjectContent();
  }
});

async function checkAndInjectContent() {
  const data = await chrome.storage.local.get(['pendingContent', 'targetLLM']);
  if (data.pendingContent) {
    // Wait for page to fully load
    await waitForPageReady();
    const success = await injectContent(data.pendingContent);
    if (success) {
      // Clear the pending content only if injection was successful
      chrome.storage.local.remove(['pendingContent']);
    }
  }
}

// Listen for messages from popup or background
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'injectContent') {
    injectContent(request.content)
      .then(() => sendResponse({ success: true }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
});

async function waitForPageReady() {
  // Wait for document to be fully loaded
  if (document.readyState !== 'complete') {
    await new Promise(resolve => {
      window.addEventListener('load', resolve, { once: true });
    });
  }
  
  // Additional wait for dynamic content (LLM pages are heavy SPAs)
  await sleep(2000);
  
  // Wait for input element to appear with longer timeout for new tabs
  const maxWait = 15000;
  const startTime = Date.now();
  
  while (Date.now() - startTime < maxWait) {
    const input = findInputElement();
    if (input) {
      // Extra wait to ensure the input is fully interactive
      await sleep(500);
      return;
    }
    await sleep(500);
  }
  
  console.log('LLM Extractor: Timed out waiting for input element');
}

function findInputElement() {
  const hostname = window.location.hostname;
  
  // ChatGPT selectors
  if (hostname.includes('chat.openai.com') || hostname.includes('chatgpt.com')) {
    return document.querySelector(
      '#prompt-textarea, ' +
      'textarea[data-id="root"], ' +
      'div[contenteditable="true"][data-placeholder], ' +
      'textarea[placeholder*="Message"], ' +
      'div#prompt-textarea'
    );
  }
  
  // Gemini selectors
  if (hostname.includes('gemini.google.com')) {
    return document.querySelector(
      '.ql-editor, ' +
      'div[contenteditable="true"], ' +
      'rich-textarea .ql-editor, ' +
      'div[aria-label*="Enter a prompt"], ' +
      '.input-area-container div[contenteditable="true"]'
    );
  }
  
  // Grok selectors (x.com/grok or grok.com)
  if (hostname.includes('x.com') || hostname.includes('grok.com')) {
    return document.querySelector(
      'textarea[placeholder*="Ask"], ' +
      'div[contenteditable="true"], ' +
      'textarea[data-testid], ' +
      '.r-30o5oe textarea'
    );
  }
  
  // Claude selectors
  if (hostname.includes('claude.ai')) {
    return document.querySelector(
      'div[contenteditable="true"], ' +
      'div.ProseMirror, ' +
      'fieldset div[contenteditable="true"], ' +
      'div[data-placeholder*="Reply"]'
    );
  }
  
  // DeepSeek selectors
  if (hostname.includes('deepseek.com')) {
    return document.querySelector(
      'textarea[placeholder], ' +
      '#chat-input, ' +
      'textarea.chat-input, ' +
      'div[contenteditable="true"]'
    );
  }
  
  // Kimi selectors
  if (hostname.includes('kimi.com')) {
    return document.querySelector(
      'textarea[placeholder], ' +
      'div[contenteditable="true"], ' +
      '#editor, ' +
      '.chat-input textarea'
    );
  }
  
  // Qwen selectors
  if (hostname.includes('qwen.ai')) {
    return document.querySelector(
      'textarea[placeholder], ' +
      'div[contenteditable="true"], ' +
      '#chat-input, ' +
      '.chat-input textarea'
    );
  }
  
  // Generic fallback
  return document.querySelector(
    'textarea:not([readonly]), ' +
    'div[contenteditable="true"]:not([aria-hidden="true"])'
  );
}

async function injectContent(content) {
  const input = findInputElement();
  
  if (!input) {
    console.log('LLM Extractor: Could not find input element, will retry...');
    return false;
  }
  
  const hostname = window.location.hostname;
  
  try {
    // Different injection strategies for different platforms
    if (hostname.includes('chat.openai.com') || hostname.includes('chatgpt.com')) {
      await injectToChatGPT(input, content);
    } else if (hostname.includes('gemini.google.com')) {
      await injectToGemini(input, content);
    } else if (hostname.includes('x.com') || hostname.includes('grok.com')) {
      await injectToGrok(input, content);
    } else if (hostname.includes('claude.ai')) {
      await injectToClaude(input, content);
    } else if (hostname.includes('deepseek.com')) {
      await injectToDeepSeek(input, content);
    } else if (hostname.includes('kimi.com')) {
      await injectToKimi(input, content);
    } else if (hostname.includes('qwen.ai')) {
      await injectToQwen(input, content);
    } else {
      await injectGeneric(input, content);
    }
    
    console.log('LLM Extractor: Content injected successfully');
    return true;
  } catch (error) {
    console.error('LLM Extractor: Injection failed:', error);
    return false;
  }
}

async function injectToChatGPT(input, content) {
  // ChatGPT uses a contenteditable div with ProseMirror or a textarea
  if (input.tagName === 'TEXTAREA') {
    // Direct textarea
    input.focus();
    input.value = content;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    
    // Trigger React's onChange
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype, 'value'
    ).set;
    nativeInputValueSetter.call(input, content);
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  } else if (input.contentEditable === 'true') {
    // ContentEditable div (newer ChatGPT)
    input.focus();
    
    // Clear existing content
    input.innerHTML = '';
    
    // Create paragraph elements for each line
    const lines = content.split('\n');
    for (const line of lines) {
      const p = document.createElement('p');
      p.textContent = line || '\u200B'; // Zero-width space for empty lines
      input.appendChild(p);
    }
    
    // Trigger input event
    input.dispatchEvent(new InputEvent('input', { 
      bubbles: true, 
      cancelable: true,
      inputType: 'insertText',
      data: content
    }));
  }
  
  // Move cursor to end
  await sleep(100);
  moveCursorToEnd(input);
}

async function injectToGemini(input, content) {
  // Gemini uses Quill editor or contenteditable
  input.focus();
  
  if (input.classList.contains('ql-editor')) {
    // Quill editor
    input.innerHTML = '';
    const lines = content.split('\n');
    for (const line of lines) {
      const p = document.createElement('p');
      p.textContent = line || '';
      input.appendChild(p);
    }
  } else {
    // ContentEditable
    input.textContent = content;
  }
  
  // Trigger input events
  input.dispatchEvent(new InputEvent('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  
  await sleep(100);
  moveCursorToEnd(input);
}

async function injectToGrok(input, content) {
  input.focus();
  
  if (input.tagName === 'TEXTAREA') {
    input.value = content;
    
    // React synthetic event handling
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype, 'value'
    ).set;
    nativeInputValueSetter.call(input, content);
    
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  } else {
    // ContentEditable
    input.textContent = content;
    input.dispatchEvent(new InputEvent('input', { bubbles: true }));
  }
  
  await sleep(100);
  moveCursorToEnd(input);
}

async function injectToClaude(input, content) {
  // Claude uses ProseMirror
  input.focus();
  
  // Clear existing content
  input.innerHTML = '';
  
  // Split by newlines and create paragraphs
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const p = document.createElement('p');
    if (line.trim()) {
      p.textContent = line;
    } else {
      p.innerHTML = '<br>';
    }
    input.appendChild(p);
  }
  
  // Trigger input event for ProseMirror
  input.dispatchEvent(new InputEvent('input', { 
    bubbles: true,
    cancelable: true,
    inputType: 'insertText'
  }));
  
  await sleep(100);
  moveCursorToEnd(input);
}

async function injectToDeepSeek(input, content) {
  input.focus();
  
  if (input.tagName === 'TEXTAREA') {
    // DeepSeek uses textarea
    input.value = content;
    
    // Trigger React events
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype, 'value'
    ).set;
    nativeInputValueSetter.call(input, content);
    
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  } else {
    input.textContent = content;
    input.dispatchEvent(new InputEvent('input', { bubbles: true }));
  }
  
  await sleep(100);
  moveCursorToEnd(input);
}

async function injectToKimi(input, content) {
  input.focus();
  
  if (input.tagName === 'TEXTAREA') {
    input.value = content;
    
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype, 'value'
    ).set;
    nativeInputValueSetter.call(input, content);
    
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  } else if (input.contentEditable === 'true') {
    // ContentEditable
    input.innerHTML = '';
    const lines = content.split('\n');
    for (const line of lines) {
      const p = document.createElement('p');
      p.textContent = line || '\u200B';
      input.appendChild(p);
    }
    input.dispatchEvent(new InputEvent('input', { bubbles: true }));
  } else {
    input.textContent = content;
    input.dispatchEvent(new InputEvent('input', { bubbles: true }));
  }
  
  await sleep(100);
  moveCursorToEnd(input);
}

async function injectToQwen(input, content) {
  input.focus();
  
  if (input.tagName === 'TEXTAREA') {
    input.value = content;
    
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype, 'value'
    ).set;
    nativeInputValueSetter.call(input, content);
    
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  } else if (input.contentEditable === 'true') {
    input.innerHTML = '';
    const lines = content.split('\n');
    for (const line of lines) {
      const p = document.createElement('p');
      p.textContent = line || '\u200B';
      input.appendChild(p);
    }
    input.dispatchEvent(new InputEvent('input', { bubbles: true }));
  } else {
    input.textContent = content;
    input.dispatchEvent(new InputEvent('input', { bubbles: true }));
  }
  
  await sleep(100);
  moveCursorToEnd(input);
}

async function injectGeneric(input, content) {
  input.focus();
  
  if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
    input.value = content;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  } else {
    input.textContent = content;
    input.dispatchEvent(new InputEvent('input', { bubbles: true }));
  }
  
  await sleep(100);
  moveCursorToEnd(input);
}

function moveCursorToEnd(element) {
  if (element.tagName === 'TEXTAREA' || element.tagName === 'INPUT') {
    element.selectionStart = element.value.length;
    element.selectionEnd = element.value.length;
  } else {
    // ContentEditable
    const range = document.createRange();
    const selection = window.getSelection();
    range.selectNodeContents(element);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

