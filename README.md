# LLM Content Extractor

A powerful Chrome extension that extracts webpage URLs or YouTube video transcripts and sends them directly to your favorite LLM (ChatGPT, Google Gemini, Grok, or Claude) with customizable prompts.

![Extension Preview](icons/icon128.svg)

## ✨ Features

### Core Functionality
- **Smart Page Detection**: Automatically detects whether you're on a regular webpage or YouTube video
- **URL Extraction**: Capture any webpage URL with a single click
- **YouTube Transcript Extraction**: Extract complete video transcripts from YouTube videos
- **Multi-LLM Support**: Send content to ChatGPT, Google Gemini, Grok, or Claude
- **Custom System Prompts**: Define your own prompt templates for different use cases

### YouTube-Specific Features
- Automatic YouTube URL detection (youtube.com, youtu.be)
- Full transcript extraction from YouTube's caption data
- Support for both manual and auto-generated captions
- English transcript preference with fallback options
- Clean text output with timestamps removed

### User Interface
- Clean, modern dark theme interface
- One-click extraction and sending
- Settings page for customization
- Pre-built prompt templates for common use cases
- Export/Import settings functionality

## 🚀 Installation

### Step 1: Generate Icons
1. Open `generate-icons.html` in your browser
2. Click "Download All Icons"
3. Save the PNG files to the `icons/` folder

### Step 2: Load the Extension
1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode" (toggle in the top right)
3. Click "Load unpacked"
4. Select the extension folder (this folder containing `manifest.json`)
5. The extension icon should appear in your toolbar

### Step 3: Pin the Extension (Optional)
1. Click the puzzle piece icon in Chrome's toolbar
2. Find "LLM Content Extractor" and click the pin icon

## 📖 Usage

### Extracting Content

1. **Navigate** to any webpage or YouTube video
2. **Click** the extension icon in your toolbar
3. **Select** your preferred LLM from the dropdown
4. **Click** "Extract & Send"
5. The extension will open your selected LLM and paste the content

### For Webpages
- The page URL and title are captured
- Combined with your system prompt
- Sent to your selected LLM

### For YouTube Videos
- The full transcript is extracted
- Video title and URL are included
- Clean text without timestamps
- English captions preferred (falls back to available languages)

## ⚙️ Settings

Access settings by clicking the "Settings" button in the popup or right-clicking the extension icon.

### LLM Selection
Choose your default LLM platform:
- **ChatGPT** - OpenAI's GPT models
- **Google Gemini** - Google's AI assistant
- **Grok** - xAI's conversational AI
- **Claude** - Anthropic's AI assistant

### System Prompt
Customize the prompt that's prepended to extracted content. The prompt supports:
- Multi-line text
- Unlimited length
- Markdown formatting

### Prompt Templates
Quick-start templates for common use cases:
- 📝 **Summarize** - Get concise summaries
- 🎯 **Key Points** - Extract main points
- 🌐 **Translate** - Translate and improve text
- 💡 **Explain** - Simple explanations
- ✅ **Action Items** - Extract actionable tasks
- 🔍 **Critique** - Critical analysis

## 🔧 Troubleshooting

### Transcript Not Available
- Check if the video has captions enabled
- Try videos with manual captions first
- Auto-generated captions may not be available for all videos

### Content Not Pasting
- Make sure you're logged into the LLM platform
- Try refreshing the LLM page
- The extension may need a moment to inject content

### Extension Not Working
- Check that all permissions are granted
- Reload the extension from `chrome://extensions/`
- Check the browser console for errors

## 📁 File Structure

```
├── manifest.json          # Extension configuration
├── popup.html             # Extension popup UI
├── popup.css              # Popup styles
├── popup.js               # Popup logic
├── options.html           # Settings page
├── options.css            # Settings styles
├── options.js             # Settings logic
├── background.js          # Service worker
├── youtube-extractor.js   # YouTube transcript extraction
├── llm-injector.js        # LLM content injection
├── generate-icons.html    # Icon generator tool
├── icons/                 # Extension icons
│   ├── icon16.png
│   ├── icon32.png
│   ├── icon48.png
│   └── icon128.png
└── README.md              # This file
```

## 🔒 Permissions

The extension requires the following permissions:
- **activeTab**: Access the current tab's URL
- **storage**: Save your settings locally
- **scripting**: Inject content scripts
- **tabs**: Query and update tabs
- **Host permissions**: Access YouTube and LLM platforms

## 🤝 Contributing

Feel free to submit issues and enhancement requests!

## 📄 License

MIT License - feel free to use and modify as needed.

---

Made with ❤️ for the AI-powered productivity community

