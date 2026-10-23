'use strict';
// Loaded before app.js (which starts fetching at once); top level only defines constants, helpers are used at call time.
// Activity page (#pg=activity): host and box curves, disks, deploys, sites, costs. Only fields the collector delivers;
// short series and missing values are shown as such, never filled in.

const eur = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
const usd = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'USD' });
const hm = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });
const dm = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'numeric' });
const dayShort = (iso) => dm.format(new Date(iso + 'T12:00:00Z'));

function dur(s) {
  if (s == null) return '';
  if (s < 60) return s + ' s';
  if (s < 3600) return Math.round(s / 60) + ' min';
  return nf.format(s / 3600) + ' h';
}

// One line per series, drawn over [t0, t1]; a gap longer than two steps breaks the line.
// series: [{cls, pts: [[t, v], ...]}], ymax fixed so lines of different panels compare.
function lineChart(series, { t0, t1, ymax, step, label, W = 560, H = 120 }) {
  const root = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'plot line', role: 'img', 'aria-label': label, preserveAspectRatio: 'none' });
  for (const f of [0, 0.5, 1]) root.append(svg('line', { x1: 0, x2: W, y1: H - f * (H - 4) - 2, y2: H - f * (H - 4) - 2, class: 'grid' }));
  const x = (t) => ((t - t0) / Math.max(1, t1 - t0)) * W;
  const y = (v) => H - 2 - Math.min(1, Math.max(0, v / ymax)) * (H - 4);
  for (const s of series) {
    let d = '', prev = null;
    for (const [t, v] of s.pts) {
      if (v == null) { prev = null; continue; }
      d += (prev == null || t - prev > step * 2 ? 'M' : 'L') + x(t).toFixed(1) + ' ' + y(v).toFixed(1);
      prev = t;
    }
    if (d) root.append(svg('path', { d, class: 'ln ' + s.cls, fill: 'none' }));
  }
  return root;
}

// Window is always the last 24 h so a young series is visibly short; the note says since when we have data.
function curve(history, cols, ymax, label) {
  const wrap = el('div', 'curve');
  const pts = (history && history.points) || [];
  if (!pts.length) { wrap.append(el('p', 'empty', 'Noch keine Daten.')); return wrap; }
  const t1 = Math.floor(now() / 1000), t0 = t1 - 86400;
  wrap.append(lineChart(cols.map((c, i) => ({ cls: c, pts: pts.map((p) => [p[0], p[i + 1]]) })),
    { t0, t1, ymax, step: history.step_s || 300, label }));
  const first = pts[0][0];
  const foot = el('div', 'axisnote');
  foot.append(el('span', null, first > t0 + 1800 ? 'Daten seit ' + hm.format(first * 1000) + ' Uhr' : '24 h'), el('span', null, 'jetzt'));
  wrap.append(foot);
  return wrap;
}

function legendKey(cls, text) {
  const s = el('span', 'key');
  s.append(el('i', 'sw ' + cls), document.createTextNode(text));
  return s;
}

function panel(title, sub) {
  const a = el('article', 'panel');
  const h = el('header');
  h.append(el('h2', null, title));
  a.append(h);
  if (sub) a.append(el('p', 'panel-sub', sub));
  return a;
}

function hostPanel(d) {
  const a = panel('Home-Server', 'CPU und RAM der letzten 24 h, 5-Minuten-Mittel');
  const m = d.host_metrics;
  if (!m) { a.append(el('p', 'empty', 'Keine Host-Daten.')); return a; }
  const facts = el('div', 'facts');
  for (const [k, v] of [
    ['CPU', m.cpu_pct == null ? '–' : nf.format(m.cpu_pct) + ' %'],
    ['RAM', nf.format(m.mem_pct) + ' % · ' + fmtInt.format(m.mem_used_mib) + ' von ' + fmtInt.format(m.mem_total_mib) + ' MiB'],
    ['Last (1 min)', nf.format(m.load1) + ' bei ' + m.cpus + ' Kernen'],
  ]) {
    const f = el('div');
    f.append(el('span', 'k', k), el('b', null, v));
    facts.append(f);
  }
  const keys = el('div', 'keys');
  keys.append(legendKey('c0', 'CPU %'), legendKey('c1', 'RAM %'));
  a.append(facts, keys, curve(m.history, ['c0', 'c1'], 100, 'CPU und RAM des Home-Servers, 24 Stunden'));
  return a;
}

function diskPanel(d) {
  const a = panel('Festplatten', 'Belegung heute, kleiner Verlauf über bis zu 30 Tage');
  const disks = d.disks || [];
  if (!disks.length) { a.append(el('p', 'empty', 'Keine Disk-Daten.')); return a; }
  const list = el('ul', 'disks');
  for (const k of disks) {
    const li = el('li');
    const head = el('div', 'h');
    head.append(el('span', 'dot ' + k.level), el('b', null, k.mount), el('span', 'txt', nf.format(k.free_gib) + ' GiB frei von ' + nf.format(k.total_gib) + ' GiB · ' + nf.format(k.pct) + ' %'));
    const m = el('meter', k.level);
    m.min = 0; m.max = 100; m.value = Math.min(100, k.pct);
    m.setAttribute('aria-label', k.mount + ' ' + nf.format(k.pct) + ' % belegt');
    li.append(head, m);
    const days = k.days || [];
    if (days.length >= 2) {
      const t = (x) => Date.parse(x.date + 'T12:00:00Z') / 1000;
      const ln = lineChart([{ cls: 'c0', pts: days.map((x) => [t(x), x.pct]) }],
        { t0: t(days[0]), t1: t(days[days.length - 1]), ymax: 100, step: 86400, label: k.mount + ', Belegung der letzten ' + days.length + ' Tage', H: 36 });
      const wrap = el('div', 'curve small');
      const foot = el('div', 'axisnote');
      foot.append(el('span', null, dayShort(days[0].date)), el('span', null, dayShort(days[days.length - 1].date)));
      wrap.append(ln, foot);
      li.append(wrap);
    } else {
      li.append(el('p', 'panel-sub', 'Verlauf folgt, erst ' + days.length + ' Messung' + (days.length === 1 ? '' : 'en') + '.'));
    }
    list.append(li);
  }
  a.append(list);
  return a;
}

function boxPanel(all) {
  const a = panel('Boxen', 'CPU (blau) und RAM (grün, relativ zum Limit) der letzten 24 h');
  a.classList.add('wide');
  const boxes = all.filter((p) => p.box && p.box.history && p.box.history.points.length);
  if (!boxes.length) { a.append(el('p', 'empty', 'Keine Box-Kurven.')); return a; }
  const grid = el('div', 'boxcurves');
  for (const p of boxes.sort((x, y) => x.name.localeCompare(y.name))) {
    const b = p.box, lim = b.stats && b.stats.mem_limit_mib;
    const cell = el('div', 'bc');
    const head = el('div', 'h');
    const nm = el('button', 'plain');
    nm.type = 'button';
    nm.dataset.p = p.name;
    nm.textContent = p.name;
    head.append(nm, el('span', 'txt', b.stats ? nf.format(b.stats.cpu_pct) + ' % · ' + fmtInt.format(b.stats.mem_mib) + ' MiB' + (lim ? ' von ' + fmtInt.format(lim) : '') : 'gestoppt'));
    cell.append(head);
    const pts = b.history.points.map(([t, c, m]) => [t, c, m == null ? null : lim ? (m / lim) * 100 : null]);
    const peak = Math.max(10, ...pts.map((q) => q[1] || 0));
    // CPU can exceed 100 % (several cores); scale to the peak, RAM stays 0..100 % of the limit.
    const ymax = Math.max(100, Math.ceil(peak / 50) * 50);
    cell.append(curve({ step_s: b.history.step_s, points: pts }, ['c0', 'c1'], ymax, p.name + ', CPU und RAM, 24 Stunden'));
    grid.append(cell);
  }
  a.append(grid);
  return a;
}

function deployPanel(d) {
  const a = panel('Letzte Deploys', 'Auf main, neueste zuerst, über alle Repos');
  const list = d.deploys || [];
  if (!list.length) { a.append(el('p', 'empty', 'Noch keine Deploys.')); return a; }
  const t = el('table', 'mini-table');
  const thead = el('thead'), hr = el('tr');
  for (const [l, c] of [['Repo'], ['Änderung'], ['Ergebnis'], ['Dauer', 'num'], ['Wann', 'num']]) {
    const th = el('th', c || '', l);
    th.scope = 'col';
    hr.append(th);
  }
  thead.append(hr);
  const body = el('tbody');
  const word = { success: ['ok', 'erfolgreich'], failure: ['bad', 'fehlgeschlagen'], cancelled: ['warn', 'abgebrochen'] };
  for (const x of list) {
    const tr = el('tr');
    const [lvl, txt] = word[x.conclusion] || ['warn', x.conclusion || '?'];
    const res = el('td'), flag = el('span', 'flag ' + lvl, txt);
    res.append(flag);
    const ts = x.finished_at || x.started_at;
    tr.append(el('td', null, x.repo.split('/').pop()), (() => { const c = el('td'); c.append(link(x.run_url, x.title)); return c; })(), res,
      el('td', 'num', dur(x.duration_s)), (() => { const c = el('td', 'num'); c.append(ageEl('', Date.parse(ts), 'vor ')); return c; })());
    body.append(tr);
  }
  t.append(thead, body);
  const wrap = el('div', 'tablewrap');
  wrap.append(t);
  a.append(wrap);
  return a;
}

function sitePanel(all) {
  const a = panel('Seiten', 'Verfügbarkeit, vom Home-Server minütlich geprüft');
  const sites = all.filter((p) => p.repo && p.repo.site);
  if (!sites.length) { a.append(el('p', 'empty', 'Keine Seiten.')); return a; }
  const ul = el('ul', 'sites');
  for (const p of sites) {
    const s = p.repo.site, li = el('li');
    const head = el('div', 'h');
    const down = !!s.down_since;
    head.append(el('span', 'dot ' + (down ? 'bad' : s.level)), el('b', null, p.name));
    li.append(head);
    if (s.checked === false) {
      li.append(el('span', 'txt muted', 'nicht vom Home-Server prüfbar'));
    } else {
      const bits = [];
      if (down) {
        const d = el('span', 'txt bad-text');
        d.append(ageEl('', Date.parse(s.down_since), 'Down seit '));
        li.append(d);
      } else {
        li.append(el('span', 'txt', s.uptime_24h == null
          ? 'Uptime 24 h: noch zu wenig Daten' + (s.tracked_since ? ' (seit ' + hm.format(Date.parse(s.tracked_since)) + ' Uhr)' : '')
          : 'Uptime 24 h: ' + nf.format(s.uptime_24h) + ' %'));
      }
      if (s.last_down_at) {
        const l = el('span', 'txt muted');
        l.append(ageEl('', Date.parse(s.last_down_at), 'zuletzt down vor '));
        if (s.last_down_s != null) l.append(document.createTextNode(' (' + dur(s.last_down_s) + ')'));
        li.append(l);
      } else if (!down && s.tracked_since) bits.push('seit Messbeginn kein Ausfall');
      if (bits.length) li.append(el('span', 'txt muted', bits.join(' · ')));
    }
    ul.append(li);
  }
  a.append(ul);
  return a;
}

function costPanel(d) {
  const a = panel('Kosten', 'Fixkosten pro Monat und API-Gegenwert der Box-Tokens');
  a.classList.add('wide');
  const c = d.costs;
  if (!c) { a.append(el('p', 'empty', 'Keine Kostendaten.')); return a; }
  const cols = el('div', 'costcols');

  const fx = el('div');
  fx.append(el('h3', null, 'Fixkosten'));
  const t = el('table', 'mini-table');
  const body = el('tbody');
  for (const f of c.fixed) {
    const tr = el('tr'), th = el('th', null, f.name);
    th.scope = 'row';
    const v = f.monthly == null ? el('td', 'num muted', 'nicht eingetragen') : el('td', 'num', eur.format(f.monthly));
    tr.append(th, v);
    if (f.note) th.title = f.note;
    body.append(tr);
  }
  const foot = el('tr', 'total'), fh = el('th', null, c.fixed_complete ? 'Summe pro Monat' : 'Bisher bekannt (unvollständig)');
  fh.scope = 'row';
  foot.append(fh, el('td', 'num', eur.format(c.fixed_complete && c.fixed_monthly_total != null ? c.fixed_monthly_total : c.fixed_monthly_known)));
  body.append(foot);
  t.append(body);
  fx.append(t);

  const ap = el('div');
  const api = c.api_equivalent;
  ap.append(el('h3', null, 'API-Gegenwert (nicht bezahlt)'));
  if (api) {
    ap.append(el('p', 'panel-sub', 'Was die Box-Tokens zu API-Listenpreisen kosten würden, Stand ' + dayShort(api.prices_as_of) + ' · Die Boxen laufen über ein Abo, das ist keine Rechnung.'));
    const t2 = el('table', 'mini-table');
    const hr = el('tr');
    for (const [l, cl] of [['Box'], ['Heute', 'num'], ['7 Tage', 'num']]) { const th = el('th', cl || '', l); th.scope = 'col'; hr.append(th); }
    const th = el('thead');
    th.append(hr);
    const b2 = el('tbody');
    for (const r of api.by_box.slice().sort((x, y) => y.last_7d_usd - x.last_7d_usd)) {
      const tr = el('tr'), h = el('th', null, r.project);
      h.scope = 'row';
      if (r.unpriced_tokens_7d) h.title = fmtInt.format(r.unpriced_tokens_7d) + ' Tokens ohne bekannten Preis nicht enthalten';
      tr.append(h, el('td', 'num', usd.format(r.today_usd)), el('td', 'num', usd.format(r.last_7d_usd)));
      b2.append(tr);
    }
    const tot = el('tr', 'total'), tl = el('th', null, 'Alle Boxen');
    tl.scope = 'row';
    tot.append(tl, el('td', 'num', usd.format(api.today_usd)), el('td', 'num', usd.format(api.last_7d_usd)));
    b2.append(tot);
    t2.append(th, b2);
    ap.append(t2);
  } else ap.append(el('p', 'empty', 'Kein API-Gegenwert.'));
  cols.append(fx, ap);
  a.append(cols);
  return a;
}

function renderActivity(all) {
  const root = $('activity');
  if (!all || !data) { root.replaceChildren(); return; }
  const g = el('div', 'charts');
  g.append(hostPanel(data), diskPanel(data), boxPanel(all), deployPanel(data), sitePanel(all), costPanel(data));
  root.replaceChildren(g);
}
