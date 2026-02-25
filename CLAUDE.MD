# Project Context for AI Assistants

## Project Overview
LLM Content Extractor is a Chrome extension that extracts webpage URLs or YouTube video transcripts and sends them directly to various LLM platforms (ChatGPT, Google Gemini, Grok, Claude, Kimi, DeepSeek, Qwen) with customizable prompts.

## Project Type
Chrome Browser Extension (Manifest V3)

## Tech Stack
- Vanilla JavaScript (no frameworks)
- Chrome Extension APIs (Manifest V3)
- Content Scripts for YouTube and LLM platforms
- Service Worker (background.js)
- HTML/CSS for UI

## Key Files & Architecture

### Core Extension Files
- `manifest.json` - Extension configuration, permissions, and content script declarations
- `background.js` - Service worker for extension lifecycle management
- `popup.html/css/js` - Extension popup interface (main user interaction point)
- `options.html/css/js` - Settings page for customization

### Content Scripts
- `youtube-extractor.js` - Injected into YouTube pages to extract video transcripts
  - Extracts transcripts using YouTube's engagement panel API
  - Adds an embedded button on YouTube video pages
  - Handles YouTube SPA navigation with MutationObserver
- `llm-injector.js` - Injected into LLM platforms to paste extracted content
  - Handles content injection into various LLM chat interfaces

### Utility Files
- `generate-icons.html` - Tool for generating extension icons
- `create-icons.js` - Icon generation logic
- `icons/` - Extension icon assets (16, 32, 48, 128 sizes)

## Core Functionality

### Content Extraction
1. **Regular Webpages**: Extracts page URL and title
2. **YouTube Videos**:
   - Extracts full video transcripts from YouTube's caption data
   - Supports manual and auto-generated captions
   - Prefers English transcripts with fallback options
   - Removes timestamps for clean text output

### LLM Integration
Supports sending content to:
- ChatGPT (chat.openai.com, chatgpt.com)
- Google Gemini (gemini.google.com)
- Grok (x.com/i/grok, grok.com)
- Claude (claude.ai)
- Kimi (kimi.com, www.kimi.com)
- DeepSeek (chat.deepseek.com)
- Qwen (chat.qwen.ai)

### User Features
- Customizable system prompts
- Pre-built prompt templates (Summarize, Key Points, Translate, Explain, Action Items, Critique)
- Settings export/import functionality
- One-click extraction and sending
- Dark theme UI
- **NEW:** Quick copy URL to clipboard button
- **NEW:** Copy content to clipboard without sending to LLM
- **NEW:** Live LLM selection counter
- **NEW:** Keyboard shortcuts (⌘/Ctrl+Enter, ⌘/Ctrl+Shift+C, ⌘/Ctrl+Shift+U)
- **NEW:** Collapsible keyboard shortcuts help section
- **NEW:** Toast notifications for user feedback
- **NEW:** Enhanced button hover effects and animations

## Project Structure
```
glasp-yt-clone/
├── manifest.json          # Extension config
├── popup.html/css/js      # Main popup UI
├── options.html/css/js    # Settings page
├── background.js          # Service worker
├── youtube-extractor.js   # YouTube transcript extraction
├── llm-injector.js        # LLM content injection
├── generate-icons.html    # Icon generator
├── create-icons.js        # Icon generation logic
├── icons/                 # Extension icons
│   ├── icon16.png
│   ├── icon32.png
│   ├── icon48.png
│   └── icon128.png
└── README.md              # User documentation
```

## Permissions Required
- `activeTab` - Access current tab's URL
- `storage` - Save user settings locally
- `scripting` - Inject content scripts
- `tabs` - Query and update tabs
- Host permissions for YouTube and all supported LLM platforms

## Development Notes

### YouTube Transcript Extraction
- Uses YouTube's internal engagement panel API
- Watches for SPA navigation changes with MutationObserver
- Adds an embedded button directly on YouTube video pages
- Handles various caption formats and language preferences

### Content Script Injection
- Content scripts are declaratively registered in manifest.json
- YouTube extractor runs at document_end on YouTube URLs
- LLM injector runs at document_end on all LLM platform URLs
- Communication between popup and content scripts via chrome.runtime messaging

### Storage
- Uses chrome.storage.sync for user settings
- Stores: selected LLM, system prompt, and other preferences
- Settings can be exported/imported as JSON

## Common Tasks

### Adding a New LLM Platform
1. Add host permission to manifest.json
2. Add URL pattern to llm-injector.js content script matches
3. Update llm-injector.js to handle the new platform's DOM structure
4. Add platform option to popup UI dropdown

### Modifying Transcript Extraction
- Edit youtube-extractor.js
- Main function: `extractTranscript()`
- Consider YouTube's SPA navigation and DOM changes

### Updating UI/Styles
- popup.html/css - Main extension popup
- options.html/css - Settings page
- Both use a dark theme design system

### Testing
1. Load unpacked extension from chrome://extensions/
2. Test on YouTube videos with captions
3. Test content injection on each LLM platform
4. Verify settings persistence

## Known Considerations

### YouTube Specifics
- YouTube is a Single Page Application (SPA)
- Need to watch for URL changes with MutationObserver
- Caption availability varies by video
- Auto-generated captions may not always be available

### LLM Platform Variations
- Each LLM platform has different DOM structures
- Content injection methods may need platform-specific handling
- Login states can affect content injection success

### Browser Extension Limitations
- Manifest V3 requires service workers (not background pages)
- Content scripts run in isolated contexts
- Need explicit host permissions for each domain

## Future Enhancement Ideas
- Support for more LLM platforms
- Batch processing of multiple videos
- Transcript timestamp preservation option
- Custom extraction rules per website
- Integration with local LLM APIs

## Style Guidelines
- Modern dark theme UI
- Clean, minimal interface design
- Consistent button and form styling
- Responsive layout for various popup sizes

## Code Patterns Used
- Message passing between popup and content scripts
- Promise-based async operations
- MutationObserver for DOM watching
- Chrome storage API for persistence
- Template-based prompt system

## Recent Improvements (2026-01)
1. **Copy to Clipboard Features**
   - Added copy URL button next to page URL display
   - Added copy content button (copies transcript/URL with system prompt)
   - Both use modern clipboard API with toast notifications

2. **Enhanced UX**
   - Live counter showing number of selected LLMs
   - Counter highlights when LLMs are selected
   - Toast notifications for user feedback (auto-dismiss after 3s)

3. **Keyboard Shortcuts**
   - ⌘/Ctrl + Enter: Extract and send to LLMs
   - ⌘/Ctrl + Shift + C: Copy content to clipboard
   - ⌘/Ctrl + Shift + U: Copy URL to clipboard
   - Collapsible help section showing all shortcuts

4. **Visual Improvements**
   - Keyboard hint badge on main action button
   - Improved button layouts and spacing
   - Better hover states and animations
   - Copy button next to URL for quick access

## When Working on This Project
1. Test changes by reloading the extension at chrome://extensions/
2. Check browser console for content script errors
3. Verify permissions are granted in manifest.json
4. Test on actual YouTube videos and LLM platforms
5. Ensure backwards compatibility with saved settings
6. Maintain the existing dark theme styling
7. Follow the vanilla JS pattern (no build tools/frameworks)
8. Test keyboard shortcuts on both Mac and Windows
9. Verify clipboard operations work correctly
