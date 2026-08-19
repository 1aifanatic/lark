// page-text.js — DOM text extraction shared by the side panel, the background service
// worker (context menu + keyboard command) and anything else that needs to read a
// page. Loaded as a plain script and via importScripts.
//
// These functions must stay self-contained: chrome.scripting.executeScript
// serialises the function source, so they cannot close over anything from the
// caller's context.

// Pull readable article text out of a page. Scores plausible containers by how
// much paragraph text they hold — crude compared with Readability, but dependency-
// free and good enough for ordinary articles.
function readableTextFromPage() {
  const JUNK = 'script,style,noscript,nav,header,footer,aside,form,iframe,svg,button,figure figcaption';

  const clone = document.body.cloneNode(true);
  clone.querySelectorAll(JUNK).forEach(el => el.remove());

  const containers = [
    ...clone.querySelectorAll('article, main, [role="main"], #content, .content, .post, .article-body'),
    clone,
  ];

  let best = null;
  let bestScore = 0;
  for (const el of containers) {
    const paras = [...el.querySelectorAll('p, li, h1, h2, h3, blockquote, pre')];
    const score = paras.reduce((n, p) => n + (p.textContent || '').trim().length, 0);
    if (score > bestScore) { bestScore = score; best = el; }
  }
  if (!best) return { text: '', chars: 0 };

  const blocks = [...best.querySelectorAll('p, li, h1, h2, h3, blockquote, pre')]
    .map(el => {
      const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!t) return '';
      const tag = el.tagName.toLowerCase();
      if (tag === 'h1' || tag === 'h2' || tag === 'h3') return '\n## ' + t;
      if (tag === 'li') return '- ' + t;
      return t;
    })
    .filter(t => t.length > 1);

  // Drop near-duplicate lines — nav remnants and cookie notices repeat a lot.
  const seen = new Set();
  const deduped = blocks.filter(b => {
    const k = b.slice(0, 80);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const text = deduped.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
  return { text, chars: text.length };
}

// Selected text, if any. Used by the "Send selection to LLM" context menu item.
function getSelectionText() {
  const sel = window.getSelection();
  return (sel && sel.toString()) ? sel.toString().trim() : '';
}
