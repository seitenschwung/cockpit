'use strict';
// Dev and CI (localhost) read the sample data next to the page; production reads the home server.
const DATA_URL = ['localhost', '127.0.0.1'].includes(location.hostname)
  ? './status.json'
  : 'https://homeserver.tailedf987.ts.net/status.json';
const REFRESH_MS = 15000;
const STALE_S = 180;
const RANK = { ok: 0, warn: 1, bad: 2 };
const LABEL = { ok: 'OK', warn: 'Warnung', bad: 'Fehler' };
const $ = (id) => document.getElementById(id);
// ?now=<ISO> pins the clock, so the sample data can be shown without "collector stuck".
const nowParam = new URLSearchParams(location.search).get('now');
// A pinned clock keeps running from the pinned time, so the ticking can be seen too.
const pinned = nowParam ? new Date(nowParam).getTime() : null;
const loadedAt = Date.now();
const now = () => (pinned != null ? pinned + (Date.now() - loadedAt) : Date.now());

let data = null;
let fetchFailed = false;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function link(href, text) {
  const a = el('a', null, text);
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
}
function worst(...levels) {
  return levels.filter(Boolean).reduce((a, b) => (RANK[b] > RANK[a] ? b : a), 'ok');
}
function ago(s) {
  if (s < 60) return s + ' s';
  if (s < 3600) return Math.floor(s / 60) + ' min';
  if (s < 86400) return Math.floor(s / 3600) + ' h';
  return Math.floor(s / 86400) + ' d';
}
function ageText(ts) {
  return ago(Math.max(0, Math.round((now() - ts) / 1000)));
}
// Time label that the 1 s ticker keeps up to date (data-ts = epoch ms, data-pre = text before).
function ageEl(cls, ts, pre) {
  const e = el('span', cls, pre + ageText(ts));
  e.dataset.ts = ts;
  e.dataset.pre = pre;
  return e;
}
function row(key, ...content) {
  const r = el('div', 'row');
  r.append(el('span', 'k', key));
  const v = el('span', 'v');
  v.append(...content);
  r.append(v);
  return r;
}
const sep = () => el('span', 'muted', ' · ');

const nf = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });
function compact(n) {
  if (n >= 1e6) return nf.format(n / 1e6) + ' Mio.';
  if (n >= 1e3) return nf.format(n / 1e3) + ' Tsd.';
  return String(n);
}
const SVGNS = 'http://www.w3.org/2000/svg';
function svg(tag, attrs) {
  const e = document.createElementNS(SVGNS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
}
// 7-day output-token sparkline, attributes only (CSP forbids inline styles).
function sparkline(days) {
  const W = 84, H = 24, vals = days.map((d) => d.out || 0), max = Math.max(...vals, 1);
  const root = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, width: W, height: H, class: 'spark', role: 'img',
    'aria-label': 'Output-Tokens der letzten ' + days.length + ' Tage' });
  const bw = W / Math.max(days.length, 1);
  vals.forEach((v, i) => {
    const h = Math.max(1.5, (v / max) * (H - 2));
    root.append(svg('rect', { x: i * bw + 1, y: H - h, width: Math.max(1, bw - 2), height: h, rx: 1.5,
      class: i === vals.length - 1 ? 'last' : '' }));
  });
  return root;
}
const CLAUDE_STATE = { working: 'arbeitet gerade', recent: 'zuletzt aktiv', idle: 'inaktiv' };
function boxStats(box) {
  const wrap = el('div', 'boxstats');
  const c = box.claude;
  if (c && c.state) {
    const l = el('div', 'cl ' + c.state);
    l.append(el('span', 'cdot'), el('b', null, CLAUDE_STATE[c.state]));
    if (c.last_activity && c.state !== 'working') l.append(el('span', 'muted', ' · vor ' + ago(Math.max(0, Math.round((now() - Date.parse(c.last_activity)) / 1000)))));
    wrap.append(l);
  }
  const st = box.stats;
  if (st) {
    const mem = el('div', 'mem');
    mem.append(el('span', 'muted', 'RAM'), el('span', 'num', nf.format(st.mem_mib) + ' / ' + nf.format(st.mem_limit_mib) + ' MiB'));
    const m = el('meter', st.mem_pct >= 90 ? 'bad' : st.mem_pct >= 75 ? 'warn' : 'ok');
    m.min = 0; m.max = 100; m.value = Math.min(100, st.mem_pct);
    m.setAttribute('aria-label', 'RAM ' + st.mem_pct + ' %');
    wrap.append(mem, m);
    wrap.append(el('div', 'small muted num', 'CPU ' + nf.format(st.cpu_pct) + ' % · ' + st.pids + ' PIDs'));
  }
  if (c && c.today) {
    const t = el('div', 'tok');
    const txt = el('div');
    txt.append(el('b', 'num', compact(c.today.out)), el('span', 'muted', ' Output heute'),
      el('div', 'small muted num', 'Cache ' + compact(c.today.cache_read + c.today.cache_write) + ' · ' + c.today.turns + ' Turns'));
    t.append(txt);
    if (c.days && c.days.length > 1) t.append(sparkline(c.days));
    wrap.append(t);
  }
  if (box.oom_killed || box.restarts > 0) {
    wrap.append(el('div', 'warned small', (box.oom_killed ? 'Speicher-Limit erreicht (OOM). ' : '') + (box.restarts > 0 ? box.restarts + ' Neustart' + (box.restarts > 1 ? 's' : '') : '')));
  }
  const e = box.egress;
  if (e && e.denied_1h > 0) {
    const d = el('details', 'egress');
    d.append(el('summary', 'warned', e.denied_1h + ' blockiert (letzte Stunde)'));
    const ul = el('ul');
    for (const h of e.denied_hosts || []) ul.append(el('li', 'num', h.host + ' × ' + h.count));
    if (e.expected_denied_1h) ul.append(el('li', 'muted', e.expected_denied_1h + ' erwartet blockiert (nicht gezählt)'));
    d.append(ul);
    wrap.append(d);
  }
  return wrap.childNodes.length ? wrap : null;
}

function renderCard(p) {
  const { box, repo } = p;
  const card = el('article', 'card');
  card.dataset.level = p.level;

  const head = el('div', 'card-head');
  head.append(el('h3', null, p.name), el('span', 'lvl ' + p.level, LABEL[p.level]));
  card.append(head);

  if (repo && repo.activity !== 'idle') {
    const a = el('div', 'activity ' + repo.activity);
    a.append(el('span', 'spin'));
    const txt = repo.activity === 'deploying' ? 'Deploy läuft' : 'CI läuft';
    a.append(repo.active_run ? link(repo.active_run.url, txt + ': ' + repo.active_run.title) : el('span', null, txt));
    card.append(a);
  }

  const rows = el('div', 'rows');
  if (repo) {
    const s = repo.site;
    if (s && s.checked === false) {
      // The home server can't reach this site (up/ms/version are null): not an outage.
      rows.append(row('Seite', el('span', 'muted', 'nicht vom Home-Server prüfbar' + (s.note ? ' · ' + s.note : ''))));
    } else if (s) {
      const v = [];
      v.push(el('span', s.up ? 'good' : 'badc', s.up ? 'live' : 'nicht erreichbar'));
      if (s.up) v.push(el('span', 'muted num', ' · ' + s.ms + ' ms'));
      if (s.up && s.current === false) v.push(el('span', 'warned', ' · neuester Stand noch nicht live'));
      else if (s.up && s.current) v.push(el('span', 'muted', ' · neuester Stand live'));
      if (s.browser) v.push(el('span', 'muted', ' · im Browser geprüft'));
      rows.append(row('Seite', ...v));
    } else {
      rows.append(row('Seite', el('span', 'muted', 'keine')));
    }
    const ci = repo.main && repo.main.ci;
    const m = repo.main;
    const ciOk = ci && ci.conclusion === 'success';
    rows.append(row('Main',
      ci ? el('span', ciOk ? 'good' : 'badc', ciOk ? 'CI grün' : 'CI ' + ci.conclusion) : el('span', 'muted', 'kein CI'),
      sep(), el('span', null, (ci && !ciOk ? ci.title : m.title) || ''),
      ageEl('muted num', Date.parse((ci || m).created_at || m.date), ' · ')));
  }
  if (box) {
    const bv = [];
    if (box.running === false) bv.push(el('span', 'warned', 'gestoppt'));
    else bv.push(el('span', 'good', 'läuft'));
    bv.push(el('span', 'muted', ' · ' + box.branch));
    if (box.uncommitted) bv.push(el('span', 'warned', ' · ' + box.uncommitted + ' uncommitted'));
    if (box.unpushed) bv.push(el('span', 'warned', ' · ' + box.unpushed + ' unpushed'));
    rows.append(row('Box', ...bv));
  }
  card.append(rows);
  if (box && box.running !== false) { const bs = boxStats(box); if (bs) card.append(bs); }

  if (repo && repo.prs.length) {
    const prs = el('ul', 'prs');
    for (const pr of repo.prs) {
      const li = el('li', 'pr');
      const t = el('span', 't');
      t.append(link(pr.url, '#' + pr.number + ' ' + pr.title));
      li.append(t);
      if (pr.draft) li.append(el('span', 'chip', 'Entwurf'));
      for (const l of pr.labels) li.append(el('span', 'chip' + (l === 'manual-review' ? ' review' : ''), l));
      const cit = { green: 'CI grün', red: 'CI rot', running: 'CI läuft', none: 'kein CI' }[pr.ci] || pr.ci;
      li.append(el('span', 'chip ' + pr.ci, cit));
      prs.append(li);
    }
    card.append(prs);
  }

  if (box && box.notes.length) {
    const notes = el('ul', 'notes');
    for (const n of box.notes) notes.append(el('li', box.level === 'bad' ? 'bad' : null, n));
    card.append(notes);
  }

  const links = el('div', 'links');
  if (repo) {
    links.append(link(repo.url, 'Repo'));
    if (repo.main.ci && repo.main.ci.url) links.append(link(repo.main.ci.url, 'CI-Lauf'));
    if (repo.site) links.append(link(repo.site.url, 'Seite'));
  }
  card.append(links);
  return card;
}

function donut(s) {
  const NS = 'http://www.w3.org/2000/svg';
  const mk = (tag, attrs) => { const n = document.createElementNS(NS, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); return n; };
  const total = s.ok + s.warn + s.bad;
  const svg = mk('svg', { viewBox: '0 0 100 100', 'aria-hidden': 'true' });
  const C = 2 * Math.PI * 40;
  svg.append(mk('circle', { cx: 50, cy: 50, r: 40, fill: 'none', stroke: 'var(--line)', 'stroke-width': 10 }));
  let offset = 0;
  for (const [n, col] of [[s.ok, 'var(--ok)'], [s.warn, 'var(--warn)'], [s.bad, 'var(--bad)']]) {
    if (!n || !total) continue;
    const len = (n / total) * C;
    svg.append(mk('circle', { cx: 50, cy: 50, r: 40, fill: 'none', stroke: col, 'stroke-width': 10,
      'stroke-dasharray': len + ' ' + (C - len), 'stroke-dashoffset': -offset, transform: 'rotate(-90 50 50)' }));
    offset += len;
  }
  const pct = total ? Math.round((s.ok / total) * 100) : 0;
  const t1 = mk('text', { x: 50, y: 53, 'text-anchor': 'middle', class: 'n' });
  t1.textContent = pct + '%';
  const t2 = mk('text', { x: 50, y: 65, 'text-anchor': 'middle', class: 'l' });
  t2.textContent = 'gesund';
  svg.append(t1, t2);
  return svg;
}

function merge(d) {
  const names = new Map();
  for (const b of d.boxes) names.set(b.repo, { name: b.project, box: b });
  for (const r of d.repos) {
    const e = names.get(r.repo) || { name: r.repo.split('/').pop() };
    e.repo = r;
    names.set(r.repo, e);
  }
  const list = [...names.values()];
  for (const p of list) p.level = worst(p.box && p.box.level, p.repo && p.repo.level, p.repo && p.repo.site && p.repo.site.browser ? p.repo.site.level : null);
  list.sort((a, b) => RANK[b.level] - RANK[a.level] || a.name.localeCompare(b.name));
  return list;
}

function render() {
  const top = $('top'), notice = $('notice');
  const msgs = [];
  let noticeLevel = 'bad';

  if (!data) {
    top.dataset.level = 'unknown';
    $('verdict').textContent = 'Keine Daten';
    $('stats').replaceChildren();
    $('age').textContent = '';
    $('sub').textContent = '';
    $('donut').replaceChildren();
    $('cards').replaceChildren();
    $('host').replaceChildren();
    notice.textContent = 'status.json ist nicht ladbar. Neuer Versuch alle 15 s.';
    notice.className = 'notice';
    notice.hidden = false;
    return;
  }

  if (data.schema !== 1) msgs.push('Unbekanntes Schema ' + data.schema + ': Anzeige kann falsch sein.');
  const age = Math.max(0, Math.round((now() - Date.parse(data.generated_at)) / 1000));
  const stale = age > STALE_S;
  if (stale) msgs.push('Sammler hängt: letzter Stand vor ' + ago(age) + '.');
  if (fetchFailed) { msgs.push('status.json ist gerade nicht ladbar, zeige den letzten Stand.'); }
  if (!stale && !fetchFailed) noticeLevel = 'warn';

  const s = data.summary;
  const level = stale ? 'bad' : s.bad ? 'bad' : s.warn ? 'warn' : 'ok';
  top.dataset.level = level;
  $('verdict').textContent = { ok: 'Alles gut', warn: 'Warnungen', bad: 'Fehler' }[level];

  const stat = (n, label, cls) => { const li = el('li', cls); li.append(el('b', null, String(n)), el('span', null, label)); return li; };
  $('stats').replaceChildren(
    stat(s.bad, 'Fehler', s.bad ? 'bad' : ''), stat(s.warn, 'Warnungen', s.warn ? 'warn' : ''),
    stat(s.open_prs, 'offene PRs', ''), stat(s.deploying, 'laufende Deploys', s.deploying ? 'info' : ''));
  if (s.working != null) $('stats').append(stat(s.working, 'arbeitet gerade', s.working ? 'info' : ''));
  if (s.tokens_today) {
    const t = s.tokens_today, li = el('li', 'tokens');
    li.append(el('b', null, compact(t.out)), el('span', null, 'Output-Tokens heute'),
      el('small', null, 'Cache ' + compact(t.cache_read + t.cache_write) + ' · ' + t.turns + ' Turns'));
    $('stats').append(li);
  }
  $('sub').textContent = s.ok + ' von ' + (s.ok + s.warn + s.bad) + ' Prüfungen in Ordnung';
  $('donut').replaceChildren(donut(s));
  $('age').dataset.ts = Date.parse(data.generated_at);
  $('age').dataset.pre = 'Stand vor ';
  $('age').textContent = 'Stand vor ' + ago(age);

  notice.textContent = msgs.join(' ');
  notice.className = 'notice' + (noticeLevel === 'warn' ? ' warn' : '');
  notice.hidden = !msgs.length;

  $('cards').replaceChildren(...merge(data).map(renderCard));

  $('host').replaceChildren(...data.host.map((h) => {
    const li = el('li');
    const head = el('div', 'h');
    head.append(el('span', 'dot ' + h.level), el('b', null, h.name));
    li.append(head, el('span', 'txt', h.text));
    const pct = /(\d{1,3})\s*%/.exec(h.text);
    if (pct) {
      const m = el('meter', h.level);
      m.min = 0; m.max = 100; m.value = Math.min(100, +pct[1]);
      m.setAttribute('aria-label', h.name + ' ' + pct[1] + ' %');
      li.append(m);
    }
    return li;
  }));
}

// The collector can't reach the cockpit's own host, so the browser checks its own origin (same origin, no CORS).
// Other sites are never probed from here.
async function selfCheck(d) {
  for (const r of d.repos) {
    const s = r.site;
    let own = false;
    try { own = !!s && new URL(s.url).origin === location.origin; } catch (e) { /* bad url */ }
    if (!own) continue;
    const opts = { cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(5000) };
    const t0 = performance.now();
    let up = false, version = null;
    try {
      up = (await fetch('./healthz', opts)).ok;
      s.ms = Math.round(performance.now() - t0);
    } catch (e) { up = false; }
    if (up) {
      try {
        const v = await fetch('./version.txt', opts);
        if (v.ok) version = (await v.text()).trim() || null;
      } catch (e) { /* version unknown */ }
    }
    s.checked = true;
    s.browser = true;
    s.up = up;
    s.http_status = up ? 200 : null;
    s.version = version;
    s.current = version && r.main ? version === r.main.sha : null;
    s.level = !up ? 'bad' : s.current === false && r.activity === 'idle' ? 'warn' : 'ok';
    delete s.note;
  }
}

async function load() {
  try {
    const res = await fetch(DATA_URL, { cache: 'no-store', credentials: 'omit' });
    if (!res.ok) throw new Error(res.status);
    const d = await res.json();
    await selfCheck(d);
    data = d;
    fetchFailed = false;
  } catch (e) {
    fetchFailed = true;
  }
  render();
}

load();
setInterval(load, REFRESH_MS);
setInterval(() => {
  for (const e of document.querySelectorAll('[data-ts]')) e.textContent = e.dataset.pre + ageText(+e.dataset.ts);
}, 1000);
