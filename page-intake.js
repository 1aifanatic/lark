// Page Intake domain module.
// Captures canonical content and metadata; it never reads Preferences, composes a
// prompt, or opens a Platform tab.

(function initPageIntake(root) {
  const Lark = root.Lark = root.Lark || {};
  const MIN_ARTICLE_CHARS = 400;
  const MAX_CONTENT_CHARS = 60000;

  function createPageIntake({ resolveTab, readArticle, readTranscript }) {
    if (typeof resolveTab !== 'function') throw new Error('Page Intake requires a tab adapter');
    if (typeof readArticle !== 'function') throw new Error('Page Intake requires an article adapter');
    if (typeof readTranscript !== 'function') throw new Error('Page Intake requires a transcript adapter');

    async function capture(intent, context = {}) {
      if (!intent || typeof intent !== 'object') {
        throw intakeError('INTAKE_SOURCE_INVALID', 'Page Intake requires a source intent.');
      }
      if (!['page', 'selection', 'link', 'prepared'].includes(intent.kind)) {
        throw intakeError('INTAKE_SOURCE_INVALID', `Unsupported Page Intake kind: ${intent.kind}`);
      }

      if (intent.kind === 'prepared') {
        const body = String(intent.body || '').trim();
        if (!body) throw intakeError('INTAKE_EMPTY', 'Prepared Content is empty.');
        return {
          kind: 'prepared',
          body,
          contentLabel: String(intent.contentLabel || 'Content'),
          displayLabel: String(intent.displayLabel || 'content'),
          meta: Array.isArray(intent.meta) ? intent.meta : [],
          diagnostics: {},
          source: null,
        };
      }

      const tab = await resolveTab(intent, context);
      if (!tab || tab.id == null || !tab.url) {
        throw intakeError('INTAKE_NO_ACTIVE_TAB', 'No active page is available.');
      }
      const source = tabSource(tab);

      if (intent.kind === 'selection') {
        const body = String(intent.text || '').trim();
        if (!body) throw intakeError('INTAKE_EMPTY', 'The selected text is empty.');
        return {
          kind: 'selection',
          body,
          contentLabel: 'Selection',
          displayLabel: 'selection',
          meta: [['Page Title', source.title], ['URL', source.url]],
          diagnostics: {},
          source,
        };
      }

      if (intent.kind === 'link') {
        const body = String(intent.url || '').trim();
        if (!body) throw intakeError('INTAKE_EMPTY', 'The link is empty.');
        return {
          kind: 'link',
          body,
          contentLabel: 'Link',
          displayLabel: 'link',
          meta: [['Page Title', source.title], ['URL', source.url]],
          diagnostics: {},
          source,
        };
      }

      if (isYouTubeUrl(tab.url)) {
        const transcript = await readTranscript(tab);
        if (!transcript || !transcript.body) {
          throw intakeError('INTAKE_TRANSCRIPT_UNAVAILABLE', 'The YouTube transcript is unavailable.');
        }
        return transcriptIntake(transcript, source);
      }

      let article = null;
      try {
        article = await readArticle(tab);
      } catch {
        // Restricted pages and transient injection failures use the explicit URL fallback.
      }
      if (!article || !article.text || Number(article.chars || article.text.length) <= MIN_ARTICLE_CHARS) {
        return {
          kind: 'url',
          body: tab.url,
          contentLabel: 'URL',
          displayLabel: 'URL',
          meta: [['Page Title', tab.title || '']],
          diagnostics: { fallbackUsed: true, reason: 'article-too-short' },
          source,
        };
      }

      const originalChars = Number(article.chars || article.text.length);
      const truncated = originalChars > MAX_CONTENT_CHARS;
      return {
        kind: 'article',
        body: truncated ? article.text.slice(0, MAX_CONTENT_CHARS) + '\n\n[truncated]' : article.text,
        contentLabel: 'Page Content',
        displayLabel: 'page text',
        meta: [['Page Title', tab.title || ''], ['URL', tab.url]],
        diagnostics: truncated ? { truncated: true, originalChars } : {},
        source,
      };
    }

    return Object.freeze({ capture });
  }

  function transcriptIntake(transcript, source) {
    return {
      kind: 'transcript',
      body: transcript.body,
      contentLabel: 'Transcript',
      displayLabel: 'transcript',
      meta: [['Video Title', transcript.title || source.title], ['Video URL', source.url]],
      diagnostics: {},
      source,
    };
  }

  function tabSource(tab) {
    return {
      tabId: tab.id,
      windowId: tab.windowId,
      url: tab.url,
      title: tab.title || '',
    };
  }

  function isYouTubeUrl(raw) {
    try {
      const host = new URL(raw).hostname.toLowerCase();
      return host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtu.be';
    } catch {
      return false;
    }
  }

  function intakeError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }

  Lark.createPageIntake = createPageIntake;
})(globalThis);
