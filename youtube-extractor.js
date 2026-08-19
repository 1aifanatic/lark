// YouTube Transcript Extractor Content Script
// Extracts transcripts using YouTube's engagement panel API

const sendRunClient = Lark.createSendRunClient(chrome.runtime);

// Listen for messages from the side panel
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'extractTranscript') {
    extractTranscript()
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
});

// Initialize the embedded button on YouTube
initYouTubeButton();

// Watch for navigation changes (YouTube is a SPA)
let lastUrl = location.href;
new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    setTimeout(initYouTubeButton, 1500);
  }
}).observe(document, { subtree: true, childList: true });

function initYouTubeButton() {
  // Only add button on video pages
  if (!location.pathname.includes('/watch')) return;
  
  // Remove existing button if any
  const existing = document.getElementById('lark-btn');
  if (existing) existing.remove();
  
  // Wait for the video controls to load
  setTimeout(() => {
    addEmbeddedButton();
  }, 2000);
}

function addEmbeddedButton() {
  // Find the best place to add the button
  const targetSelectors = [
    '#above-the-fold #actions',
    '#top-level-buttons-computed',
    '#menu-container',
    '#actions-inner',
    'ytd-menu-renderer#menu'
  ];
  
  let targetContainer = null;
  for (const selector of targetSelectors) {
    targetContainer = document.querySelector(selector);
    if (targetContainer) break;
  }
  
  if (!targetContainer) {
    console.log('LARK: Could not find target container for button');
    return;
  }
  
  // Theme-aware clay button — matches the extension's design language (no gradient).
  const ytDark = document.documentElement.hasAttribute('dark');
  const fill = ytDark ? '#E08A6A' : '#B85C38';
  const ink = ytDark ? '#1F1E1B' : '#FFFFFF';
  const hover = ytDark ? '#E9A088' : '#954625';

  // Create the button
  const button = document.createElement('button');
  button.id = 'lark-btn';
  button.innerHTML = `
    <svg width="18" height="18" viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path fill="currentColor" d="M 8 32 L 48 58 C 50 47 56 38 64 38 C 72 38 78 47 80 58 L 120 32 C 116 55 104 74 80 83 L 64 99 L 48 83 C 24 74 12 55 8 32 Z"/>
    </svg>
    <span>Send with LARK</span>
  `;
  
  // Style the button
  button.style.cssText = `
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 16px;
    margin-left: 8px;
    background: ${fill};
    border: none;
    border-radius: 18px;
    color: ${ink};
    font-family: 'YouTube Sans', 'Roboto', sans-serif;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s ease, box-shadow 0.15s ease;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
    vertical-align: middle;
  `;
  
  // Hover effect — colour change only, no lift or scale.
  button.addEventListener('mouseenter', () => {
    button.style.background = hover;
    button.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.3)';
  });
  
  button.addEventListener('mouseleave', () => {
    button.style.background = fill;
    button.style.boxShadow = '0 1px 4px rgba(0, 0, 0, 0.25)';
  });
  
  // Click handler - extract and send to LLM
  button.addEventListener('click', handleQuickExtract);
  
  // Add tooltip
  button.title = 'Extract transcript and send to your preferred AI';
  
  // Insert the button
  if (targetContainer.firstChild) {
    targetContainer.insertBefore(button, targetContainer.firstChild);
  } else {
    targetContainer.appendChild(button);
  }
  
  console.log('LARK: Button added to YouTube');
}

async function handleQuickExtract() {
  const button = document.getElementById('lark-btn');
  const originalContent = button.innerHTML;
  const originalBackground = button.style.background;

  // Show loading state. The spinner is skipped for users who prefer reduced motion.
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const spinStyle = reduceMotion ? '' : ' style="animation: spin 1s linear infinite;"';
  button.innerHTML = `
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none"${spinStyle}>
      <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" stroke-dasharray="30 70"/>
    </svg>
    <span>Extracting...</span>
  `;
  button.disabled = true;
  
  // Add spin animation
  if (!reduceMotion) {
    const style = document.createElement('style');
    style.textContent = '@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }';
    document.head.appendChild(style);
  }
  
  try {
    // Page Intake, Preferences, composition, and delivery live behind the
    // background-owned Send Run seam. sender.tab identifies this exact video.
    const receipt = await sendRunClient.start({ kind: 'page' });
    
    // Show success briefly
    const platformNames = receipt.deliveries
      .filter(delivery => delivery.status === 'opened')
      .map(delivery => delivery.platformId)
      .join(', ');
    button.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
        <path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <span>Opening ${platformNames}...</span>
    `;
    
    // Reset button after delay
    setTimeout(() => {
      button.innerHTML = originalContent;
      button.disabled = false;
    }, 2000);
    
  } catch (error) {
    console.error('LARK error:', error);
    
    // Show error state — theme-aware error tone, content restored after a pause.
    const ytDark = document.documentElement.hasAttribute('dark');
    button.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
        <line x1="15" y1="9" x2="9" y2="15" stroke="currentColor" stroke-width="2"/>
        <line x1="9" y1="9" x2="15" y2="15" stroke="currentColor" stroke-width="2"/>
      </svg>
      <span>Could not extract</span>
    `;
    button.style.background = ytDark ? '#F2938C' : '#A32B22';
    
    // Reset after delay
    setTimeout(() => {
      button.innerHTML = originalContent;
      button.style.background = originalBackground;
      button.disabled = false;
    }, 3000);
  }
}

// Method order reflects what actually works as of 2026-08, verified against live
// YouTube in a content-script isolated world:
//
//   panel scrape  - works. YouTube runs two panel implementations; the modern one
//                   (PAmodern_transcript_view / transcript-segment-view-model) loads via
//                   get_panel and populates. The legacy one is backed by the retired
//                   get_transcript and opens empty. Which one a video gets is out of our
//                   hands, so we read whichever renders.
//   timedtext     - dead. Signed baseUrls return HTTP 200 with zero bytes (proof-of-origin
//                   gating). Kept as a cheap attempt in case that changes.
//   get_transcript- retired, returns 400. Kept last and only because it has not been
//                   tested against a logged-in session, where it may still answer.
async function extractTranscript() {
  const videoId = getVideoId();
  if (!videoId) {
    throw new Error('Could not find YouTube video ID');
  }

  const videoTitle = getVideoTitle();
  const failures = [];

  const methods = [
    ['transcript panel', scrapeTranscriptPanel],
    ['timedtext captions', () => fetchFromTimedText(videoId)],
    ['get_transcript API', () => fetchTranscriptAPI(videoId)],
  ];

  for (const [label, fn] of methods) {
    try {
      const transcript = await fn();
      if (transcript && transcript.trim()) {
        console.log(`LARK: transcript via ${label} (${transcript.length} chars)`);
        return { success: true, transcript, videoTitle, videoId, method: label };
      }
      failures.push(`${label}: returned nothing`);
    } catch (e) {
      failures.push(`${label}: ${e.message}`);
      console.log(`LARK: ${label} failed —`, e.message);
    }
  }

  // Be specific about why. A generic "no transcript" sends people looking in the wrong
  // place when the real cause is that this video got the dead legacy panel.
  const hasCaptions = pageAdvertisesCaptions();
  const hint = hasCaptions
    ? 'This video does have captions, but YouTube served the older transcript panel, which no longer loads. Try reloading the page, or open the transcript manually first.'
    : 'This video appears to have no captions available.';

  throw new Error(`Could not extract transcript. ${hint}\n\nTried — ${failures.join(' | ')}`);
}

// Does the page claim captions exist? Distinguishes "no transcript" from "transcript
// exists but we could not reach it", which are very different problems for the user.
function pageAdvertisesCaptions() {
  try {
    return /"captionTracks"\s*:\s*\[/.test(document.documentElement.innerHTML);
  } catch {
    return false;
  }
}

function getVideoId() {
  const url = new URL(window.location.href);
  if (url.searchParams.has('v')) return url.searchParams.get('v');
  const pathMatch = url.pathname.match(/^\/(?:embed\/|v\/|shorts\/)?([a-zA-Z0-9_-]{11})/);
  return pathMatch ? pathMatch[1] : null;
}

function getVideoTitle() {
  const selectors = [
    'h1.ytd-video-primary-info-renderer yt-formatted-string',
    '#title h1 yt-formatted-string',
    'h1.ytd-watch-metadata yt-formatted-string',
    '#above-the-fold #title yt-formatted-string',
  ];
  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el?.textContent) return el.textContent.trim();
  }
  return document.title.replace(' - YouTube', '').trim();
}

// Method 1: Use YouTube's internal get_transcript API
async function fetchTranscriptAPI(videoId) {
  // Get required tokens from the page
  const html = document.documentElement.innerHTML;
  
  const apiKeyMatch = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/);
  if (!apiKeyMatch) throw new Error('Could not find API key');
  const apiKey = apiKeyMatch[1];

  const clientVersionMatch = html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/);
  const clientVersion = clientVersionMatch ? clientVersionMatch[1] : '2.20240101.00.00';

  // Find the transcript params from ytInitialData
  const params = await getTranscriptParams(videoId);
  
  if (!params) {
    throw new Error('Transcript params not found');
  }

  // Call the get_transcript API
  const response = await fetch(`https://www.youtube.com/youtubei/v1/get_transcript?key=${apiKey}&prettyPrint=false`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      context: {
        client: {
          hl: 'en',
          gl: 'US',
          clientName: 'WEB',
          clientVersion: clientVersion,
        }
      },
      params: params
    })
  });

  if (!response.ok) {
    throw new Error(`API returned ${response.status}`);
  }

  const data = await response.json();
  return parseTranscriptData(data);
}

// Get transcript params from page data
async function getTranscriptParams(videoId) {
  // Try to get from ytInitialData first
  let ytInitialData = window.ytInitialData;
  
  if (!ytInitialData) {
    // Parse from page
    const html = document.documentElement.innerHTML;
    const match = html.match(/var ytInitialData\s*=\s*(\{.+?\});/s);
    if (match) {
      try {
        ytInitialData = JSON.parse(match[1]);
      } catch (e) {}
    }
  }

  if (ytInitialData) {
    // Search for transcript params in engagement panels
    const params = findTranscriptParamsInData(ytInitialData);
    if (params) return params;
  }

  // If not found, construct params manually
  // This is the protobuf-encoded format YouTube expects
  return constructTranscriptParams(videoId);
}

// Recursively search for transcript params
function findTranscriptParamsInData(obj, depth = 0) {
  if (depth > 15 || !obj || typeof obj !== 'object') return null;

  // Direct match
  if (obj.params && obj.getTranscriptEndpoint) {
    return obj.params;
  }
  if (obj.serializedShareEntity && obj.params) {
    return obj.params;
  }

  // Check for getTranscriptEndpoint
  if (obj.getTranscriptEndpoint?.params) {
    return obj.getTranscriptEndpoint.params;
  }

  // Recurse through arrays and objects
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const result = findTranscriptParamsInData(item, depth + 1);
      if (result) return result;
    }
  } else {
    for (const key of Object.keys(obj)) {
      const result = findTranscriptParamsInData(obj[key], depth + 1);
      if (result) return result;
    }
  }

  return null;
}

// Construct transcript params manually using the video ID
function constructTranscriptParams(videoId) {
  // YouTube uses a specific protobuf encoding for transcript params
  // Format: base64(protobuf({1: base64(protobuf({1: videoId, 2: "asr", 3: "", 4: "en"}))}))
  
  // Simplified encoding that works for most videos
  const innerProto = encodeProto([
    { field: 1, value: videoId, type: 'string' },
  ]);
  
  const outerProto = encodeProto([
    { field: 1, value: innerProto, type: 'bytes' },
  ]);
  
  return base64UrlEncode(outerProto);
}

// Simple protobuf encoder
function encodeProto(fields) {
  const parts = [];
  
  for (const { field, value, type } of fields) {
    if (type === 'string') {
      // Wire type 2 (length-delimited)
      parts.push((field << 3) | 2);
      const bytes = new TextEncoder().encode(value);
      parts.push(bytes.length);
      parts.push(...bytes);
    } else if (type === 'bytes') {
      // Wire type 2 (length-delimited)
      parts.push((field << 3) | 2);
      parts.push(value.length);
      parts.push(...value);
    }
  }
  
  return new Uint8Array(parts);
}

function base64UrlEncode(bytes) {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// Parse transcript response from get_transcript API
function parseTranscriptData(data) {
  const lines = [];

  // Navigate through the response structure
  const actions = data?.actions || [];
  
  for (const action of actions) {
    const panel = action?.updateEngagementPanelAction?.content?.transcriptRenderer;
    if (panel) {
      const content = panel?.content?.transcriptSearchPanelRenderer;
      if (content) {
        // Get initial segments
        const segments = content?.body?.transcriptSegmentListRenderer?.initialSegments || [];
        for (const seg of segments) {
          const text = extractTextFromSegment(seg);
          if (text) lines.push(text);
        }
      }
      
      // Alternative structure
      const body = panel?.body?.transcriptBodyRenderer;
      if (body?.cueGroups) {
        for (const group of body.cueGroups) {
          const cues = group?.transcriptCueGroupRenderer?.cues || [];
          for (const cue of cues) {
            const text = extractTextFromCue(cue);
            if (text) lines.push(text);
          }
        }
      }
    }
  }

  // Try alternative response structure
  if (lines.length === 0) {
    const renderer = data?.actions?.[0]?.updateEngagementPanelAction?.content?.transcriptRenderer;
    const segments = renderer?.content?.transcriptSearchPanelRenderer?.body?.transcriptSegmentListRenderer?.initialSegments;
    if (segments) {
      for (const seg of segments) {
        const text = extractTextFromSegment(seg);
        if (text) lines.push(text);
      }
    }
  }

  if (lines.length === 0) {
    throw new Error('No transcript content found in response');
  }

  return formatLines(lines);
}

function extractTextFromSegment(segment) {
  const renderer = segment?.transcriptSegmentRenderer;
  if (!renderer) return null;
  
  const snippet = renderer.snippet;
  if (snippet?.runs) {
    return snippet.runs.map(r => r.text || '').join('').trim();
  }
  if (snippet?.simpleText) {
    return snippet.simpleText.trim();
  }
  return null;
}

function extractTextFromCue(cue) {
  const renderer = cue?.transcriptCueRenderer;
  if (!renderer) return null;
  
  const cueData = renderer.cue;
  if (cueData?.runs) {
    return cueData.runs.map(r => r.text || '').join('').trim();
  }
  if (cueData?.simpleText) {
    return cueData.simpleText.trim();
  }
  return null;
}

// Method 2: Fetch from timedtext/captions API
async function fetchFromTimedText(videoId) {
  // Get player response
  const html = document.documentElement.innerHTML;
  const playerMatch = html.match(/var ytInitialPlayerResponse\s*=\s*(\{.+?\});/s) ||
                      html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\});/s);
  
  if (!playerMatch) throw new Error('No player response found');
  
  let playerResponse;
  try {
    playerResponse = JSON.parse(playerMatch[1]);
  } catch (e) {
    throw new Error('Failed to parse player response');
  }

  const captionTracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!captionTracks || captionTracks.length === 0) {
    throw new Error('No caption tracks found');
  }

  // Prefer English tracks
  let track = captionTracks.find(t => t.languageCode === 'en' && t.kind !== 'asr') ||
              captionTracks.find(t => t.languageCode?.startsWith('en')) ||
              captionTracks.find(t => t.kind === 'asr') ||
              captionTracks[0];

  if (!track?.baseUrl) throw new Error('No caption URL found');

  // Fetch captions XML
  const response = await fetch(track.baseUrl);
  if (!response.ok) throw new Error('Failed to fetch captions');
  
  const xml = await response.text();
  return parseTimedTextXML(xml);
}

function parseTimedTextXML(xml) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'text/xml');
  const texts = doc.querySelectorAll('text');
  
  if (texts.length === 0) throw new Error('No text in captions');

  const lines = [];
  for (const t of texts) {
    let text = t.textContent || '';
    // Decode HTML entities
    const el = document.createElement('textarea');
    el.innerHTML = text;
    text = el.value.replace(/\s+/g, ' ').trim();
    if (text) lines.push(text);
  }

  return formatLines(lines);
}

// YouTube renamed the transcript renderer. Both families are queried because which
// one a video gets is an A/B rollout we do not control.
const SEGMENT_SELECTOR = 'transcript-segment-view-model, ytd-transcript-segment-renderer';

function countSegments() {
  return document.querySelectorAll(SEGMENT_SELECTOR).length;
}

// Open the transcript panel, wait for it to populate, then read every segment.
async function scrapeTranscriptPanel() {
  if (countSegments() === 0) {
    await openTranscriptPanel();
  }

  // Poll rather than sleep a fixed amount — the panel fetches its content, and how
  // long that takes varies with video length and connection.
  for (let i = 0; i < 12 && countSegments() === 0; i++) {
    await sleep(1000);
  }

  if (countSegments() === 0) {
    throw new Error('panel opened but never populated (YouTube likely served the retired legacy panel)');
  }

  await loadAllSegments();

  const lines = [];
  for (const seg of document.querySelectorAll(SEGMENT_SELECTOR)) {
    const text = cleanSegmentText(seg);
    if (text) lines.push(text);
  }

  if (lines.length === 0) {
    throw new Error('segments rendered but no text could be read from them');
  }

  return formatLines(lines);
}

async function openTranscriptPanel() {
  // On longer videos the transcript control lives inside the collapsed description.
  const expander = document.querySelector('#expand, #description-inline-expander #expand');
  if (expander) {
    expander.click();
    await sleep(1200);
  }

  const button = document.querySelector('button[aria-label="Show transcript"]') ||
                 document.querySelector('button[aria-label="Transcript"]') ||
                 findClickableByText('transcript');

  if (!button) throw new Error('no transcript control on this page');

  button.click();
  await sleep(1200);
}

// The panel virtualises on long videos: only the segments near the viewport exist in
// the DOM. Scroll its container until the count stops growing, otherwise we would
// silently return a partial transcript — the worst possible failure mode here.
async function loadAllSegments() {
  const seg = document.querySelector(SEGMENT_SELECTOR);
  if (!seg) return;

  let scroller = seg.parentElement;
  while (scroller && scroller.scrollHeight <= scroller.clientHeight + 20) {
    scroller = scroller.parentElement;
  }
  if (!scroller) return; // everything already fits; nothing to load

  let previous = -1;
  let stable = 0;
  for (let i = 0; i < 60; i++) {
    const current = countSegments();
    if (current === previous) {
      if (++stable >= 2) break; // two quiet rounds means we reached the end
    } else {
      stable = 0;
    }
    previous = current;
    scroller.scrollTop = scroller.scrollHeight;
    await sleep(400);
  }
}

// A segment's textContent concatenates its timestamp, an accessibility duration label,
// and the caption itself — e.g. "0:011 second[♪♪♪]". Strip the first two.
function cleanSegmentText(seg) {
  const textEl = seg.querySelector('.segment-text, yt-formatted-string.segment-text');
  if (textEl?.textContent) return textEl.textContent.trim();

  let text = (seg.textContent || '').trim();
  text = text.replace(/^\d{1,2}:\d{2}(?::\d{2})?/, '');
  text = text.replace(/^\s*(?:\d+\s*(?:hours?|minutes?|seconds?)(?:,\s*)?)+/i, '');
  return text.trim();
}

// Find a clickable element whose visible text contains needle (case-insensitive).
// Replaces the :contains() pseudo-class, which is not valid CSS — querySelector
// throws SyntaxError on it rather than returning null, which silently killed this
// fallback whenever the aria-label lookup above missed.
function findClickableByText(needle) {
  const candidates = document.querySelectorAll('button, ytd-button-renderer, tp-yt-paper-button');
  for (const el of candidates) {
    if (el.textContent?.toLowerCase().includes(needle)) return el;
  }
  return null;
}

// Format lines into readable paragraphs
function formatLines(lines) {
  const fullText = lines.join(' ').replace(/\s+/g, ' ');
  
  // Split on sentence endings
  const sentences = fullText.split(/(?<=[.!?])\s+/);
  
  // Group into paragraphs
  const paragraphs = [];
  let current = [];
  
  for (const sentence of sentences) {
    current.push(sentence);
    if (current.length >= 4) {
      paragraphs.push(current.join(' '));
      current = [];
    }
  }
  
  if (current.length > 0) {
    paragraphs.push(current.join(' '));
  }

  return paragraphs.join('\n\n');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
