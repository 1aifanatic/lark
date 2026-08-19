// Platform domain module.
// Runtime source of truth for supported AI chat destinations. Chrome's static
// manifest intentionally repeats URL matches and is verified against this catalog.

(function initPlatforms(root) {
  const Lark = root.Lark = root.Lark || {};

  const DEFINITIONS = [
    {
      id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com/?model=auto', color: '#10a37f',
      hosts: ['chatgpt.com', 'chat.openai.com'], editor: 'paragraphs',
      selectors: ['#prompt-textarea', 'textarea[data-id="root"]', 'div[contenteditable="true"][data-placeholder]', 'textarea[placeholder*="Message"]'],
    },
    {
      id: 'gemini', name: 'Gemini', url: 'https://gemini.google.com/app', color: '#4285f4',
      hosts: ['gemini.google.com'], editor: 'quill',
      selectors: ['.ql-editor', 'rich-textarea .ql-editor', 'div[aria-label*="Enter a prompt"]', '.input-area-container div[contenteditable="true"]'],
    },
    {
      id: 'claude', name: 'Claude', url: 'https://claude.ai/new', color: '#C15F3C',
      hosts: ['claude.ai'], editor: 'paragraphs',
      selectors: ['div.ProseMirror', 'fieldset div[contenteditable="true"]', 'div[data-placeholder*="Reply"]', 'div[contenteditable="true"]'],
    },
    {
      id: 'grok', name: 'Grok', url: 'https://grok.com/', color: '#3C3B37',
      hosts: ['grok.com', 'x.com'], editor: 'react',
      selectors: ['textarea[placeholder*="Ask"]', 'textarea[data-testid]', '.r-30o5oe textarea', 'div[contenteditable="true"]'],
    },
    {
      id: 'deepseek', name: 'DeepSeek', url: 'https://chat.deepseek.com/', color: '#4D6BFE',
      hosts: ['chat.deepseek.com'], editor: 'react',
      selectors: ['#chat-input', 'textarea.chat-input', 'textarea[placeholder]', 'div[contenteditable="true"]'],
    },
    {
      id: 'kimi', name: 'Kimi', url: 'https://www.kimi.com/', color: '#8B5CF6',
      hosts: ['kimi.com', 'www.kimi.com'], editor: 'react',
      selectors: ['#editor', '.chat-input textarea', 'textarea[placeholder]', 'div[contenteditable="true"]'],
    },
    {
      id: 'qwen', name: 'Qwen', url: 'https://chat.qwen.ai/', color: '#EC4899',
      hosts: ['chat.qwen.ai'], editor: 'react',
      selectors: ['#chat-input', '.chat-input textarea', 'textarea[placeholder]', 'div[contenteditable="true"]'],
    },
    {
      id: 'perplexity', name: 'Perplexity', url: 'https://www.perplexity.ai/', color: '#20808D',
      hosts: ['perplexity.ai', 'www.perplexity.ai'], editor: 'react',
      selectors: ['textarea[data-testid="search-input"]', 'textarea[placeholder*="Ask"]', 'div[contenteditable="true"]'],
    },
    {
      id: 'poe', name: 'Poe', url: 'https://poe.com/', color: '#6A4CFF',
      hosts: ['poe.com'], editor: 'react',
      selectors: ['textarea[placeholder*="Message"]', 'textarea[placeholder]', 'div[contenteditable="true"]'],
    },
    {
      id: 'mistral', name: 'Mistral', url: 'https://chat.mistral.ai/chat', color: '#F7B500',
      hosts: ['chat.mistral.ai'], editor: 'react',
      selectors: ['.chat-input textarea', 'textarea[placeholder]', 'div[contenteditable="true"]'],
    },
    {
      id: 'huggingchat', name: 'HuggingChat', url: 'https://huggingface.co/chat/', color: '#FFD21E',
      hosts: ['huggingface.co'], editor: 'react',
      selectors: ['textarea[placeholder*="Message"]', 'textarea[placeholder]', 'div[contenteditable="true"]'],
    },
    {
      id: 'copilot', name: 'Copilot', url: 'https://copilot.microsoft.com/', color: '#4B5BFC',
      hosts: ['copilot.microsoft.com'], editor: 'react',
      selectors: ['textarea[aria-label*="prompt"]', 'textarea[placeholder*="Ask"]', 'textarea[placeholder]', 'div[contenteditable="true"]'],
    },
  ];

  const byId = new Map(DEFINITIONS.map(definition => [definition.id, definition]));

  function list(ids) {
    const selected = ids == null
      ? DEFINITIONS
      : ids.map(id => {
          const definition = byId.get(id);
          if (!definition) throw platformError('PLATFORM_UNKNOWN', `Unknown Platform: ${id}`);
          return definition;
        });
    return selected.map(publicDefinition);
  }

  function get(id) {
    const definition = byId.get(id);
    return definition ? publicDefinition(definition) : null;
  }

  function match(rawUrl) {
    let url;
    try {
      url = new URL(rawUrl);
    } catch {
      return null;
    }
    const host = url.hostname.toLowerCase();
    const definition = DEFINITIONS.find(candidate =>
      candidate.hosts.includes(host) &&
      (candidate.id !== 'grok' || host !== 'x.com' || url.pathname.startsWith('/i/grok'))
    );
    return definition ? publicDefinition(definition) : null;
  }

  async function paste({ url, document, window, content, deadlineMs = 17500 }) {
    const matched = matchDefinition(url);
    if (!matched) throw platformError('PLATFORM_LOCATION_UNMATCHED', 'This page is not a supported Platform.');
    if (typeof content !== 'string' || !content) {
      throw platformError('PLATFORM_INVALID_CONTENT', 'Delivery content is empty.');
    }
    if (!document || !window) throw platformError('PLATFORM_EDITOR_UNSUPPORTED', 'A DOM adapter is required.');

    const editor = await waitForEditor(matched, document, deadlineMs);
    const adapter = EDITOR_ADAPTERS[matched.editor];
    if (!adapter) throw platformError('PLATFORM_EDITOR_UNSUPPORTED', `Unsupported editor: ${matched.editor}`);

    await adapter(editor, content, document, window);
    const actual = readEditor(editor);
    if (normalizeDraft(actual) !== normalizeDraft(content)) {
      throw platformError('PLATFORM_EDITOR_VERIFY_FAILED', 'The Platform editor did not retain the delivered content.');
    }
    moveCursorToEnd(editor, document, window);
    return { platformId: matched.id, editorKind: matched.editor, verified: true };
  }

  async function waitForEditor(definition, document, deadlineMs) {
    const started = Date.now();
    while (Date.now() - started <= deadlineMs) {
      const editor = document.querySelector(definition.selectors.join(', '));
      if (editor) return editor;
      await sleep(Math.min(100, deadlineMs || 1));
    }
    throw platformError('PLATFORM_EDITOR_TIMEOUT', `Could not find the ${definition.name} editor.`);
  }

  const EDITOR_ADAPTERS = {
    react: writeReactEditor,
    paragraphs: writeParagraphEditor,
    quill: writeQuillEditor,
  };

  async function writeReactEditor(editor, content, document, window) {
    editor.focus();
    dispatchBeforeInput(editor, window, content);
    if (isTextControl(editor)) {
      setNativeValue(editor, content, window);
    } else {
      editor.textContent = content;
    }
    dispatchEditorEvents(editor, window, content);
  }

  async function writeParagraphEditor(editor, content, document, window) {
    if (isTextControl(editor)) return writeReactEditor(editor, content, document, window);
    editor.focus();
    dispatchBeforeInput(editor, window, content);
    editor.innerHTML = '';
    for (const line of content.split('\n')) {
      const paragraph = document.createElement('p');
      paragraph.textContent = line || '\u200B';
      editor.appendChild(paragraph);
    }
    dispatchEditorEvents(editor, window, content);
  }

  async function writeQuillEditor(editor, content, document, window) {
    if (isTextControl(editor)) return writeReactEditor(editor, content, document, window);
    editor.focus();
    dispatchBeforeInput(editor, window, content);
    if (editor.classList && editor.classList.contains('ql-editor')) {
      editor.innerHTML = '';
      for (const line of content.split('\n')) {
        const paragraph = document.createElement('p');
        paragraph.textContent = line || '\u200B';
        editor.appendChild(paragraph);
      }
    } else {
      editor.textContent = content;
    }
    dispatchEditorEvents(editor, window, content);
  }

  function setNativeValue(editor, content, window) {
    const prototype = editor.tagName === 'INPUT'
      ? window.HTMLInputElement && window.HTMLInputElement.prototype
      : window.HTMLTextAreaElement && window.HTMLTextAreaElement.prototype;
    const setter = prototype && Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    if (setter) setter.call(editor, content);
    else editor.value = content;
  }

  function dispatchEditorEvents(editor, window, content) {
    const EventCtor = window.Event || Event;
    editor.dispatchEvent(new EventCtor('input', { bubbles: true, composed: true }));
    editor.dispatchEvent(new EventCtor('change', { bubbles: true }));
  }

  function dispatchBeforeInput(editor, window, content) {
    if (window.InputEvent) {
      editor.dispatchEvent(new window.InputEvent('beforeinput', {
        bubbles: true, cancelable: true, inputType: 'insertText', data: content,
      }));
    }
  }

  function readEditor(editor) {
    if (isTextControl(editor)) return editor.value || '';
    return editor.innerText || editor.textContent || '';
  }

  function normalizeDraft(value) {
    return String(value || '').replace(/\u200B/g, '').replace(/\r\n/g, '\n').trim();
  }

  function isTextControl(editor) {
    return editor.tagName === 'TEXTAREA' || editor.tagName === 'INPUT';
  }

  function moveCursorToEnd(editor, document, window) {
    if (isTextControl(editor)) {
      editor.selectionStart = editor.value.length;
      editor.selectionEnd = editor.value.length;
      return;
    }
    if (!document.createRange || !window.getSelection) return;
    const range = document.createRange();
    const selection = window.getSelection();
    range.selectNodeContents(editor);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function matchDefinition(rawUrl) {
    const matched = match(rawUrl);
    return matched ? byId.get(matched.id) : null;
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function publicDefinition(definition) {
    return {
      id: definition.id,
      name: definition.name,
      url: definition.url,
      color: definition.color,
    };
  }

  function platformError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  Lark.Platforms = Object.freeze({ list, get, match, paste });
})(globalThis);
