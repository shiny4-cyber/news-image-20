// The board's stories and its DOM, built from the day's verified reports.
//
// Nine stories of Friday 20 November 2026: one lead, three at half the lead's weight, five in a
// compact band. Each line says what happened that day and no more; nothing here is expected,
// planned or forecast. The masthead's count is the number of stories this file lays out, and
// tools/render.mjs refuses the build if the two ever disagree.

const DAY = {
  weekday: 'Friday',
  date: '20 November 2026',
  stories: 'Nine stories',
  count: 9,
  regions: 'Four continents',
};

const LEAD = {
  kicker: 'The Hague &middot; International Court of Justice',
  headline: 'Court rules Myanmar committed genocide',
  deck: 'Its first finding that a state committed genocide, over the 2017 campaign against the Rohingya. Refugees in Bangladesh welcomed it and said they want to go home.',
  tally: '9&ndash;6',
  tallyLabel: 'Judges of the court, on the verdict',
};

const SECOND = [
  {
    kicker: 'Shenzhen &middot; First trilateral summit',
    headline: 'Trump, Xi and Putin issue a joint declaration',
    deck: 'Four points: nuclear risk, UN reform, energy supply, and the ICC&rsquo;s power over heads of state. Trump said he discussed AI safety limits with Xi.',
  },
  {
    kicker: 'Markets &middot; The AI sell-off',
    headline: 'AI stocks fall a day after Anthropic&rsquo;s debut',
    deck: 'The Nasdaq fell more than 2% and Tokyo&rsquo;s Nikkei 4.8%, the day after a listing that valued Anthropic at about $1.76 trillion.',
  },
  {
    kicker: 'Riyadh &middot; Vision 2030',
    headline: 'Houthi missiles damage the PIF tower',
    deck: 'The 80-storey symbol of Vision 2030 was hit; air defences intercepted further missiles and drones. Ten were killed in Sanaa over two days.',
  },
];

const GRID = [
  {
    place: 'Jerusalem',
    headline: 'Netanyahu calls a new Iran operation &lsquo;unavoidable&rsquo;',
  },
  {
    place: 'Kyiv',
    headline: 'Russian strikes kill three in Kyiv and cut its power',
  },
  {
    place: 'Brussels',
    headline: 'Britain and the EU hold a rare summit in Brussels',
  },
  {
    place: 'Nairobi',
    headline: 'Kenya discharges its last Ebola patient',
  },
  {
    place: 'Antalya',
    headline: 'COP31 enters its final day in Antalya',
  },
];

const FOOT_LEFT = 'Compiled 20 November 2026 &middot; AP &middot; Reuters &middot; One Turn &middot; SBS &middot; Indian Express &middot; WFTV';
const FOOT_RIGHT = 'One page &middot; no photographs &middot; no logos';

function el(tag, className, html) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html != null) node.innerHTML = html;
  return node;
}

function masthead() {
  const head = el('header', 'mast');
  head.appendChild(el('div', 'label', 'World news in one page'));
  head.appendChild(el('div', 'label', `${DAY.stories} &middot; ${DAY.regions}`));
  return head;
}

function dateline() {
  const band = el('div');
  band.appendChild(el('h1', 'dateline', `${DAY.weekday} ${DAY.date}`));
  band.appendChild(el('div', 'rule-a'));
  band.appendChild(el('div', 'rule-b'));
  return band;
}

function lead() {
  const band = el('section', 'lead');
  const main = el('div', 'lead-main');
  main.appendChild(el('div', 'kick lead-kick', LEAD.kicker));
  main.appendChild(el('h2', 'display lead-h', LEAD.headline));
  main.appendChild(el('p', 'deck lead-deck', LEAD.deck));

  const tally = el('div', 'tally');
  tally.appendChild(el('div', 'tally-n', LEAD.tally));
  tally.appendChild(el('div', 'kick tally-l', LEAD.tallyLabel));

  band.appendChild(main);
  band.appendChild(tally);
  return band;
}

function secondary() {
  const row = el('section', 'second');
  for (const item of SECOND) {
    const art = el('article');
    art.appendChild(el('div', 'kick', item.kicker));
    art.appendChild(el('h3', 'display', item.headline));
    art.appendChild(el('p', 'deck', item.deck));
    row.appendChild(art);
  }
  return row;
}

function band() {
  const section = el('section', 'grid');
  GRID.forEach((item, index) => {
    const wide = index < 3 ? 'w2' : 'w3';
    const first = index === 0 || index === 3 ? ' first' : '';
    const tall = index > 2 ? ' tall' : '';
    const cell = el('article', `cell ${wide}${first}${tall}`);
    cell.appendChild(el('div', 'kick', item.place));
    cell.appendChild(el('h3', 'display', item.headline));
    section.appendChild(cell);
  });
  return section;
}

function foot() {
  const bar = el('footer', 'foot');
  bar.appendChild(el('div', 'label', FOOT_LEFT));
  bar.appendChild(el('div', 'label', FOOT_RIGHT));
  return bar;
}

function build() {
  const page = document.getElementById('page');
  page.append(masthead(), dateline(), lead(), secondary(), band(), foot());

  const box = page.getBoundingClientRect();
  const parts = {};
  for (const child of page.children) {
    const key = child.className.split(' ')[0] || child.tagName.toLowerCase();
    parts[key] = Math.round(child.getBoundingClientRect().height);
  }
  const overflow = page.scrollHeight - page.clientHeight;
  document.getElementById('metrics').textContent = 'METRICS:' + JSON.stringify({
    width: Math.round(box.width),
    height: Math.round(box.height),
    scrollHeight: page.scrollHeight,
    overflow,
    parts,
  });
  if (overflow > 2) page.style.outline = '8px solid red';
}

// The layout audit tools/render.mjs reads: a block past the trim, a headline wider than its box,
// two pieces of type on top of each other, or a type hierarchy that has gone flat. It also counts
// what the page shows, so the masthead's number and the page's number cannot drift apart.
function audit() {
  const page = document.getElementById('page');
  // The trim is the page's own padding, so changing it does not need the audit rewritten.
  const pad = parseFloat(getComputedStyle(page).paddingLeft);
  const trimRight = 1600 - pad + 2;
  const trimLeft = pad - 2;
  const issues = [];
  const leaves = [];
  const nodes = page.querySelectorAll('h1,h2,h3,p,div,span,article,section,footer,header');

  for (const node of nodes) {
    const rect = node.getBoundingClientRect();
    const name = `${node.tagName.toLowerCase()}.${node.className || '-'}`;
    if (rect.right > trimRight || rect.left < trimLeft) issues.push(`off-trim-x ${name} ${Math.round(rect.left)}-${Math.round(rect.right)}`);
    if (rect.bottom > 1601) issues.push(`off-trim-y ${name} ${Math.round(rect.bottom)}`);
    if (node.clientWidth > 0 && node.scrollWidth > node.clientWidth + 1) issues.push(`over-wide ${name}`);
    if (node.children.length === 0 && node.textContent.trim()) {
      leaves.push({ name, top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right });
    }
  }

  for (let i = 0; i < leaves.length; i += 1) {
    for (let j = i + 1; j < leaves.length; j += 1) {
      const a = leaves[i];
      const b = leaves[j];
      const down = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      const across = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      if (down > 2 && across > 2) issues.push(`overlap ${a.name} / ${b.name}`);
    }
  }

  const shown = page.querySelectorAll('.lead, .second article, .cell').length;
  const size = (sel) => Math.round(parseFloat(getComputedStyle(page.querySelector(sel)).fontSize));
  const lastLine = (node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    const rects = [...range.getClientRects()];
    const top = Math.max(...rects.map((r) => r.top));
    const onLast = rects.filter((r) => Math.round(r.top) === Math.round(top));
    const right = Math.max(...onLast.map((r) => r.right));
    const left = Math.min(...onLast.map((r) => r.left));
    return { lines: new Set(rects.map((r) => Math.round(r.top))).size, lastFill: Math.round(right - left), box: Math.round(node.getBoundingClientRect().width) };
  };
  const measure = (sel) => [...page.querySelectorAll(sel)].map(lastLine);

  document.getElementById('audit').textContent = 'AUDIT:' + JSON.stringify({
    stated: DAY.count,
    shown,
    sizes: { lead: size('.lead-h'), second: size('.second h3'), cell: size('.cell h3') },
    lines: { lead: measure('.lead-h'), second: measure('.second h3'), cell: measure('.cell h3') },
    cells: [...page.querySelectorAll('.cell')].map((c) => Math.round(c.getBoundingClientRect().height)),
    count: issues.length,
    issues: issues.slice(0, 20),
  });
}

build();
audit();
