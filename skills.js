// Skills: named, composable prompt modifiers that stack on top of extracted content.
// Replaces the old one-at-a-time template system — a template overwrote the system
// prompt, a skill layers on top of it, so several can apply at once.
//
// Loaded as a plain script before sidepanel.js / options.js. No modules, no build step.

const MAX_ACTIVE_SKILLS = 3;

const DEFAULT_SYSTEM_PROMPT = `Please analyze the following content and provide:

1. A concise summary (2-3 paragraphs)
2. Key takeaways and main points
3. Any actionable insights or recommendations

Be thorough but focused. Highlight the most important information.`;

// Seeded on first run. Editable like any other skill; "Reset" restores these bodies.
const DEFAULT_SKILLS = [
  {
    id: 'summary',
    name: 'Summary',
    body: `Summarize the content: main topic and purpose, the key arguments made, the important facts and figures, and the conclusion. Keep it concise but complete.`,
  },
  {
    id: 'keypoints',
    name: 'Key Points',
    body: `Extract the key points as a bulleted list, each as "Point: explanation". Focus on the most important and actionable information.`,
  },
  {
    id: 'translate',
    name: 'Translate',
    body: `Translate the content into clear, fluent English. If it is already English, improve its clarity instead. Then give a brief summary and list any key terms used.`,
  },
  {
    id: 'explain',
    name: 'Explain Simply',
    body: `Explain this in simple terms: what it is about, why it matters, how it works, and what I should remember. Use analogies and examples. Assume I am new to the topic.`,
  },
  {
    id: 'actionable',
    name: 'Action Items',
    body: `Extract actionable items, grouped as "Immediate Actions", "Long-term Recommendations", and "Key Decisions to Make". Prioritise by importance and feasibility.`,
  },
  {
    id: 'critique',
    name: 'Critique',
    body: `Give a critical analysis: strengths, weaknesses, missing elements, credibility of the information, plausible counter-arguments, and an overall balanced assessment.`,
  },
  {
    id: 'blunt',
    name: 'Be Blunt',
    body: `Be direct and concise. Skip preamble, caveats, and hedging. Lead with the conclusion. If something is bad, say so plainly and say why.`,
  },
  {
    id: 'xpost',
    name: 'X Post',
    body: `Rewrite the content as a single X post under 280 characters, and give the exact character count on the line after it.

Lead with the sharpest concrete claim in the material — a number, a result, a reversal — not a throat-clearing preamble like "Here's a thread about" or "Let's dive in". No question hooks, no engagement bait. At most one hashtag, and only if it is genuinely a term people follow. Write in plain text. Do not use markdown (no **, no #, no backticks) — these fields render none of it. Do not fake styling with Unicode look-alike letters (𝗕𝗼𝗹𝗱, ⒶⓁⓉ, ｆｕｌｌ): screen readers announce them as gibberish, and they break search, copy-paste and translation. Ordinary Unicode punctuation and symbols are welcome where they earn their place (→ • — “ ” …), and emoji sparingly if the material suits it.`,
  },
  {
    id: 'xthread',
    name: 'X Thread',
    body: `Rewrite the content as an X thread of 5 to 9 posts. Number every post as "1/", "2/" and so on, keep each under 280 characters, and put its character count in brackets at the end of the post.

Post 1 must stand alone as the strongest specific claim in the material, so it is worth reading even if nobody expands the thread. Give each following post exactly one idea, in the order the material supports. Use the real facts, names and figures from the content rather than generic advice. Close with the takeaway, not a follow-for-more plea. Write in plain text. Do not use markdown (no **, no #, no backticks) — these fields render none of it. Do not fake styling with Unicode look-alike letters (𝗕𝗼𝗹𝗱, ⒶⓁⓉ, ｆｕｌｌ): screen readers announce them as gibberish, and they break search, copy-paste and translation. Ordinary Unicode punctuation and symbols are welcome where they earn their place (→ • — “ ” …), and emoji sparingly if the material suits it.`,
  },
  {
    id: 'linkedin',
    name: 'LinkedIn Post',
    body: `Rewrite the content as a LinkedIn post of roughly 120 to 200 words.

Open with one concrete line that works as the preview before the "see more" fold. Then short paragraphs of one or two sentences separated by blank lines, because dense blocks go unread there. Where you list things, start the line with "- " or "• ". Ground it in the specifics from the content — what happened, the numbers, what changed — and end with a genuine question or a clear takeaway rather than a motivational sign-off. No hustle-culture voice, no "Agree?", and no more than three hashtags, on the final line. Write in plain text. Do not use markdown (no **, no #, no backticks) — these fields render none of it. Do not fake styling with Unicode look-alike letters (𝗕𝗼𝗹𝗱, ⒶⓁⓉ, ｆｕｌｌ): screen readers announce them as gibberish, and they break search, copy-paste and translation. Ordinary Unicode punctuation and symbols are welcome where they earn their place (→ • — “ ” …), and emoji sparingly if the material suits it.`,
  },
  {
    id: 'table',
    name: 'As a Table',
    body: `Present the core of your answer as a markdown table wherever the material is comparable. Keep prose outside the table to a minimum.`,
  },
];

// Content longer than this gets the instruction restated after the payload — long-context
// models weight the end of a prompt more heavily, and a transcript can be tens of
// thousands of characters of filler before the model reaches the question.
const LONG_CONTENT_CHARS = 6000;

function makeSkillId(name) {
  const base = (name || 'skill').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  return (base || 'skill') + '-' + Math.random().toString(36).slice(2, 7);
}

/**
 * Build the final message.
 *
 * Layout: system prompt -> numbered skill bodies -> metadata -> content, with the
 * instructions restated after long payloads.
 *
 * @param {object} o
 * @param {string} o.systemPrompt
 * @param {Array<{name:string, body:string}>} o.skills  applied in selection order
 * @param {string} o.content        the payload (transcript, article text, repo report)
 * @param {Array<[string,string]>} [o.meta]  label/value pairs shown above the content
 * @param {string} [o.contentLabel] heading for the payload block
 */
function composeMessage({ systemPrompt, skills = [], content, meta = [], contentLabel = 'Content' }) {
  const parts = [];

  parts.push(systemPrompt || DEFAULT_SYSTEM_PROMPT);

  if (skills.length) {
    const lines = skills.map((s, i) => `${i + 1}. ${s.body}`);
    parts.push(`Additional instructions:\n${lines.join('\n')}`);
  }

  const header = meta.filter(([, v]) => v).map(([k, v]) => `**${k}:** ${v}`).join('\n');
  const body = `${header ? header + '\n\n' : ''}**${contentLabel}:**\n${content}`;
  parts.push('---\n\n' + body);

  // Restate for long payloads so the ask is not buried thousands of tokens up.
  if ((content || '').length > LONG_CONTENT_CHARS) {
    const restated = skills.length
      ? `Reminder — apply these to the ${contentLabel.toLowerCase()} above: ${skills.map(s => s.name).join('; ')}.`
      : `Reminder — respond to the ${contentLabel.toLowerCase()} above per the instructions at the top.`;
    parts.push('---\n\n' + restated);
  }

  return parts.join('\n\n');
}
