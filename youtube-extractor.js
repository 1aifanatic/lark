// YouTube Transcript Extractor Content Script
// Extracts transcripts using YouTube's engagement panel API

// Listen for messages from popup
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
  const existing = document.getElementById('llm-extractor-btn');
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
    console.log('LLM Extractor: Could not find target container for button');
    return;
  }
  
  // Create the button
  const button = document.createElement('button');
  button.id = 'llm-extractor-btn';
  button.innerHTML = `
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M2 17L12 22L22 17" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M2 12L12 17L22 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    <span>AI Summary</span>
  `;
  
  // Style the button
  button.style.cssText = `
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 16px;
    margin-left: 8px;
    background: linear-gradient(135deg, #ff6b35 0%, #f7c94b 100%);
    border: none;
    border-radius: 18px;
    color: #0a0a0f;
    font-family: 'YouTube Sans', 'Roboto', sans-serif;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s ease;
    box-shadow: 0 2px 8px rgba(255, 107, 53, 0.3);
    vertical-align: middle;
  `;
  
  // Hover effect
  button.addEventListener('mouseenter', () => {
    button.style.transform = 'scale(1.05)';
    button.style.boxShadow = '0 4px 12px rgba(255, 107, 53, 0.4)';
  });
  
  button.addEventListener('mouseleave', () => {
    button.style.transform = 'scale(1)';
    button.style.boxShadow = '0 2px 8px rgba(255, 107, 53, 0.3)';
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
  
  console.log('LLM Extractor: Button added to YouTube');
}

async function handleQuickExtract() {
  const button = document.getElementById('llm-extractor-btn');
  const originalContent = button.innerHTML;
  
  // Show loading state
  button.innerHTML = `
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style="animation: spin 1s linear infinite;">
      <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" stroke-dasharray="30 70"/>
    </svg>
    <span>Extracting...</span>
  `;
  button.disabled = true;
  
  // Add spin animation
  const style = document.createElement('style');
  style.textContent = '@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }';
  document.head.appendChild(style);
  
  try {
    // Extract transcript
    const result = await extractTranscript();
    
    if (!result.success) {
      throw new Error(result.error || 'Failed to extract transcript');
    }
    
    // Get user preferences
    const { selectedLLM, systemPrompt } = await chrome.storage.local.get(['selectedLLM', 'systemPrompt']);
    const llm = selectedLLM || 'chatgpt';
    const prompt = systemPrompt || 'Please analyze the following content and provide:\n\n1. A concise summary (2-3 paragraphs)\n2. Key takeaways and main points\n3. Any actionable insights or recommendations\n\nBe thorough but focused. Highlight the most important information.';
    
    // Compose content
    const content = composeQuickContent(prompt, result.transcript, result.videoTitle);
    
    // Store for LLM injector
    await chrome.storage.local.set({ 
      pendingContent: content,
      targetLLM: llm
    });
    
    // Get LLM URLs
    const llmUrls = {
      chatgpt: 'https://chatgpt.com/?model=auto',
      gemini: 'https://gemini.google.com/app',
      grok: 'https://grok.com/',
      claude: 'https://claude.ai/new',
      deepseek: 'https://chat.deepseek.com/',
      kimi: 'https://www.kimi.com/',
      qwen: 'https://chat.qwen.ai/'
    };
    
    // Get all selected LLMs (for multi-select support)
    const { selectedLLMs } = await chrome.storage.local.get('selectedLLMs');
    const llmsToOpen = (selectedLLMs && selectedLLMs.length > 0) ? selectedLLMs : [llm];
    
    // Show success briefly
    const llmNames = llmsToOpen.map(l => getLLMName(l)).join(', ');
    button.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
        <path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <span>Opening ${llmNames}...</span>
    `;
    
    // Open all selected LLMs in new tabs
    for (let i = 0; i < llmsToOpen.length; i++) {
      const targetLlm = llmsToOpen[i];
      if (llmUrls[targetLlm]) {
        if (i > 0) await sleep(300); // Small delay between tabs
        window.open(llmUrls[targetLlm], '_blank');
      }
    }
    
    // Reset button after delay
    setTimeout(() => {
      button.innerHTML = originalContent;
      button.disabled = false;
    }, 2000);
    
  } catch (error) {
    console.error('LLM Extractor error:', error);
    
    // Show error state
    button.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
        <line x1="15" y1="9" x2="9" y2="15" stroke="currentColor" stroke-width="2"/>
        <line x1="9" y1="9" x2="15" y2="15" stroke="currentColor" stroke-width="2"/>
      </svg>
      <span>Error</span>
    `;
    button.style.background = '#f87171';
    
    // Reset after delay
    setTimeout(() => {
      button.innerHTML = originalContent;
      button.style.background = 'linear-gradient(135deg, #ff6b35 0%, #f7c94b 100%)';
      button.disabled = false;
    }, 3000);
  }
}

function composeQuickContent(systemPrompt, transcript, videoTitle) {
  const separator = '\n\n---\n\n';
  const url = window.location.href;
  
  return systemPrompt + separator +
    `**Video Title:** ${videoTitle || 'Unknown'}\n` +
    `**Video URL:** ${url}\n\n` +
    `**Transcript:**\n${transcript}`;
}

function getLLMName(value) {
  const names = {
    chatgpt: 'ChatGPT',
    gemini: 'Gemini',
    grok: 'Grok',
    claude: 'Claude',
    deepseek: 'DeepSeek',
    kimi: 'Kimi',
    qwen: 'Qwen'
  };
  return names[value] || value;
}

async function extractTranscript() {
  const videoId = getVideoId();
  if (!videoId) {
    throw new Error('Could not find YouTube video ID');
  }

  const videoTitle = getVideoTitle();
  let transcript = null;
  let lastError = null;

  // Method 1: Fetch transcript via YouTube's get_transcript API
  try {
    transcript = await fetchTranscriptAPI(videoId);
    if (transcript && transcript.trim()) {
      return { success: true, transcript, videoTitle, videoId };
    }
  } catch (e) {
    lastError = e;
    console.log('Method 1 (get_transcript API) failed:', e.message);
  }

  // Method 2: Try fetching from timedtext API (captions)
  try {
    transcript = await fetchFromTimedText(videoId);
    if (transcript && transcript.trim()) {
      return { success: true, transcript, videoTitle, videoId };
    }
  } catch (e) {
    lastError = e;
    console.log('Method 2 (timedtext API) failed:', e.message);
  }

  // Method 3: Scrape from transcript panel if it's open
  try {
    transcript = await scrapeTranscriptPanel();
    if (transcript && transcript.trim()) {
      return { success: true, transcript, videoTitle, videoId };
    }
  } catch (e) {
    lastError = e;
    console.log('Method 3 (panel scraping) failed:', e.message);
  }

  throw new Error(lastError?.message || 'Could not extract transcript. Please make sure the video has a transcript available.');
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

// Method 3: Scrape directly from the transcript panel if visible
async function scrapeTranscriptPanel() {
  // Try to find and click the transcript button if panel isn't open
  const transcriptButton = document.querySelector('button[aria-label="Show transcript"]') ||
                           document.querySelector('ytd-button-renderer:has(yt-formatted-string:contains("Transcript"))');
  
  if (transcriptButton) {
    transcriptButton.click();
    await sleep(1500);
  }

  // Now scrape the transcript segments
  const segmentSelectors = [
    'ytd-transcript-segment-renderer .segment-text',
    'ytd-transcript-segment-renderer yt-formatted-string.segment-text',
    '#segments-container ytd-transcript-segment-renderer',
    'yt-formatted-string.segment-text',
  ];

  let segments = [];
  for (const selector of segmentSelectors) {
    segments = document.querySelectorAll(selector);
    if (segments.length > 0) break;
  }

  if (segments.length === 0) {
    throw new Error('No transcript segments found in panel');
  }

  const lines = [];
  for (const seg of segments) {
    const textEl = seg.querySelector('.segment-text, yt-formatted-string') || seg;
    const text = textEl.textContent?.trim();
    if (text) lines.push(text);
  }

  if (lines.length === 0) {
    throw new Error('No text extracted from transcript panel');
  }

  return formatLines(lines);
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
