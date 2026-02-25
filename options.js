// Options page script for LLM Content Extractor

const DEFAULT_PROMPT = `Please analyze the following content and provide:

1. A concise summary (2-3 paragraphs)
2. Key takeaways and main points
3. Any actionable insights or recommendations

Be thorough but focused. Highlight the most important information.`;

const TEMPLATES = {
  summary: `Please provide a comprehensive summary of the following content. Include:
- Main topic and purpose
- Key arguments or points made
- Important facts and figures
- Conclusion or outcome

Keep the summary concise but complete.`,

  keypoints: `Extract and list the key points from the following content:

Format your response as:
• Main Point 1: [explanation]
• Main Point 2: [explanation]
• (continue for all key points)

Focus on the most important and actionable information.`,

  translate: `Please translate and summarize the following content into clear, fluent English. If the content is already in English, improve its clarity and readability.

After translation/improvement, provide:
1. The translated/improved text
2. A brief summary
3. Key vocabulary or terms used`,

  explain: `Please explain the following content in simple, easy-to-understand terms:

1. What is this about? (brief overview)
2. Why is it important?
3. How does it work or what are the key concepts?
4. What should I remember?

Use analogies and examples where helpful. Assume I'm learning about this topic for the first time.`,

  actionable: `From the following content, extract all actionable items and recommendations:

Format your response as:
## Immediate Actions
- [action 1]
- [action 2]

## Long-term Recommendations  
- [recommendation 1]
- [recommendation 2]

## Key Decisions to Make
- [decision 1]
- [decision 2]

Prioritize by importance and feasibility.`,

  critique: `Please provide a critical analysis of the following content:

1. **Strengths**: What does this content do well?
2. **Weaknesses**: What are the limitations or issues?
3. **Missing Elements**: What important aspects are not addressed?
4. **Credibility**: How reliable is this information?
5. **Counter-arguments**: What opposing viewpoints exist?
6. **Overall Assessment**: Your balanced evaluation

Be fair but thorough in your analysis.`
};

document.addEventListener('DOMContentLoaded', async () => {
  const llmOptions = document.querySelectorAll('input[name="defaultLLM"]');
  const systemPromptEl = document.getElementById('systemPrompt');
  const charCountEl = document.getElementById('charCount');
  const resetPromptBtn = document.getElementById('resetPrompt');
  const templateBtns = document.querySelectorAll('.template-btn');
  const saveStatusEl = document.getElementById('saveStatus');
  const exportBtn = document.getElementById('exportBtn');
  const importBtn = document.getElementById('importBtn');
  const importFileEl = document.getElementById('importFile');

  // Load saved settings
  await loadSettings();

  // LLM selection change
  llmOptions.forEach(option => {
    option.addEventListener('change', async (e) => {
      await chrome.storage.local.set({ selectedLLM: e.target.value });
      showSaveStatus();
    });
  });

  // System prompt change
  let saveTimeout;
  systemPromptEl.addEventListener('input', () => {
    updateCharCount();
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(async () => {
      await chrome.storage.local.set({ systemPrompt: systemPromptEl.value });
      showSaveStatus();
    }, 500);
  });

  // Reset prompt
  resetPromptBtn.addEventListener('click', async () => {
    systemPromptEl.value = DEFAULT_PROMPT;
    updateCharCount();
    await chrome.storage.local.set({ systemPrompt: DEFAULT_PROMPT });
    showSaveStatus();
  });

  // Template buttons
  templateBtns.forEach(btn => {
    btn.addEventListener('click', async () => {
      const template = btn.dataset.template;
      if (TEMPLATES[template]) {
        systemPromptEl.value = TEMPLATES[template];
        updateCharCount();
        await chrome.storage.local.set({ systemPrompt: TEMPLATES[template] });
        showSaveStatus();
        
        // Highlight animation
        btn.style.transform = 'scale(0.95)';
        setTimeout(() => {
          btn.style.transform = '';
        }, 150);
      }
    });
  });

  // Export settings
  exportBtn.addEventListener('click', async () => {
    const settings = await chrome.storage.local.get(['selectedLLM', 'systemPrompt']);
    const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'llm-extractor-settings.json';
    a.click();
    URL.revokeObjectURL(url);
  });

  // Import settings
  importBtn.addEventListener('click', () => {
    importFileEl.click();
  });

  importFileEl.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      const settings = JSON.parse(text);
      
      if (settings.selectedLLM) {
        await chrome.storage.local.set({ selectedLLM: settings.selectedLLM });
        const option = document.querySelector(`input[value="${settings.selectedLLM}"]`);
        if (option) option.checked = true;
      }
      
      if (settings.systemPrompt) {
        await chrome.storage.local.set({ systemPrompt: settings.systemPrompt });
        systemPromptEl.value = settings.systemPrompt;
        updateCharCount();
      }
      
      showSaveStatus();
    } catch (error) {
      console.error('Import error:', error);
      alert('Failed to import settings. Please check the file format.');
    }
    
    // Reset file input
    importFileEl.value = '';
  });

  // Helper functions
  async function loadSettings() {
    const { selectedLLM, systemPrompt } = await chrome.storage.local.get(['selectedLLM', 'systemPrompt']);
    
    // Set LLM selection
    const llmValue = selectedLLM || 'chatgpt';
    const option = document.querySelector(`input[value="${llmValue}"]`);
    if (option) option.checked = true;
    
    // Set system prompt
    systemPromptEl.value = systemPrompt || DEFAULT_PROMPT;
    updateCharCount();
  }

  function updateCharCount() {
    const count = systemPromptEl.value.length;
    charCountEl.textContent = `${count.toLocaleString()} characters`;
  }

  function showSaveStatus() {
    saveStatusEl.classList.add('visible');
    setTimeout(() => {
      saveStatusEl.classList.remove('visible');
    }, 2000);
  }
});

