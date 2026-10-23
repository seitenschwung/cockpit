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
const now = () => (nowParam ? new Date(nowParam).getTime() : Date.now());

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
function row(key, ...content) {
  const r = el('div', 'row');
  r.append(el('span', 'k', key));
  const v = el('span', 'v');
  v.append(...content);
  r.append(v);
  return r;
}
const sep = () => el('span', 'muted', ' · ');

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
    if (s) {
      const v = [];
      v.push(el('span', s.up ? 'good' : 'badc', s.up ? 'live' : 'nicht erreichbar'));
      if (s.up) v.push(el('span', 'muted num', ' · ' + s.ms + ' ms'));
      if (s.up && s.current === false) v.push(el('span', 'warned', ' · neuester Stand noch nicht live'));
      else if (s.up && s.current) v.push(el('span', 'muted', ' · neuester Stand live'));
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
      el('span', 'muted num', ' · ' + ago(Math.max(0, Math.round((now() - Date.parse((ci || m).created_at || m.date)) / 1000))))));
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

function merge(d) {
  const names = new Map();
  for (const b of d.boxes) names.set(b.repo, { name: b.project, box: b });
  for (const r of d.repos) {
    const e = names.get(r.repo) || { name: r.repo.split('/').pop() };
    e.repo = r;
    names.set(r.repo, e);
  }
  const list = [...names.values()];
  for (const p of list) p.level = worst(p.box && p.box.level, p.repo && p.repo.level);
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

  const stat = (n, label) => { const li = el('li'); li.append(el('b', null, String(n)), el('span', null, label)); return li; };
  $('stats').replaceChildren(
    stat(s.bad, 'Fehler'), stat(s.warn, 'Warnungen'), stat(s.open_prs, 'offene PRs'), stat(s.deploying, 'laufende Deploys'));
  $('age').textContent = 'Stand vor ' + ago(age);

  notice.textContent = msgs.join(' ');
  notice.className = 'notice' + (noticeLevel === 'warn' ? ' warn' : '');
  notice.hidden = !msgs.length;

  $('cards').replaceChildren(...merge(data).map(renderCard));

  $('host').replaceChildren(...data.host.map((h) => {
    const li = el('li');
    li.append(el('span', 'dot ' + h.level), el('b', null, h.name), el('span', 'muted', h.text));
    return li;
  }));
}

async function load() {
  try {
    const res = await fetch(DATA_URL, { cache: 'no-store', credentials: 'omit' });
    if (!res.ok) throw new Error(res.status);
    data = await res.json();
    fetchFailed = false;
  } catch (e) {
    fetchFailed = true;
  }
  render();
}

load();
setInterval(load, REFRESH_MS);
