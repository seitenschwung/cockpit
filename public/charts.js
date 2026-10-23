'use strict';
// Charts, filters and table view. Everything is drawn from status.json fields that exist (schema 1);
// days without use are absent in claude.days[] and count as 0. No inline styles (CSP): SVG attributes and classes only.

const METRICS = {
  out: { label: 'Output-Tokens', get: (d) => d.out || 0 },
  cache: { label: 'Cache-Tokens', get: (d) => (d.cache_read || 0) + (d.cache_write || 0) },
  turns: { label: 'Turns', get: (d) => d.turns || 0 },
};
const FILTERS = {
  all: { label: 'Alle', test: () => true },
  problems: { label: 'Probleme', test: (p) => p.level !== 'ok' },
  working: { label: 'Claude arbeitet', test: (p) => !!(p.box && p.box.claude && p.box.claude.state === 'working') },
  prs: { label: 'Offene PRs', test: (p) => !!(p.repo && p.repo.prs.length) },
  stopped: { label: 'Gestoppt', test: (p) => !!(p.box && p.box.running === false) },
};
const dayFmt = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: 'numeric', month: 'numeric', timeZone: 'UTC' });
const fmtInt = new Intl.NumberFormat('de-DE');
const cmp = (a, b) => b - a;
const labelOf = (p) => p.name;

function matches(p) {
  if (!FILTERS[ui.f].test(p)) return false;
  const q = ui.q.trim().toLowerCase();
  if (!q) return true;
  const hay = [p.name, p.repo && p.repo.repo, p.box && p.box.branch,
    ...((p.repo && p.repo.prs) || []).map((x) => x.title)].filter(Boolean).join(' ').toLowerCase();
  return hay.includes(q);
}

// Scroll to a project's card and open it. Filters that hide it are reset first.
function reveal(name) {
  ui.v = 'cards';
  ui.pg = 'projects';
  const hidden = !merge(data).find((p) => p.name === name && matches(p));
  if (hidden) { ui.f = 'all'; ui.q = ''; }
  openState.set(name, true);
  syncUrl();
  render();
  const card = [...document.querySelectorAll('#cards .card')].find((c) => c.dataset.name === name);
  if (!card) return;
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  card.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'center' });
  card.classList.add('flash');
  setTimeout(() => card.classList.remove('flash'), 1800);
  card.querySelector('summary').focus({ preventScroll: true });
}

function press(group, attr, value) {
  for (const b of group.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset[attr] === String(value)));
}

// ---- filters, count, empty state ----
function renderControls(all, shown) {
  const chips = $('chips');
  chips.replaceChildren(...Object.entries(FILTERS).map(([k, f]) => {
    const n = all.filter(f.test).length;
    const b = el('button', 'chip' + (k !== 'all' && n && k === 'problems' ? ' warn' : ''));
    b.type = 'button';
    b.dataset.f = k;
    b.setAttribute('aria-pressed', String(ui.f === k));
    b.disabled = k !== 'all' && n === 0 && ui.f !== k;
    b.append(f.label, el('span', 'n', String(n)));
    return b;
  }));
  $('count').textContent = shown.length === all.length ? all.length + ' Projekte'
    : shown.length + ' von ' + all.length + ' Projekten';
  if ($('q').value !== ui.q) $('q').value = ui.q;
  press($('view'), 'view', ui.v);
  $('sort').value = SORTS[sortKey] ? sortKey : 'status';
  if (!shown.length) {
    const e = el('p', 'empty', 'Keine Projekte für diesen Filter.');
    const reset = el('button', null, 'Filter zurücksetzen');
    reset.type = 'button';
    reset.dataset.reset = '1';
    e.append(' ', reset);
    $('count').append(' ');
    (ui.v === 'cards' ? $('cards') : $('table')).replaceChildren(e);
  }
}

// ---- "Was muss ich tun?" (only from fields that exist) ----
const TODO_SEV = { bad: 0, warn: 1, info: 2 };
function todoItems(all, stale) {
  const items = [];
  const add = (sev, project, text, href) => items.push({ sev, project, text, href });
  if (stale) add('bad', null, 'Sammler hängt, die Daten sind veraltet.');
  for (const h of data.host) if (h.level !== 'ok') add(h.level, null, 'Host ' + h.name + ': ' + h.text);
  for (const p of all) {
    const b = p.box, r = p.repo, n = p.name;
    if (b) {
      if (b.running === false) add('bad', n, 'Box ist gestoppt.');
      if (b.oom_killed) add('bad', n, 'Box wurde wegen Speichermangel beendet (OOM).');
      if (b.running !== false) {
        if (b.logged_in === false) add('bad', n, 'Claude ist nicht angemeldet.');
        if (b.token_ok === false) add('bad', n, 'Token ist ungültig oder abgelaufen.');
        if (b.selftest && b.selftest !== 'ok') add('warn', n, 'Selbsttest: ' + b.selftest + '.');
        if (b.old_image) add('warn', n, 'Box läuft auf einem alten Image.');
        if (b.restarts > 0) add('warn', n, b.restarts + (b.restarts === 1 ? ' Neustart' : ' Neustarts') + ' seit dem Start.');
      }
      for (const note of b.notes || []) add('warn', n, note);
      const busy = b.claude && b.claude.state === 'working'; // changes are expected while Claude works
      if (!busy && b.unpushed > 0) add('info', n, b.unpushed + ' Commit' + (b.unpushed > 1 ? 's' : '') + ' nicht gepusht (' + b.branch + ').');
      if (!busy && b.uncommitted > 0) add('info', n, b.uncommitted + ' Datei' + (b.uncommitted > 1 ? 'en' : '') + ' nicht committet (' + b.branch + ').');
    }
    if (r) {
      if (r.main && r.main.ci && r.main.ci.conclusion === 'failure') add('bad', n, 'CI auf main ist rot.', r.main.ci.url);
      const s = r.site;
      if (s && s.checked !== false && s.level && s.level !== 'ok') add(s.level, n, 'Seite: ' + (s.note || (s.up === false ? 'nicht erreichbar' : 'Abweichung')) + '.');
      for (const pr of r.prs) {
        const t = '#' + pr.number + ' ' + pr.title;
        if (pr.labels.includes('manual-review')) add('warn', n, 'PR wartet auf deine Prüfung: ' + t, pr.url);
        else if (pr.ci === 'red') add('bad', n, 'PR mit rotem CI: ' + t, pr.url);
      }
    }
  }
  return items.sort((a, b) => TODO_SEV[a.sev] - TODO_SEV[b.sev]);
}
function renderTodo(all, stale) {
  const list = $('todo');
  const items = todoItems(all, stale);
  attention = items.filter((i) => i.sev !== 'info').length;
  if (!items.length) { list.replaceChildren(el('li', 'todo-none', 'Nichts zu tun. Alles läuft.')); return; }
  list.replaceChildren(...items.map((i) => {
    const li = el('li', 'todo-item ' + i.sev);
    const txt = el('span', 'tx');
    if (i.project) {
      const b = el('button', 'proj', i.project);
      b.type = 'button';
      b.dataset.p = i.project;
      txt.append(b, ' ');
    }
    txt.append(i.text);
    li.append(txt);
    if (i.href) li.append(link(i.href, 'Öffnen'));
    return li;
  }));
}

// ---- pull requests (all repos, review-needed first) ----
const PR_CI = { green: 'CI grün', red: 'CI rot', running: 'CI läuft', none: 'kein CI' };
const prRank = (x) => (x.labels.includes('manual-review') ? 0 : 3) + ({ red: 0, running: 1, none: 2, green: 2 }[x.ci] ?? 2);
function renderPrs(all) {
  const list = [];
  for (const p of all) if (p.repo) for (const pr of p.repo.prs) list.push({ ...pr, project: p.name });
  list.sort((a, b) => prRank(a) - prRank(b) || Date.parse(a.created_at) - Date.parse(b.created_at));
  const review = list.filter((x) => x.labels.includes('manual-review')).length;
  $('prcount').textContent = review ? String(review) : '';
  $('prsub').textContent = list.length
    ? list.length + (list.length === 1 ? ' offener PR' : ' offene PRs') + (review ? ', davon ' + review + ' zur Prüfung durch dich' : '')
    : '';
  const wrap = $('prs');
  if (!list.length) { wrap.replaceChildren(el('p', 'empty', 'Keine offenen Pull Requests.')); return; }
  const t = el('table');
  const head = el('tr');
  for (const [label, cls] of [['Projekt'], ['Pull Request'], ['Autor'], ['Alter', 'num'], ['Labels'], ['CI']]) {
    const th = el('th', cls || '', label);
    th.scope = 'col';
    head.append(th);
  }
  const thead = el('thead');
  thead.append(head);
  const tbody = el('tbody');
  for (const pr of list) {
    const tr = el('tr');
    const name = el('th', 'name', pr.project);
    name.scope = 'row';
    const title = el('td');
    title.append(link(pr.url, '#' + pr.number + ' ' + pr.title));
    if (pr.draft) title.append(' ', el('span', 'chip', 'Entwurf'));
    const labels = el('td');
    for (const l of pr.labels) labels.append(el('span', 'chip' + (l === 'manual-review' ? ' review' : ''), l), ' ');
    if (!pr.labels.length) labels.textContent = '–';
    const ci = el('td');
    ci.append(el('span', 'chip ' + pr.ci, PR_CI[pr.ci] || pr.ci));
    tr.append(name, title, el('td', null, pr.author), el('td', 'num', ago(Math.max(0, Math.round((now() - Date.parse(pr.created_at)) / 1000)))), labels, ci);
    tbody.append(tr);
  }
  t.append(thead, tbody);
  wrap.replaceChildren(t);
}

// ---- table view ----
const COLS = [
  { key: 'name', label: 'Projekt' },
  { key: 'status', label: 'Status' },
  { key: 'claude', label: 'Claude' },
  { key: 'tokens', label: 'Output heute', num: true },
  { key: 'ram', label: 'RAM', num: true },
  { key: 'cpu', label: 'CPU', num: true },
  { key: null, label: 'PRs', num: true },
  { key: null, label: 'Blockiert', num: true },
];
function renderTable(shown) {
  const wrap = $('table');
  if (ui.v !== 'table' || !shown.length) { if (ui.v !== 'table') wrap.replaceChildren(); return; }
  const t = el('table');
  const head = el('tr');
  for (const c of COLS) {
    const th = el('th', c.num ? 'num' : '');
    th.scope = 'col';
    if (c.key) {
      const on = sortKey === c.key;
      th.setAttribute('aria-sort', on ? (ui.rev ? 'descending' : 'ascending') : 'none');
      const b = el('button', null, c.label);
      b.type = 'button';
      b.dataset.col = c.key;
      if (on) b.append(el('span', 'arrow', ui.rev ? ' ▲' : ' ▼'));
      th.append(b);
    } else th.textContent = c.label;
    head.append(th);
  }
  const thead = el('thead');
  thead.append(head);
  const tbody = el('tbody');
  for (const p of shown) {
    const b = p.box, tr = el('tr');
    const name = el('th', 'name');
    name.scope = 'row';
    const go = el('button', null, p.name);
    go.type = 'button';
    go.dataset.p = p.name;
    go.title = 'Projektseite öffnen';
    name.append(go);
    const st = el('td');
    st.append(el('span', 'dot ' + p.level), ' ', LABEL[p.level]);
    const cl = el('td');
    if (b && b.running === false) cl.textContent = 'gestoppt';
    else if (b && b.claude && b.claude.state) {
      const c = el('span', 'cl ' + b.claude.state);
      c.append(el('span', 'cdot'), el('span', null, CLAUDE_STATE[b.claude.state]));
      cl.append(c);
    } else cl.textContent = '–';
    const num = (v) => el('td', 'num', v);
    const s = b && b.stats;
    const denied = b && b.egress ? b.egress.denied_1h : null;
    tr.append(name, st, cl,
      num(tokensOut(p) ? compact(tokensOut(p)) : '–'),
      num(s ? Math.round(s.mem_pct) + ' %' : '–'),
      num(s ? nf.format(s.cpu_pct) + ' %' : '–'),
      num(p.repo ? String(p.repo.prs.length) : '–'),
      num(denied == null ? '–' : String(denied)));
    if (denied > 0) tr.lastChild.className = 'num bad-text';
    tbody.append(tr);
  }
  t.append(thead, tbody);
  wrap.replaceChildren(t);
}

// ---- tokens per day, stacked by project ----
function dayList(n) {
  const end = Date.parse(data.generated_at.slice(0, 10) + 'T00:00:00Z');
  return Array.from({ length: n }, (_, i) => new Date(end - (n - 1 - i) * 864e5).toISOString().slice(0, 10));
}
const hidden = new Set();
function niceMax(max, ticks) {
  const raw = Math.max(max, 1) / ticks, mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  return { step, max: step * ticks };
}
function axisNum(n, metric) {
  return metric === 'turns' ? fmtInt.format(n) : compact(n);
}

function tokenChart(all) {
  const host = $('chart-tokens'), legend = $('legend'), n = +ui.r, metric = METRICS[ui.m];
  const days = dayList(n);
  let series = all.filter((p) => p.box && p.box.claude && p.box.claude.days).map((p) => {
    const byDay = new Map(p.box.claude.days.map((d) => [d.date, metric.get(d)]));
    const values = days.map((d) => byDay.get(d) || 0);
    return { name: p.name, values, total: values.reduce((a, b) => a + b, 0) };
  }).filter((s) => s.total > 0).sort((a, b) => b.total - a.total);
  const MAXS = 5;
  if (series.length > MAXS + 1) {
    const rest = series.slice(MAXS);
    series = series.slice(0, MAXS);
    series.push({ name: 'Andere (' + rest.length + ')', values: days.map((_, i) => rest.reduce((a, s) => a + s.values[i], 0)),
      total: rest.reduce((a, s) => a + s.total, 0), other: true });
  }
  series.forEach((s, i) => { s.i = i; });
  const live = series.filter((s) => !hidden.has(s.name));
  const totals = days.map((_, i) => live.reduce((a, s) => a + s.values[i], 0));
  const grand = totals.reduce((a, b) => a + b, 0);
  $('tokens-sub').textContent = metric.label + ', Summe ' + n + ' Tage: ' + axisNum(grand, ui.m) + ' · Spitze '
    + axisNum(Math.max(0, ...totals), ui.m) + ' pro Tag';

  legend.replaceChildren(...series.map((s) => {
    const b = el('button', 'lg s' + s.i);
    b.type = 'button';
    b.dataset.series = s.name;
    b.setAttribute('aria-pressed', String(!hidden.has(s.name)));
    b.append(el('span', 'sw'), el('span', 'nm', s.name), el('span', 'v', axisNum(s.total, ui.m)));
    return b;
  }));

  if (!series.length) { host.replaceChildren(el('p', 'empty', 'Keine Token-Daten im Zeitraum.')); return; }
  const W = Math.max(280, host.clientWidth || 640), H = 230, L = 46, R = 8, T = 10, B = 28;
  const pw = W - L - R, ph = H - T - B;
  const { step, max } = niceMax(Math.max(...totals), 4);
  const y = (v) => T + ph - (v / max) * ph;
  const root = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, width: W, height: H, class: 'plot', role: 'group',
    'aria-label': metric.label + ' pro Tag und Projekt' });
  for (let v = 0; v <= max + 1e-9; v += step) {
    root.append(svg('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: v === 0 ? 'axis' : 'grid' }));
    const t = svg('text', { x: L - 6, y: y(v) + 4, class: 'tick', 'text-anchor': 'end' });
    t.textContent = axisNum(v, ui.m);
    root.append(t);
  }
  const bw = pw / n, bar = Math.min(54, bw * 0.62);
  const tip = el('div', 'tip');
  tip.hidden = true;
  const cols = [];
  days.forEach((d, i) => {
    const x = L + i * bw + (bw - bar) / 2;
    let acc = 0;
    const g = svg('g', { class: 'col', tabindex: 0, role: 'img' });
    const parts = [];
    g.append(svg('rect', { x: L + i * bw, y: T, width: bw, height: ph, class: 'hit' }));
    for (const s of live) {
      const v = s.values[i];
      if (!v) continue;
      const h = Math.max(1, (v / max) * ph);
      g.append(svg('rect', { x, y: y(acc + v), width: bar, height: Math.max(0, h - (h > 3 ? 1 : 0)), class: 'bar s' + s.i }));
      parts.push([s, v]);
      acc += v;
    }
    const lab = dayFmt.format(new Date(d + 'T00:00:00Z'));
    const tx = svg('text', { x: L + i * bw + bw / 2, y: H - 8, class: 'tick' + (i === n - 1 ? ' today' : ''), 'text-anchor': 'middle' });
    tx.textContent = bw < 60 ? lab.split(/[ ,]+/)[0].replace('.', '') + ' ' + +d.slice(8) : lab;
    root.append(g, tx);
    g.setAttribute('aria-label', lab + ': ' + axisNum(acc, ui.m) + ' gesamt'
      + parts.map(([s, v]) => ', ' + s.name + ' ' + axisNum(v, ui.m)).join(''));
    const show = () => {
      for (const c of cols) c.classList.remove('on');
      g.classList.add('on');
      tip.replaceChildren(el('b', null, lab));
      tip.append(el('div', 'tot', axisNum(acc, ui.m) + ' ' + metric.label));
      for (const [s, v] of parts.slice().reverse()) {
        const r = el('div', 'tr s' + s.i);
        r.append(el('span', 'sw'), el('span', 'nm', s.name), el('span', 'v', axisNum(v, ui.m)));
        tip.append(r);
      }
      if (!parts.length) tip.append(el('div', 'tr', 'keine Nutzung'));
      tip.hidden = false;
      const cx = L + i * bw + bw / 2, tw = tip.offsetWidth;
      tip.style.left = Math.max(0, Math.min(W - tw, cx - tw / 2)) + 'px';
      tip.style.top = Math.max(0, y(acc) - tip.offsetHeight - 8) + 'px';
    };
    const hide = () => { g.classList.remove('on'); tip.hidden = true; };
    g.addEventListener('pointerenter', show);
    g.addEventListener('focus', show);
    g.addEventListener('pointerleave', hide);
    g.addEventListener('blur', hide);
    cols.push(g);
  });
  host.replaceChildren(root, tip);
}

// ---- horizontal bar lists (resources, egress) ----
function barRow(p, valueText, frac, cls, extra) {
  const li = el('li');
  const b = el('button', 'barrow');
  b.type = 'button';
  b.dataset.go = p.name;
  b.title = 'Zur Karte springen';
  const track = svg('svg', { viewBox: '0 0 100 8', preserveAspectRatio: 'none', class: 'track', 'aria-hidden': 'true' });
  track.append(svg('rect', { x: 0, y: 0, width: 100, height: 8, rx: 2, class: 'bg' }));
  track.append(svg('rect', { x: 0, y: 0, width: Math.max(frac > 0 ? 1.5 : 0, Math.min(100, frac * 100)), height: 8, rx: 2, class: 'fill ' + cls }));
  b.append(el('span', 'nm', labelOf(p)), track, el('span', 'v', valueText));
  if (extra) b.append(extra);
  li.append(b);
  return li;
}
function resChart(all) {
  const cpu = ui.res === 'cpu';
  const rows = all.filter((p) => p.box && p.box.stats).map((p) => ({ p, v: cpu ? p.box.stats.cpu_pct : p.box.stats.mem_pct }))
    .sort((a, b) => cmp(a.v, b.v) || a.p.name.localeCompare(b.p.name)).slice(0, 8);
  const list = $('chart-res');
  press($('resmetric'), 'res', ui.res);
  if (!rows.length) { list.replaceChildren(el('li', 'empty', 'Keine laufenden Boxen.')); return; }
  list.replaceChildren(...rows.map(({ p, v }) => {
    const s = p.box.stats;
    const txt = nf.format(v) + ' %' + (cpu ? '' : ' · ' + s.mem_mib + ' MiB');
    return barRow(p, txt, v / 100, v >= 90 ? 'bad' : v >= 75 ? 'warn' : 'info');
  }));
}
function egressChart(all) {
  const rows = all.filter((p) => p.box && p.box.egress).map((p) => ({ p, e: p.box.egress }))
    .sort((a, b) => cmp(a.e.denied_1h, b.e.denied_1h) || cmp(a.e.requests_1h, b.e.requests_1h) || a.p.name.localeCompare(b.p.name)).slice(0, 8);
  const list = $('chart-egress');
  if (!rows.length) { list.replaceChildren(el('li', 'empty', 'Keine Egress-Daten.')); return; }
  const max = Math.max(...rows.map((r) => r.e.requests_1h), 1);
  list.replaceChildren(...rows.map(({ p, e }) => {
    const extra = e.denied_1h > 0 ? el('span', 'flag bad', e.denied_1h + ' blockiert')
      : e.expected_denied_1h ? el('span', 'flag', e.expected_denied_1h + ' erwartet') : el('span', 'flag');
    return barRow(p, fmtInt.format(e.requests_1h), e.requests_1h / max, e.denied_1h > 0 ? 'bad' : 'info', extra);
  }));
}

function renderInsights(all) {
  if (!all) {
    for (const id of ['chart-tokens', 'legend', 'chart-res', 'chart-egress']) $(id).replaceChildren();
    $('tokens-sub').textContent = '';
    return;
  }
  press($('metric'), 'metric', ui.m);
  press($('range'), 'range', ui.r);
  tokenChart(all);
  resChart(all);
  egressChart(all);
}

// ---- events (delegated, the DOM is rebuilt on every render) ----
function update() { syncUrl(); render(); }
document.addEventListener('click', (e) => {
  const t = e.target.closest('button');
  if (!t) return;
  const d = t.dataset;
  if (d.pg) { ui.pg = d.pg; update(); window.scrollTo(0, 0); }
  else if (d.p) { ui.pg = 'project'; ui.p = d.p; update(); window.scrollTo(0, 0); }
  else if (d.theme) { prefs.theme = d.theme; store('theme', d.theme); applyPrefs(); }
  else if (d.density) { prefs.density = d.density; store('density', d.density); applyPrefs(); }
  else if (d.f) { ui.f = d.f; update(); }
  else if (d.view) { ui.v = d.view; update(); }
  else if (d.metric) { ui.m = d.metric; update(); }
  else if (d.range) { ui.r = d.range; update(); }
  else if (d.res) { ui.res = d.res; update(); }
  else if (d.series) { hidden.has(d.series) ? hidden.delete(d.series) : hidden.add(d.series); render(); }
  else if (d.go) reveal(d.go);
  else if (d.reset) { ui.f = 'all'; ui.q = ''; update(); }
  else if (d.col) {
    if (sortKey === d.col) ui.rev = !ui.rev; else { sortKey = d.col; ui.rev = false; }
    store('sort', sortKey);
    update();
  }
});
$('q').addEventListener('input', () => { ui.q = $('q').value; update(); });
document.addEventListener('keydown', (e) => {
  const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName);
  if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey) { e.preventDefault(); ui.pg = 'projects'; update(); $('q').focus(); }
  else if (e.key === 'Escape' && document.activeElement === $('q')) { ui.q = ''; $('q').value = ''; update(); $('q').blur(); }
});
let lastW = 0, resizeT = 0;
new ResizeObserver(() => {
  const w = $('chart-tokens').clientWidth;
  if (!data || Math.abs(w - lastW) < 2) return;
  lastW = w;
  clearTimeout(resizeT);
  resizeT = setTimeout(() => tokenChart(merge(data)), 120);
}).observe($('chart-tokens'));
