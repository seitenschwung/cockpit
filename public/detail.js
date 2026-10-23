'use strict';
// Project detail page (#pg=project&p=<name>). Reuses the card building blocks from app.js.

function detailPanel(title) {
  const a = el('article', 'panel');
  a.append(el('header', null, ''));
  a.firstChild.append(el('h2', null, title));
  return a;
}

function dayTable(days) {
  const t = el('table', 'mini-table');
  const head = el('tr');
  for (const [l, c] of [['Tag'], ['Output', 'num'], ['Cache', 'num'], ['Turns', 'num']]) {
    const th = el('th', c || '', l);
    th.scope = 'col';
    head.append(th);
  }
  const thead = el('thead');
  thead.append(head);
  const body = el('tbody');
  for (const d of days.slice().reverse()) {
    const tr = el('tr');
    const day = el('th', null, new Date(d.date + 'T12:00:00Z').toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'numeric' }));
    day.scope = 'row';
    tr.append(day, el('td', 'num', compact(d.out)), el('td', 'num', compact(d.cache_read + d.cache_write)), el('td', 'num', String(d.turns)));
    body.append(tr);
  }
  t.append(thead, body);
  return t;
}

function renderDetail(all) {
  const root = $('detail');
  if (ui.pg !== 'project') { root.replaceChildren(); return; }
  const back = el('button', 'back', '← Alle Projekte');
  back.type = 'button';
  back.dataset.pg = 'projects';
  const p = all.find((x) => x.name === ui.p);
  if (!p) {
    root.replaceChildren(back, el('h1', 'pagetitle', 'Projekt nicht gefunden'), el('p', 'muted', '„' + ui.p + '“ kommt in den aktuellen Daten nicht vor.'));
    return;
  }
  const { box, repo } = p;

  const head = el('div', 'dhead');
  head.dataset.level = p.level;
  const h = el('h1', 'pagetitle', p.name);
  head.append(h, el('span', 'lvl ' + p.level, LABEL[p.level]));
  const links = el('div', 'links');
  if (repo) {
    links.append(link(repo.url, 'Repo'));
    if (repo.main.ci && repo.main.ci.url) links.append(link(repo.main.ci.url, 'CI-Lauf'));
    if (repo.site) links.append(link(repo.site.url, 'Seite'));
  }
  head.append(links);

  const grid = el('div', 'charts');

  const over = detailPanel('Überblick');
  over.append(...projectRows(p));
  grid.append(over);

  if (box) {
    const b = detailPanel('Box und Claude');
    if (box.running === false) b.append(el('p', 'warned', 'Box ist gestoppt.'));
    else { const bs = boxStats(box); if (bs) b.append(bs); }
    const facts = el('div', 'rows');
    if (box.started_at) facts.append(row('Gestartet', ageEl('muted num', Date.parse(box.started_at), 'vor ')));
    facts.append(row('Image', el('span', box.old_image ? 'warned' : 'good', box.old_image ? 'veraltet' : 'aktuell')));
    facts.append(row('Anmeldung', el('span', box.logged_in === false ? 'badc' : 'good', box.logged_in === false ? 'nicht angemeldet' : 'angemeldet'),
      sep(), el('span', box.token_ok === false ? 'badc' : 'muted', box.token_ok === false ? 'Token ungültig' : 'Token ok')));
    facts.append(row('Selbsttest', el('span', box.selftest === 'ok' ? 'good' : 'warned', String(box.selftest))));
    b.append(facts);
    if (box.notes && box.notes.length) {
      const notes = el('ul', 'notes');
      for (const n of box.notes) notes.append(el('li', box.level === 'bad' ? 'bad' : null, n));
      b.append(notes);
    }
    grid.append(b);
  }

  const prs = detailPanel('Pull Requests');
  if (repo && repo.prs.length) prs.append(prList(repo)); else prs.append(el('p', 'muted', 'Keine offenen Pull Requests.'));
  grid.append(prs);

  const days = box && box.claude && box.claude.days;
  if (days && days.length) {
    const t = detailPanel('Tokens pro Tag');
    t.append(el('p', 'panel-sub', 'Tage ohne Nutzung fehlen in den Daten'), dayTable(days));
    grid.append(t);
  }

  const e = box && box.egress;
  if (e) {
    const g = detailPanel('Egress, letzte Stunde');
    const rows = el('div', 'rows');
    rows.append(row('Anfragen', el('span', 'num', nf.format(e.requests_1h))),
      row('Blockiert', el('span', 'num', nf.format(e.denied_1h)), el('span', 'muted', e.expected_denied_1h ? ' · ' + e.expected_denied_1h + ' erwartet (nicht gezählt)' : '')));
    g.append(rows);
    if (e.denied_hosts && e.denied_hosts.length) {
      const ul = el('ul', 'hosts');
      for (const x of e.denied_hosts) ul.append(el('li', 'num', x.host + ' × ' + x.count));
      g.append(ul);
    }
    grid.append(g);
  }

  root.replaceChildren(back, head, grid);
}
