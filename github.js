// GitHub repo comparison: gather facts from the API, hand them to the model.
//
// The model cannot verify anything itself from a pasted prompt — it only judges the
// payload we assemble. So the value of this feature lives here, not in the wording of
// the prompt.
//
// Every fact in the payload comes from the API. The page is read only to find out *which*
// repos you are looking at (githubReposOnPage below) — never for figures. That line
// matters: a scraper feeding the payload is what killed transcript extraction, so a
// GitHub redesign here can cost you a convenience list and nothing else.
//
// api.github.com sends Access-Control-Allow-Origin: *, so no proxy and no token is
// needed. Unauthenticated that is 60 requests/hour per IP; at ~4 calls per repo this
// affords roughly 6-7 comparisons an hour. On exhaustion we fail loudly.

const GITHUB_API = 'https://api.github.com';
const MAX_REPOS = 3;
const README_CHARS = 4000;

// Accepts "owner/name", a github.com URL, or a git@ remote.
function parseRepoInput(raw) {
  const s = (raw || '').trim();
  if (!s) return null;

  const url = s.match(/github\.com[/:]([^/\s]+)\/([^/\s#?]+)/i);
  if (url) return { owner: url[1], name: url[2].replace(/\.git$/, '') };

  const short = s.match(/^([\w.-]+)\/([\w.-]+)$/);
  if (short) return { owner: short[1], name: short[2].replace(/\.git$/, '') };

  return null;
}

// ---- Comparison basket -------------------------------------------------------
//
// Repos are picked off the GitHub page you are on, never typed. The basket persists in
// storage so you can queue repo A, browse to repo B, queue that too, and only then
// compare — which is the whole point of living in a side panel instead of a popup.

const BASKET_KEY = 'compareBasket';

const repoKey = (owner, name) => `${owner}/${name}`.toLowerCase();

async function loadBasket() {
  const stored = (await chrome.storage.local.get(BASKET_KEY))[BASKET_KEY];
  return Array.isArray(stored)
    ? stored.filter(r => r && r.owner && r.name).slice(0, MAX_REPOS)
    : [];
}

async function saveBasket(list) {
  const capped = list.slice(0, MAX_REPOS);
  await chrome.storage.local.set({ [BASKET_KEY]: capped });
  return capped;
}

// Returns { basket, added, reason } — 'already' and 'full' are normal outcomes the
// caller reports to the user, not errors.
async function addToBasket(owner, name) {
  const basket = await loadBasket();
  const key = repoKey(owner, name);

  if (basket.some(r => repoKey(r.owner, r.name) === key)) {
    return { basket, added: false, reason: 'already' };
  }
  if (basket.length >= MAX_REPOS) {
    return { basket, added: false, reason: 'full' };
  }

  return { basket: await saveBasket([...basket, { owner, name }]), added: true };
}

async function removeFromBasket(owner, name) {
  const basket = await loadBasket();
  const key = repoKey(owner, name);
  return saveBasket(basket.filter(r => repoKey(r.owner, r.name) !== key));
}

async function clearBasket() {
  return saveBasket([]);
}

function basketToInputs(basket) {
  return basket.map(r => `${r.owner}/${r.name}`);
}

// ---- Reading repos off the page ----------------------------------------------

// GitHub's own routes, which parseRepoInput would otherwise happily read as owner/name
// (github.com/topics/javascript is not a repo). githubReposOnPage() below carries its
// own copy of this list because it is serialised into the page and cannot see this
// scope — keep the two in sync.
const RESERVED_REPO_OWNERS = new Set([
  'about', 'account', 'apps', 'blog', 'business', 'codespaces', 'collections',
  'contact', 'customer-stories', 'dashboard', 'enterprise', 'events', 'explore',
  'features', 'gist', 'git', 'github', 'issues', 'join', 'login', 'logout',
  'marketplace', 'new', 'notifications', 'nonprofit', 'orgs', 'organizations',
  'pricing', 'pulls', 'readme', 'search', 'security', 'sessions', 'settings',
  'signup', 'site', 'sponsors', 'stars', 'topics', 'trending', 'users', 'watching',
  'wiki', 'discussions', 'copilot', 'premium-support', 'assets-cdn',
]);

function isLikelyRepo(owner, name) {
  return Boolean(owner) && Boolean(name) && !RESERVED_REPO_OWNERS.has(owner.toLowerCase());
}

/**
 * Injected into a GitHub tab with chrome.scripting.executeScript({func}), exactly like
 * readableTextFromPage in page-text.js — so it must be entirely self-contained, with no
 * reference to anything in this file's scope.
 *
 * Returns [{ owner, name, stars }] in DOM order, the current page's own repo first.
 * `stars` is scraped from the page purely as a picking hint and may be null; the
 * comparison itself always reads the GitHub API, never this.
 *
 * This is a convenience list. When GitHub redesigns and the selectors stop matching it
 * degrades to an empty list — right-click → add, and the current repo, keep working.
 */
function githubReposOnPage() {
  // First path segment values that are GitHub's own routes, not user accounts.
  const RESERVED_OWNERS = new Set([
    'about', 'account', 'apps', 'blog', 'business', 'codespaces', 'collections',
    'contact', 'customer-stories', 'dashboard', 'enterprise', 'events', 'explore',
    'features', 'gist', 'git', 'github', 'issues', 'join', 'login', 'logout',
    'marketplace', 'new', 'notifications', 'nonprofit', 'orgs', 'organizations',
    'pricing', 'pulls', 'readme', 'search', 'security', 'sessions', 'settings',
    'signup', 'site', 'sponsors', 'stars', 'topics', 'trending', 'users', 'watching',
    'wiki', 'discussions', 'copilot', 'premium-support', 'assets-cdn',
    // Marketing nav, which is what a logged-out GitHub page is mostly made of.
    'solutions', 'resources', 'newsroom', 'legal', 'privacy', 'terms', 'sitemap',
    'education', 'developer', 'partners', 'shop', 'social-impact', 'open-source',
    'why-github', 'mobile', 'downloads', 'industries', 'case-studies',
  ]);

  // Second segment values that are account sub-pages rather than repositories.
  const RESERVED_NAMES = new Set([
    'followers', 'following', 'repositories', 'stars', 'projects', 'packages',
    'sponsors', 'discussions', 'achievements', 'orgs', 'settings', 'people',
  ]);

  const out = [];
  const seen = new Set();

  const add = (owner, name, stars) => {
    if (!owner || !name) return;
    if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(name)) return;
    if (RESERVED_OWNERS.has(owner.toLowerCase())) return;
    if (RESERVED_NAMES.has(name.toLowerCase())) return;
    const key = `${owner}/${name}`.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ owner, name, stars: stars || null });
  };

  // Harvest star counts once from stargazer links, so listing rows can show a number
  // without spending any of the 60/hour API budget.
  const starsByRepo = new Map();
  for (const a of document.querySelectorAll('a[href*="/stargazers"]')) {
    const m = (a.getAttribute('href') || '').match(/^\/([\w.-]+)\/([\w.-]+)\/stargazers/);
    const text = (a.textContent || '').trim();
    if (m && text) starsByRepo.set(`${m[1]}/${m[2]}`.toLowerCase(), text);
  }

  // The repo you are actually looking at goes first.
  const here = location.pathname.match(/^\/([\w.-]+)\/([\w.-]+)(?:\/|$)/);
  if (here) {
    const counter = document.querySelector('#repo-stars-counter-star');
    add(here[1], here[2],
      (counter && counter.textContent.trim()) || starsByRepo.get(`${here[1]}/${here[2]}`.toLowerCase()));
  }

  for (const a of document.querySelectorAll('a[href]')) {
    if (out.length >= 40) break;
    const href = a.getAttribute('href') || '';
    const m = href.match(/^\/([\w.-]+)\/([\w.-]+)\/?$/)
      || href.match(/^https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/?$/i);
    if (!m) continue;
    add(m[1], m[2], starsByRepo.get(`${m[1]}/${m[2]}`.toLowerCase()));
  }

  return out;
}

async function ghFetch(path, accept = 'application/vnd.github+json') {
  const res = await fetch(GITHUB_API + path, { headers: { Accept: accept } });

  if (res.status === 403 || res.status === 429) {
    const remaining = res.headers.get('x-ratelimit-remaining');
    if (remaining === '0') {
      const reset = Number(res.headers.get('x-ratelimit-reset') || 0) * 1000;
      const when = reset ? new Date(reset).toLocaleTimeString() : 'shortly';
      throw new Error(`GitHub rate limit reached (60/hour unauthenticated). Resets at ${when}.`);
    }
    throw new Error(`GitHub refused the request (${res.status}).`);
  }
  if (res.status === 404) throw new Error('Repository not found (or private).');
  if (!res.ok) throw new Error(`GitHub returned ${res.status}.`);

  return accept.includes('raw') ? res.text() : res.json();
}

// Four calls per repo. Contributors/releases/readme are best-effort — a repo with none
// of them is a finding in itself, not an error.
async function fetchRepoFacts(owner, name) {
  const repo = await ghFetch(`/repos/${owner}/${name}`);

  const [contributors, releases, readme] = await Promise.all([
    ghFetch(`/repos/${owner}/${name}/contributors?per_page=10`).catch(() => []),
    ghFetch(`/repos/${owner}/${name}/releases?per_page=5`).catch(() => []),
    ghFetch(`/repos/${owner}/${name}/readme`, 'application/vnd.github.raw').catch(() => ''),
  ]);

  const commits = Array.isArray(contributors)
    ? contributors.reduce((n, c) => n + (c.contributions || 0), 0)
    : 0;
  const topShare = Array.isArray(contributors) && contributors.length && commits
    ? Math.round((contributors[0].contributions / commits) * 100)
    : null;

  return {
    fullName: repo.full_name,
    url: repo.html_url,
    description: repo.description,
    stars: repo.stargazers_count,
    forks: repo.forks_count,
    watchers: repo.subscribers_count,
    openIssues: repo.open_issues_count,
    language: repo.language,
    topics: repo.topics || [],
    license: repo.license?.spdx_id || repo.license?.name || 'none',
    createdAt: repo.created_at,
    pushedAt: repo.pushed_at,
    archived: repo.archived,
    disabled: repo.disabled,
    isFork: repo.fork,
    homepage: repo.homepage,
    contributorsSampled: Array.isArray(contributors) ? contributors.length : 0,
    topContributorShare: topShare,
    releaseCount: Array.isArray(releases) ? releases.length : 0,
    latestRelease: Array.isArray(releases) && releases[0]
      ? { tag: releases[0].tag_name, at: releases[0].published_at }
      : null,
    readme: (readme || '').slice(0, README_CHARS),
    readmeChars: (readme || '').length,
  };
}

function daysSince(iso) {
  if (!iso) return null;
  return Math.round((Date.now() - new Date(iso).getTime()) / 86400000);
}

function renderRepoFacts(f) {
  const lines = [
    `### ${f.fullName}`,
    `- URL: ${f.url}`,
    `- Description: ${f.description || '(none)'}`,
    `- Stars: ${f.stars} | Forks: ${f.forks} | Watchers: ${f.watchers}`,
    `- Open issues/PRs: ${f.openIssues}`,
    `- Primary language: ${f.language || 'unknown'}`,
    `- Topics: ${f.topics.length ? f.topics.join(', ') : '(none)'}`,
    `- License: ${f.license}`,
    `- Created: ${f.createdAt?.slice(0, 10)} | Last push: ${f.pushedAt?.slice(0, 10)} (${daysSince(f.pushedAt)} days ago)`,
    `- Archived: ${f.archived ? 'YES — repository is archived' : 'no'}${f.disabled ? ' | DISABLED' : ''}${f.isFork ? ' | is a fork' : ''}`,
    `- Releases (last 5 sampled): ${f.releaseCount}` +
      (f.latestRelease ? ` | latest ${f.latestRelease.tag} on ${f.latestRelease.at?.slice(0, 10)}` : ' | no published releases'),
    `- Contributor concentration: top contributor accounts for ` +
      (f.topContributorShare === null ? 'unknown' : `${f.topContributorShare}% of commits among the top ${f.contributorsSampled} contributors`),
    `- README length: ${f.readmeChars} characters`,
  ];

  if (f.readme) {
    lines.push('', `README (first ${README_CHARS} chars):`, '```markdown', f.readme, '```');
  } else {
    lines.push('', 'README: none retrievable.');
  }

  return lines.join('\n');
}

const RUBRIC = `Judge them on these axes:

1. **Maintenance health** — recency of the last push, release cadence, open issue load relative to project size.
2. **Adoption** — stars, forks, watchers, and what the topics/description imply about real use.
3. **Bus factor** — contributor concentration. A project where one person wrote almost everything is a different risk from one with a spread.
4. **Documentation** — does the README actually explain installation, usage, and scope, or is it a marketing page?
5. **License fit** — permissive vs copyleft vs none, and what that implies for the stated purpose.
6. **Lifecycle risk** — archived/disabled flags, fork status, or a README that names a successor project.`;

const INSTRUCTIONS = `Rules for your answer:

- State clearly **which axis decided it**. Do not average everything into a vague verdict.
- If the two are genuinely close, say **"too close to call"** and explain what would break the tie. Do not manufacture a winner.
- Call out where the data below is insufficient to judge an axis, rather than guessing.
- Note that star counts measure attention, not quality — weight them accordingly.`;

/**
 * Build the comparison payload. This is the `content` handed to composeMessage().
 */
function buildComparisonContent(factsList, purpose) {
  const parts = [];

  parts.push(
    `Compare the following ${factsList.length} GitHub repositories and tell me which is the better choice.`
  );

  if (purpose && purpose.trim()) {
    parts.push(`**What I need it for:** ${purpose.trim()}\n\nWeight the axes below according to that purpose — it should change the answer.`);
  } else {
    parts.push(`No specific use case was given, so judge for general-purpose adoption and flag where the right answer would change with the use case.`);
  }

  parts.push(RUBRIC);
  parts.push(INSTRUCTIONS);
  parts.push(`---\n\nAll figures below were read from the GitHub API on ${new Date().toISOString().slice(0, 10)}.`);
  parts.push(factsList.map(renderRepoFacts).join('\n\n'));

  return parts.join('\n\n');
}

/**
 * Full flow: parse inputs, fetch facts for each, build the payload.
 * Throws with a user-presentable message on bad input or rate limiting.
 */
async function compareRepos(inputs, purpose) {
  const parsed = inputs
    .map(s => ({ raw: s, repo: parseRepoInput(s) }))
    .filter(x => x.raw && x.raw.trim());

  const bad = parsed.find(x => !x.repo);
  if (bad) throw new Error(`Could not read "${bad.raw}" as a repo.`);
  if (parsed.length < 2) throw new Error('Add at least two repositories to compare.');
  if (parsed.length > MAX_REPOS) throw new Error(`Compare at most ${MAX_REPOS} repositories at once.`);

  const facts = [];
  for (const { repo } of parsed) {
    facts.push(await fetchRepoFacts(repo.owner, repo.name));
  }

  return {
    content: buildComparisonContent(facts, purpose),
    names: facts.map(f => f.fullName),
  };
}
