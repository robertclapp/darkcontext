/**
 * Read-only Web UI shell for DarkContext.
 *
 * One self-contained HTML + CSS + vanilla-JS file. No build step, no
 * external requests. The UI prompts for the bearer token at first load
 * and stores it in `sessionStorage` so refreshes don't re-prompt.
 *
 * Why a single inlined string instead of a static file copied to dist:
 *   - npm publishes `dist/` only; copying assets into the right place
 *     adds two more files and a build hook.
 *   - The UI is intentionally tiny — embedding it keeps the deploy
 *     surface a single .js file the operator already runs.
 *
 * Security posture: the HTML itself is unauthenticated (no sensitive
 * data ships with it), but every `/ui/api/*` call requires the same
 * bearer the MCP transport uses. The data the UI surfaces is
 * scope-filtered through the same `ScopeFilter` the MCP tools route
 * through, so the UI cannot show a tool more than the tool can already
 * see via MCP.
 */
export const INDEX_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>DarkContext</title>
  <style>
    :root {
      --bg: #0e1116;
      --bg-2: #161b22;
      --fg: #e6edf3;
      --fg-dim: #8b949e;
      --accent: #58a6ff;
      --warn: #f0883e;
      --ok: #56d364;
      --border: #30363d;
      --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; background: var(--bg); color: var(--fg); font: 14px/1.5 system-ui, -apple-system, sans-serif; }
    a { color: var(--accent); text-decoration: none; }
    header {
      display: flex; align-items: center; gap: 16px;
      padding: 10px 16px;
      background: var(--bg-2);
      border-bottom: 1px solid var(--border);
      position: sticky; top: 0; z-index: 5;
    }
    header h1 { margin: 0; font-size: 16px; font-weight: 600; }
    header .meta { color: var(--fg-dim); font-size: 12px; font-family: var(--mono); }
    header .spacer { flex: 1; }
    header button {
      background: transparent; color: var(--fg-dim);
      border: 1px solid var(--border); border-radius: 4px;
      padding: 4px 10px; cursor: pointer; font-size: 12px;
    }
    header button:hover { color: var(--fg); border-color: var(--fg-dim); }
    nav {
      display: flex; gap: 0;
      background: var(--bg-2);
      border-bottom: 1px solid var(--border);
    }
    nav button {
      background: transparent; color: var(--fg-dim);
      border: none; border-bottom: 2px solid transparent;
      padding: 10px 16px; cursor: pointer; font-size: 13px;
    }
    nav button.active { color: var(--fg); border-bottom-color: var(--accent); }
    nav button:hover { color: var(--fg); }
    main { padding: 16px; max-width: 1100px; margin: 0 auto; }
    .toolbar { display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
    .toolbar input, .toolbar select {
      background: var(--bg-2); color: var(--fg);
      border: 1px solid var(--border); border-radius: 4px;
      padding: 6px 10px; font: inherit;
    }
    .toolbar input[type=search] { flex: 1; min-width: 180px; }
    .toolbar button {
      background: var(--accent); color: #0d1117;
      border: none; border-radius: 4px; padding: 6px 14px; cursor: pointer;
      font-weight: 500;
    }
    .row {
      display: grid; grid-template-columns: 60px 100px 1fr 120px;
      gap: 12px; padding: 8px 12px;
      border-bottom: 1px solid var(--border);
      align-items: start;
    }
    .row.header { color: var(--fg-dim); font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 2px solid var(--border); }
    .badge {
      display: inline-block; padding: 1px 6px;
      background: var(--bg-2); border: 1px solid var(--border);
      border-radius: 3px; font-family: var(--mono); font-size: 11px;
    }
    .badge.scope { color: var(--accent); border-color: rgba(88,166,255,.4); }
    .badge.kind { color: var(--fg-dim); }
    .badge.match { color: var(--warn); }
    .empty { color: var(--fg-dim); padding: 24px; text-align: center; }
    .err { color: var(--warn); padding: 12px; font-family: var(--mono); }
    .id { color: var(--fg-dim); font-family: var(--mono); }
    .content { white-space: pre-wrap; word-break: break-word; }
    .scope-grid { display: grid; grid-template-columns: 1fr 80px 80px 100px; gap: 8px; }
    .scope-grid .header { color: var(--fg-dim); font-size: 11px; text-transform: uppercase; }
    .pill { display: inline-block; padding: 1px 6px; border-radius: 10px; font-size: 11px; }
    .pill.yes { background: rgba(86,211,100,.15); color: var(--ok); }
    .pill.no { background: rgba(139,148,158,.15); color: var(--fg-dim); }
    code { font-family: var(--mono); background: var(--bg-2); padding: 1px 4px; border-radius: 3px; }
  </style>
</head>
<body>
  <header>
    <h1>DarkContext</h1>
    <span class="meta" id="identity">…</span>
    <span class="spacer"></span>
    <button id="logout" title="Forget the bearer token in this session">Forget token</button>
  </header>
  <nav id="nav"></nav>
  <main id="main"></main>

<script>
(() => {
  const TOKEN_KEY = 'darkcontext.token';
  const tabs = [
    { id: 'memories', label: 'Recall', render: renderRecall },
    { id: 'documents', label: 'Documents', render: renderDocuments },
    { id: 'history', label: 'History', render: renderHistory },
    { id: 'workspaces', label: 'Workspaces', render: renderWorkspaces },
    { id: 'identity', label: 'Identity', render: renderIdentity },
  ];
  let activeTab = 'memories';

  function getToken() {
    let t = sessionStorage.getItem(TOKEN_KEY);
    if (t) return t;
    t = (prompt('Paste your DarkContext bearer token (dcx_…):') || '').trim();
    if (t) sessionStorage.setItem(TOKEN_KEY, t);
    return t;
  }

  async function api(path, params) {
    const url = new URL(path, location.origin);
    if (params) for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== '' && v !== null) url.searchParams.set(k, String(v));
    }
    const token = getToken();
    if (!token) throw new Error('no token');
    const res = await fetch(url, { headers: { 'authorization': 'Bearer ' + token } });
    if (res.status === 401) {
      sessionStorage.removeItem(TOKEN_KEY);
      throw new Error('unauthorized — token cleared, refresh to re-enter');
    }
    if (!res.ok) throw new Error(\`HTTP \${res.status}: \${await res.text()}\`);
    return res.json();
  }

  function el(tag, attrs, children) {
    const e = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') e.className = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (v === true) e.setAttribute(k, '');
      else if (v !== undefined && v !== false && v !== null) e.setAttribute(k, String(v));
    }
    for (const c of [].concat(children || [])) {
      if (c == null) continue;
      e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return e;
  }

  function renderNav() {
    const nav = document.getElementById('nav');
    nav.innerHTML = '';
    for (const t of tabs) {
      const b = el('button', {
        class: t.id === activeTab ? 'active' : '',
        onclick: () => { activeTab = t.id; renderNav(); render(); },
      }, t.label);
      nav.appendChild(b);
    }
  }

  async function render() {
    const main = document.getElementById('main');
    main.innerHTML = '';
    const tab = tabs.find((t) => t.id === activeTab);
    try {
      await tab.render(main);
    } catch (err) {
      main.appendChild(el('div', { class: 'err' }, String(err && err.message || err)));
    }
  }

  function header(cells) {
    return el('div', { class: 'row header' }, cells.map((c) => el('div', null, c)));
  }

  function badge(cls, text) {
    return el('span', { class: 'badge ' + cls }, text);
  }

  function pill(yes) {
    return el('span', { class: 'pill ' + (yes ? 'yes' : 'no') }, yes ? 'yes' : 'no');
  }

  // ---------- tabs ----------

  async function renderRecall(main) {
    const state = { q: '', scope: '', limit: 25 };
    const out = el('div');
    const refresh = async () => {
      out.innerHTML = '';
      if (!state.q) { out.appendChild(el('div', { class: 'empty' }, 'Type a query and press Recall.')); return; }
      const data = await api('/ui/api/recall', state);
      if (!data.hits.length) { out.appendChild(el('div', { class: 'empty' }, 'no matches')); return; }
      out.appendChild(header(['#id', 'scope', 'content', 'match']));
      for (const h of data.hits) {
        out.appendChild(el('div', { class: 'row' }, [
          el('div', { class: 'id' }, '#' + h.id),
          badge('scope', h.scope || '-'),
          el('div', { class: 'content' }, h.content),
          el('div', null, [badge('match', h.match), ' ', el('span', { class: 'id' }, h.score.toFixed(2))]),
        ]));
      }
    };
    main.appendChild(el('div', { class: 'toolbar' }, [
      el('input', { type: 'search', placeholder: 'Recall query…', oninput: (e) => state.q = e.target.value }),
      el('input', { type: 'text', placeholder: 'scope (optional)', size: 12, oninput: (e) => state.scope = e.target.value }),
      el('input', { type: 'number', value: state.limit, min: 1, max: 50, size: 4, oninput: (e) => state.limit = Number(e.target.value) }),
      el('button', { onclick: refresh }, 'Recall'),
    ]));
    main.appendChild(out);
  }

  async function renderDocuments(main) {
    const state = { q: '', scope: '', limit: 25 };
    const out = el('div');
    const refresh = async () => {
      out.innerHTML = '';
      if (!state.q) { out.appendChild(el('div', { class: 'empty' }, 'Type a query and press Search.')); return; }
      const data = await api('/ui/api/documents/search', state);
      if (!data.hits.length) { out.appendChild(el('div', { class: 'empty' }, 'no matches')); return; }
      out.appendChild(header(['doc', 'scope', 'chunk', 'match']));
      for (const h of data.hits) {
        out.appendChild(el('div', { class: 'row' }, [
          el('div', { class: 'id' }, '#' + h.documentId + ' ' + (h.title || '')),
          badge('scope', h.scope || '-'),
          el('div', { class: 'content' }, '[chunk ' + h.chunkIdx + '] ' + h.content),
          el('div', null, [badge('match', h.match), ' ', el('span', { class: 'id' }, h.score.toFixed(2))]),
        ]));
      }
    };
    main.appendChild(el('div', { class: 'toolbar' }, [
      el('input', { type: 'search', placeholder: 'Document search query…', oninput: (e) => state.q = e.target.value }),
      el('input', { type: 'text', placeholder: 'scope (optional)', size: 12, oninput: (e) => state.scope = e.target.value }),
      el('input', { type: 'number', value: state.limit, min: 1, max: 25, size: 4, oninput: (e) => state.limit = Number(e.target.value) }),
      el('button', { onclick: refresh }, 'Search'),
    ]));
    main.appendChild(out);
  }

  async function renderHistory(main) {
    const state = { q: '', scope: '', source: '', limit: 25 };
    const out = el('div');
    const refresh = async () => {
      out.innerHTML = '';
      if (!state.q) { out.appendChild(el('div', { class: 'empty' }, 'Type a query and press Search.')); return; }
      const data = await api('/ui/api/history', state);
      if (!data.hits.length) { out.appendChild(el('div', { class: 'empty' }, 'no matches')); return; }
      out.appendChild(header(['conv', 'scope', 'message', 'match']));
      for (const h of data.hits) {
        out.appendChild(el('div', { class: 'row' }, [
          el('div', { class: 'id' }, '#' + h.conversationId + ' ' + h.source + ' / ' + (h.title || '')),
          badge('scope', h.scope || '-'),
          el('div', { class: 'content' }, h.role + ': ' + h.content),
          el('div', null, [badge('match', h.match), ' ', el('span', { class: 'id' }, h.score.toFixed(2))]),
        ]));
      }
    };
    main.appendChild(el('div', { class: 'toolbar' }, [
      el('input', { type: 'search', placeholder: 'History search query…', oninput: (e) => state.q = e.target.value }),
      el('input', { type: 'text', placeholder: 'scope', size: 10, oninput: (e) => state.scope = e.target.value }),
      el('select', { onchange: (e) => state.source = e.target.value }, [
        el('option', { value: '' }, 'any source'),
        el('option', { value: 'chatgpt' }, 'chatgpt'),
        el('option', { value: 'claude' }, 'claude'),
        el('option', { value: 'gemini' }, 'gemini'),
        el('option', { value: 'generic' }, 'generic'),
      ]),
      el('input', { type: 'number', value: state.limit, min: 1, max: 50, size: 4, oninput: (e) => state.limit = Number(e.target.value) }),
      el('button', { onclick: refresh }, 'Search'),
    ]));
    main.appendChild(out);
  }

  async function renderWorkspaces(main) {
    const data = await api('/ui/api/workspaces');
    if (!data.workspaces.length) { main.appendChild(el('div', { class: 'empty' }, 'no readable workspaces')); return; }
    main.appendChild(header(['#id', 'scope', 'name', 'active']));
    for (const w of data.workspaces) {
      main.appendChild(el('div', { class: 'row' }, [
        el('div', { class: 'id' }, '#' + w.id),
        badge('scope', w.scope || '-'),
        el('div', { class: 'content' }, w.name),
        el('div', null, w.isActive ? badge('match', 'active') : ''),
      ]));
    }
  }

  async function renderIdentity(main) {
    const data = await api('/ui/api/identity');
    main.appendChild(el('div', { class: 'toolbar' }, [
      el('div', null, ['Tool: ', el('code', null, data.tool)]),
    ]));
    const grid = el('div', { class: 'scope-grid' }, [
      el('div', { class: 'header' }, 'scope'),
      el('div', { class: 'header' }, 'read'),
      el('div', { class: 'header' }, 'write'),
      el('div', { class: 'header' }, ''),
    ]);
    for (const g of data.scopes) {
      grid.appendChild(el('div', null, g.scope));
      grid.appendChild(pill(g.canRead));
      grid.appendChild(pill(g.canWrite));
      grid.appendChild(el('div', null, ''));
    }
    main.appendChild(grid);
  }

  // ---------- bootstrap ----------

  document.getElementById('logout').addEventListener('click', () => {
    sessionStorage.removeItem(TOKEN_KEY);
    location.reload();
  });

  // Eagerly fetch identity so we can show "tool / scopes" in the header.
  api('/ui/api/identity').then((d) => {
    document.getElementById('identity').textContent =
      d.tool + ' (' + d.scopes.map((s) => s.scope + (s.canWrite ? ':rw' : ':ro')).join(', ') + ')';
  }).catch((err) => {
    document.getElementById('identity').textContent = 'unauthenticated';
  });

  renderNav();
  render();
})();
</script>
</body>
</html>
`;
