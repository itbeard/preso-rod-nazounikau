/* ==========================================================================
   Рухавічок прэзентацыі: навігацыя, крокі (builds), агляд, нататкі,
   рэжым выступоўцы, таймер, QR і жывы слоўнічак.
   ========================================================================== */
(() => {
  'use strict';

  const CFG = Object.assign({ chatgptUrl: '', chatgptLabel: '', timerMinutes: 10 }, window.PRESA_CONFIG || {});
  const qs = new URLSearchParams(location.search);
  const STATIC = qs.has('static');        // без анімацый, усе крокі адразу (скрыншоты, друк)
  const PRESENTER = qs.has('presenter');  // акно выступоўцы
  if (STATIC) document.documentElement.classList.add('no-anim');

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };

  const viewport = $('.viewport');
  const deck = $('.deck');
  const slides = $$('.deck > .slide');
  const builds = slides.map(s => $$('.b', s));

  slides.forEach((s, i) => {
    s.dataset.index = i;
    $$('.r', s).forEach((n, k) => { if (!n.style.getPropertyValue('--d')) n.style.setProperty('--d', n.dataset.d ?? k); });
  });

  let idx = 0;
  let step = 0;
  let applyingRemote = false;

  /* ---------- Маштаб ---------- */
  function fit() {
    if (document.body.classList.contains('overview')) return layoutOverview();
    const box = viewport.getBoundingClientRect();
    const s = Math.min(box.width / 1920, box.height / 1080) || 1;
    deck.style.setProperty('--scale', s);
    if (PRESENTER) fitMini();
  }
  addEventListener('resize', fit);

  /* ---------- Хукі слайдаў ---------- */
  const hooks = {};
  const hook = (i, name) => {
    const h = hooks[slides[i] && slides[i].dataset.hook];
    return h && typeof h[name] === 'function' ? h[name]() : undefined;
  };

  /* ---------- Рэндэр ---------- */
  const progress = el('div', 'progress');
  document.body.appendChild(progress);

  function render() {
    slides.forEach((s, i) => {
      const on = i === idx;
      s.classList.toggle('active', on);
      s.setAttribute('aria-hidden', on ? 'false' : 'true');
    });
    builds[idx].forEach((b, i) => b.classList.toggle('shown', i < step));
    document.body.dataset.theme = slides[idx].dataset.theme || 'light';
    progress.style.width = (slides.length > 1 ? (idx / (slides.length - 1)) * 100 : 100) + '%';
    hudCount && (hudCount.textContent = `${idx + 1} / ${slides.length}`);
    try { history.replaceState(null, '', '#' + (idx + 1)); } catch (e) { /* file:// у Safari */ }
    updateNotes();
    if (PRESENTER) updatePresenter();
    broadcast();
  }

  function go(i, s = 0) {
    i = clamp(i | 0, 0, slides.length - 1);
    const changed = i !== idx;
    if (changed) hook(idx, 'leave');
    idx = i;
    step = (s === 'all' || STATIC) ? builds[i].length : clamp(s, 0, builds[i].length);
    if (changed) hook(idx, 'enter');
    render();
  }
  function next() {
    unblack();
    if (hook(idx, 'next') === true) return;
    if (step < builds[idx].length) { step++; render(); }
    else if (idx < slides.length - 1) go(idx + 1, 0);
  }
  function prev() {
    unblack();
    if (step > 0 && !STATIC) { step--; render(); }
    else if (idx > 0) go(idx - 1, 'all');
  }

  function fromHash() {
    const h = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
    if (!h) return null;
    if (/^\d+$/.test(h)) return clamp(parseInt(h, 10) - 1, 0, slides.length - 1);
    const i = slides.findIndex(s => s.dataset.id === h); // напр. #materyjaly
    return i >= 0 ? i : null;
  }
  addEventListener('hashchange', () => { const h = fromHash(); if (h !== null && h !== idx) go(h, 'all'); });

  /* ---------- Сінхранізацыя вокнаў (рэжым выступоўцы) ---------- */
  const bc = 'BroadcastChannel' in window ? new BroadcastChannel('presa-sync') : null;
  function broadcast() {
    if (!bc || applyingRemote) return;
    bc.postMessage({ t: 'state', idx, step, timer: timerState() });
  }
  if (bc) {
    bc.onmessage = (e) => {
      const m = e.data || {};
      if (m.t === 'hello') { broadcast(); return; }
      if (m.t === 'cmd') { ({ next, prev, black: toggleBlack })[m.cmd]?.(); return; }
      if (m.t !== 'state') return;
      applyingRemote = true;
      try {
        if (m.timer) applyTimerState(m.timer);
        if (m.idx !== idx || m.step !== step) {
          const changed = m.idx !== idx;
          if (changed) hook(idx, 'leave');
          idx = clamp(m.idx, 0, slides.length - 1);
          step = clamp(m.step, 0, builds[idx].length);
          render();
          if (changed) hook(idx, 'enter');
        }
      } finally { applyingRemote = false; }
    };
  }

  /* ---------- Таймер ---------- */
  const T = { total: Math.round(CFG.timerMinutes * 60), remaining: Math.round(CFG.timerMinutes * 60), running: false, endAt: 0, done: false, int: 0 };
  const tLeft = () => T.running ? Math.max(0, (T.endAt - Date.now()) / 1000) : T.remaining;
  const timerState = () => ({ total: T.total, remaining: tLeft(), running: T.running, endAt: T.endAt, done: T.done });
  function applyTimerState(s) {
    Object.assign(T, { total: s.total, remaining: s.remaining, running: s.running, endAt: s.endAt, done: s.done });
    if (T.running) tLoop(); else clearInterval(T.int);
    tRender();
  }
  function tStart() {
    if (T.running) return;
    if (T.remaining <= 0) { T.remaining = T.total; }
    T.endAt = Date.now() + T.remaining * 1000; T.running = true; T.done = false;
    tLoop(); tRender(); broadcast();
  }
  function tPause() { if (!T.running) return; T.remaining = tLeft(); T.running = false; clearInterval(T.int); tRender(); broadcast(); }
  function tToggle() { T.running ? tPause() : tStart(); }
  function tReset() { T.running = false; T.remaining = T.total; T.done = false; clearInterval(T.int); tRender(); broadcast(); }
  function tAdjust(min) {
    if (T.running) return;
    T.total = clamp(T.total + min * 60, 60, 90 * 60); T.remaining = T.total; T.done = false;
    tRender(); broadcast();
  }
  function tLoop() {
    clearInterval(T.int);
    T.int = setInterval(() => {
      if (T.running && tLeft() <= 0) {
        T.running = false; T.remaining = 0; T.done = true; clearInterval(T.int);
        if (!PRESENTER) chime();
      }
      tRender();
    }, 200);
  }
  function fmt(sec) { const s = Math.ceil(sec); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
  function tRender() {
    const left = tLeft();
    $$('[data-timer]').forEach(box => {
      const ring = $('.prog', box);
      if (ring) {
        const c = 2 * Math.PI * ring.r.baseVal.value;
        ring.style.strokeDasharray = c;
        ring.style.strokeDashoffset = c * (1 - (T.total ? left / T.total : 0));
      }
      $('.time', box).textContent = fmt(left);
      const hint = $('.hint', box);
      if (hint) hint.textContent = T.done ? 'Час! Абіраем лепшае' : T.running ? 'Генеруем…' : (left === T.total ? 'Націсніце, каб пачаць' : 'Паўза');
      box.classList.toggle('done', T.done);
      box.classList.toggle('running', T.running);
    });
  }
  function chime() {
    try {
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      [0, 0.32, 0.64, 1.1].forEach((t, i) => {
        const o = ac.createOscillator(), g = ac.createGain();
        o.type = 'sine'; o.frequency.value = i === 3 ? 1175 : 880;
        const at = ac.currentTime + t;
        g.gain.setValueAtTime(0.0001, at);
        g.gain.exponentialRampToValueAtTime(0.35, at + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, at + (i === 3 ? 0.9 : 0.28));
        o.connect(g).connect(ac.destination); o.start(at); o.stop(at + 1);
      });
    } catch (e) { /* без гуку */ }
  }
  hooks.timer = {
    // Першае націсканне «далей» на слайдзе таймера запускае яго.
    next() {
      if (STATIC) return false;
      if (!T.running && !T.done && T.remaining === T.total) { tStart(); return true; }
      return false;
    },
  };
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-timer]');
    if (t && !t.closest('.pv-next')) { e.stopPropagation(); tToggle(); }
  }, true);

  /* ---------- Відэа ---------- */
  // Запускаецца пры ўваходзе на слайд, спыняецца пры выхадзе. Клік па відэа або K — паўза.
  const curVideo = () => $('[data-video] video', slides[idx]);
  function toggleVideo(v = curVideo()) {
    if (!v) return;
    if (v.paused) { if (v.ended) v.currentTime = 0; v.play().catch(() => {}); } else v.pause();
  }
  $$('[data-video]').forEach(box => {
    const v = $('video', box);
    if (PRESENTER) v.muted = true; // каб гук не ішоў з двух вокнаў
    const sync = () => box.classList.toggle('paused', v.paused);
    ['play', 'pause', 'ended'].forEach(ev => v.addEventListener(ev, sync));
    sync();
    box.addEventListener('click', (e) => {
      if (document.body.classList.contains('overview')) return;
      e.stopPropagation();
      toggleVideo(v);
    });
  });
  hooks.video = {
    enter() {
      const v = curVideo();
      if (!v || STATIC) return;
      v.currentTime = 0;
      v.play().catch(() => { /* браўзер забараніў аўтазапуск — дапаможа клік */ });
    },
    leave() { const v = curVideo(); if (v) v.pause(); },
  };

  /* ---------- QR і спасылкі ---------- */
  const MOTIF = [
    '......X......', '.....XXX.....', '....XX.XX....', '...XX.X.XX...', '..XX.XXX.XX..', '.XX.XX.XX.XX.', 'XX.XX.X.XX.XX',
    '.XX.XX.XX.XX.', '..XX.XXX.XX..', '...XX.X.XX...', '....XX.XX....', '.....XXX.....', '......X......',
  ];
  function qrSvg(text) {
    const qr = window.qrcode(0, 'H');
    qr.addData(text); qr.make();
    const n = qr.getModuleCount(), m = 2, size = n + m * 2;
    let d = '';
    for (let r = 0; r < n; r++) {
      let c = 0;
      while (c < n) {
        if (qr.isDark(r, c)) { const c0 = c; while (c < n && qr.isDark(r, c)) c++; d += `M${c0 + m} ${r + m}h${c - c0}v1h-${c - c0}z`; }
        else c++;
      }
    }
    // У цэнтры — арнамент (карэкцыя памылак H дазваляе закрыць частку кода)
    const box = Math.round(n * 0.23) | 1, bx = m + (n - box) / 2;
    const cell = (box - 1.2) / 13, ox = bx + 0.6;
    let md = '';
    MOTIF.forEach((row, y) => { for (let x = 0; x < 13; x++) if (row[x] === 'X') md += `M${(ox + x * cell).toFixed(3)} ${(ox + y * cell).toFixed(3)}h${cell.toFixed(3)}v${cell.toFixed(3)}h-${cell.toFixed(3)}z`; });
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img" aria-label="QR-код">` +
      `<rect width="${size}" height="${size}" fill="#fff"/><path fill="#0F0E0D" d="${d}"/>` +
      `<rect x="${bx}" y="${bx}" width="${box}" height="${box}" rx="0.6" fill="#fff"/><path fill="#A11C1C" d="${md}"/></svg>`;
  }
  const prettyUrl = (u) => {
    let s = u.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
    if (s.length > 36) s = s.slice(0, 24) + '…' + s.slice(-9);
    return s;
  };
  function initLinks() {
    // data-qr / data-link без значэння — спасылка на ChatGPT; data-qr="deckUrl" — на прэзентацыю
    const urlOf = (key) => (CFG[key || 'chatgptUrl'] || '').trim();
    $$('[data-qr]').forEach(box => {
      const url = urlOf(box.dataset.qr);
      if (url && window.qrcode) box.innerHTML = qrSvg(url);
      else box.innerHTML = '<div class="qr-empty">Тут будзе QR-код.<br>Устаўце спасылку ў js/config.js</div>';
    });
    $$('[data-link]').forEach(n => {
      const key = n.dataset.link || 'chatgptUrl';
      const url = urlOf(key);
      if (!url) { n.textContent = 'спасылка яшчэ не ўстаўлена'; return; }
      n.innerHTML = '';
      const a = el('a'); a.href = url; a.target = '_blank'; a.rel = 'noopener';
      a.textContent = CFG[key.replace(/Url$/, 'Label')] || prettyUrl(url);
      n.appendChild(a);
    });
    $$('[data-config-warning]').forEach(n => { n.hidden = !!urlOf('chatgptUrl'); });
    $$('[data-timer-min]').forEach(n => { n.textContent = Math.round(T.total / 60); });
  }

  /* ---------- Жывы слоўнічак ---------- */
  const SKEY = 'presa-slounik-v1';
  const sLoad = () => { try { const v = JSON.parse(localStorage.getItem(SKEY)); return Array.isArray(v) ? v : []; } catch (e) { return []; } };
  const sSave = (list) => { try { localStorage.setItem(SKEY, JSON.stringify(list)); } catch (e) { /* без захавання */ } };
  function sRender() {
    $$('[data-slounik]').forEach(box => {
      if (box.closest('.pv-next')) return;
      let list = sLoad();
      if (!list.length) list = [{ w: '', g: '', m: '' }, { w: '', g: '', m: '' }];
      box.innerHTML = '';
      list.forEach(it => box.appendChild(sRow(it)));
    });
  }
  function sRow(it) {
    const row = el('div', 'item');
    [['w', 'новае слова'], ['g', 'група'], ['m', 'што яно значыць і як ужываць']].forEach(([f, ph]) => {
      const c = el('div', f); c.contentEditable = 'true'; c.spellcheck = false; c.dataset.f = f; c.dataset.ph = ph;
      c.textContent = it[f] || ''; row.appendChild(c);
    });
    const del = el('button', 'del', '×'); del.type = 'button'; del.title = 'Выдаліць';
    row.appendChild(del);
    return row;
  }
  function sCollect(box) {
    return $$('.item', box).map(r => ({ w: $('.w', r).textContent.trim(), g: $('.g', r).textContent.trim(), m: $('.m', r).textContent.trim() }))
      .filter(x => x.w || x.g || x.m);
  }
  document.addEventListener('input', (e) => {
    const box = e.target.closest && e.target.closest('[data-slounik]');
    if (!box) return;
    if (e.target.textContent === '') e.target.innerHTML = '';
    sSave(sCollect(box));
  });
  document.addEventListener('paste', (e) => {
    if (!e.target.closest || !e.target.closest('[data-slounik]')) return;
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text/plain').replace(/\s+/g, ' ');
    document.execCommand('insertText', false, text);
  });
  document.addEventListener('click', (e) => {
    const del = e.target.closest('[data-slounik] .del');
    if (del) {
      const box = del.closest('[data-slounik]');
      del.closest('.item').remove(); sSave(sCollect(box));
      if (!$('.item', box)) sRender();
      return;
    }
    const add = e.target.closest('[data-slounik-add]');
    if (add) {
      const box = $('[data-slounik]', add.closest('.slide'));
      const row = sRow({}); box.appendChild(row);
      box.scrollTop = box.scrollHeight;
      $('.w', row).focus();
    }
  });
  addEventListener('storage', (e) => {
    if (e.key !== SKEY) return;
    const focused = document.activeElement && document.activeElement.closest && document.activeElement.closest('[data-slounik]');
    if (!focused) sRender();
  });
  hooks.slounik = { enter() { /* нічога */ } };

  /* ---------- Нататкі ---------- */
  const notesPanel = el('div', 'notes-panel');
  document.body.appendChild(notesPanel);
  function notesHtml(i) {
    const s = slides[i]; const n = $('.notes', s);
    const who = s.dataset.speaker ? `<div class="who">${s.dataset.speaker}</div>` : '';
    return who + (n ? n.innerHTML : '<span style="opacity:.5">Нататак няма</span>');
  }
  function updateNotes() { if (notesPanel.classList.contains('on')) notesPanel.innerHTML = notesHtml(idx); }
  function toggleNotes() { notesPanel.classList.toggle('on'); updateNotes(); }

  /* ---------- Чорны экран ---------- */
  const black = el('div', 'blackout'); document.body.appendChild(black);
  function toggleBlack() { black.classList.toggle('on'); }
  function unblack() { black.classList.remove('on'); }

  /* ---------- Даведка ---------- */
  const help = el('div', 'help', `<div class="box"><h3>Кіраванне</h3><dl>
    <dt>→ / Прабел / клік</dt><dd>далей (наступны крок або слайд)</dd>
    <dt>← / Backspace</dt><dd>назад</dd>
    <dt>F</dt><dd>на ўвесь экран</dd>
    <dt>O / Esc</dt><dd>агляд усіх слайдаў</dd>
    <dt>P</dt><dd>акно выступоўцы (нататкі, наступны слайд)</dd>
    <dt>N</dt><dd>нататкі на гэтым экране</dd>
    <dt>B або .</dt><dd>чорны экран</dd>
    <dt>лічба + Enter</dt><dd>перайсці да слайда</dd>
    <dt>K</dt><dd>відэа: паўза / прайграць</dd>
    <dt>S / R</dt><dd>таймер: старт-паўза / скінуць</dd>
    <dt>+ / −</dt><dd>таймер: ±1 хвіліна</dd>
  </dl></div>`);
  document.body.appendChild(help);
  help.addEventListener('click', () => help.classList.remove('on'));
  const toggleHelp = () => help.classList.toggle('on');

  /* ---------- Пераход па нумары ---------- */
  const jump = el('div', 'jump'); document.body.appendChild(jump);
  let jumpBuf = '', jumpT = 0;
  function pushJump(d) { jumpBuf = (jumpBuf + d).slice(-3); jump.textContent = '→ ' + jumpBuf; jump.classList.add('on'); clearTimeout(jumpT); jumpT = setTimeout(clearJump, 2500); }
  function clearJump() { jumpBuf = ''; jump.classList.remove('on'); }

  /* ---------- Агляд ---------- */
  function layoutOverview() {
    const W = document.documentElement.clientWidth - 64, gap = 24;
    const cols = Math.max(2, Math.floor((W + gap) / (330 + gap)));
    const colW = (W - gap * (cols - 1)) / cols;
    deck.style.gridTemplateColumns = `repeat(${cols}, ${colW}px)`;
    document.body.style.setProperty('--ov-zoom', colW / 1920);
  }
  function toggleOverview(force) {
    if (PRESENTER) return;
    const on = force === undefined ? !document.body.classList.contains('overview') : force;
    document.body.classList.toggle('overview', on);
    if (on) { layoutOverview(); slides[idx].scrollIntoView({ block: 'center' }); }
    else { deck.style.gridTemplateColumns = ''; window.scrollTo(0, 0); fit(); }
  }
  deck.addEventListener('click', (e) => {
    if (!document.body.classList.contains('overview')) return;
    const s = e.target.closest('.slide');
    if (s) { e.stopPropagation(); toggleOverview(false); go(+s.dataset.index, 'all'); }
  }, true);

  /* ---------- Поўнаэкранны рэжым ---------- */
  function toggleFs() {
    const d = document, r = d.documentElement;
    if (d.fullscreenElement || d.webkitFullscreenElement) (d.exitFullscreen || d.webkitExitFullscreen).call(d);
    else (r.requestFullscreen || r.webkitRequestFullscreen)?.call(r);
  }

  /* ---------- Акно выступоўцы ---------- */
  function openPresenter() {
    if (PRESENTER) return;
    const u = location.pathname + '?presenter' + location.hash;
    window.open(u, 'presa-presenter', 'width=1280,height=820');
  }

  /* ---------- HUD ---------- */
  const ICON = {
    prev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
    next: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>',
    grid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/></svg>',
    pres: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="4" width="19" height="13" rx="2"/><path d="M8 21h8M12 17v4M6.5 8.5h6M6.5 12h4"/></svg>',
    fs: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
    help: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.2-2.4 3.6M12 17h.01"/></svg>',
  };
  let hudCount = null;
  if (!PRESENTER) {
    const hud = el('div', 'hud');
    hud.innerHTML = `<button data-a="prev" title="Назад (←)">${ICON.prev}</button><span class="count"></span><button data-a="next" title="Далей (→)">${ICON.next}</button>
      <button data-a="grid" title="Агляд (O)">${ICON.grid}</button><button data-a="pres" title="Акно выступоўцы (P)">${ICON.pres}</button>
      <button data-a="fs" title="На ўвесь экран (F)">${ICON.fs}</button><button data-a="help" title="Даведка (?)">${ICON.help}</button>`;
    document.body.appendChild(hud);
    hudCount = $('.count', hud);
    hud.addEventListener('click', (e) => {
      e.stopPropagation();
      const a = e.target.closest('button')?.dataset.a;
      ({ prev, next, grid: () => toggleOverview(), pres: openPresenter, fs: toggleFs, help: toggleHelp })[a]?.();
    });
    let hudT = 0;
    const showHud = () => { hud.classList.add('show'); clearTimeout(hudT); hudT = setTimeout(() => { if (!hud.matches(':hover')) hud.classList.remove('show'); }, 2200); };
    addEventListener('mousemove', showHud, { passive: true });
  }

  /* ---------- Клавіятура ---------- */
  document.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) { if (e.key === 'Escape') t.blur(); return; }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    if (help.classList.contains('on') && k !== '?') { help.classList.remove('on'); e.preventDefault(); return; }
    if (/^[0-9]$/.test(k)) { pushJump(k); e.preventDefault(); return; }
    switch (k) {
      case 'ArrowRight': case 'ArrowDown': case 'PageDown': next(); break;
      case ' ': case 'Spacebar': e.shiftKey ? prev() : next(); break;
      case 'Enter': if (jumpBuf) { const n = parseInt(jumpBuf, 10); clearJump(); go(n - 1, 'all'); } else next(); break;
      case 'ArrowLeft': case 'ArrowUp': case 'PageUp': case 'Backspace': prev(); break;
      case 'Home': go(0); break;
      case 'End': go(slides.length - 1, 'all'); break;
      case 'f': case 'F': case 'а': case 'А': toggleFs(); break;
      case 'o': case 'O': case 'щ': case 'Щ': case 'ў': case 'Ў': toggleOverview(); break;
      case 'Escape':
        if (document.body.classList.contains('overview')) toggleOverview(false);
        else if (notesPanel.classList.contains('on')) toggleNotes();
        else if (jumpBuf) clearJump();
        else return;
        break;
      case 'n': case 'N': case 'т': case 'Т': toggleNotes(); break;
      case 'p': case 'P': case 'з': case 'З': openPresenter(); break;
      case 'b': case 'B': case '.': case 'и': case 'І': case 'і': toggleBlack(); break;
      case 's': case 'S': case 'ы': case 'Ы': tToggle(); break;
      case 'r': case 'R': case 'к': case 'К': tReset(); break;
      case 'k': case 'K': case 'л': case 'Л': toggleVideo(); break;
      case '+': case '=': tAdjust(1); break;
      case '-': case '_': tAdjust(-1); break;
      case '?': case 'h': case 'H': toggleHelp(); break;
      default: return;
    }
    e.preventDefault();
  });

  /* ---------- Мыш і дотык ---------- */
  let swiped = false, tx = 0, ty = 0;
  const interactive = (n) => n.closest('a, button, [contenteditable="true"], input, textarea, select, [data-timer], .no-nav, .hud');
  addEventListener('touchstart', (e) => { const p = e.changedTouches[0]; tx = p.clientX; ty = p.clientY; swiped = false; }, { passive: true });
  addEventListener('touchend', (e) => {
    if (document.body.classList.contains('overview') || PRESENTER) return;
    const p = e.changedTouches[0], dx = p.clientX - tx, dy = p.clientY - ty;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.3) { swiped = true; dx < 0 ? next() : prev(); }
  }, { passive: true });
  viewport.addEventListener('click', (e) => {
    if (swiped) { swiped = false; return; }
    if (document.body.classList.contains('overview') || PRESENTER) return;
    if (interactive(e.target)) return;
    if (window.getSelection && String(window.getSelection())) return;
    e.clientX < innerWidth * 0.25 ? prev() : next();
  });

  /* ---------- Рэжым выступоўцы ---------- */
  let pv = null, mini = null, startedAt = Date.now();
  function buildPresenter() {
    document.body.classList.add('presenter');
    pv = el('div', 'pv', `
      <div class="pv-head"><span class="clock"></span><span class="elapsed" title="Клік — абнуліць">0:00</span><span class="title"></span><span class="count"></span></div>
      <div class="pv-cur"></div>
      <div class="pv-side">
        <div class="pv-next"><span class="lbl">Далей</span><div class="mini"></div></div>
        <div class="pv-notes"><span class="lbl">Нататкі</span><div class="nb"></div><div class="steps"></div></div>
      </div>
      <div class="pv-foot"><button data-a="prev">← Назад</button><button data-a="black">Чорны экран</button><button class="primary" data-a="next">Далей →</button></div>`);
    document.body.appendChild(pv);
    $('.pv-cur', pv).appendChild(viewport);
    mini = $('.mini', pv);
    $('.pv-foot', pv).addEventListener('click', (e) => {
      const a = e.target.closest('button')?.dataset.a;
      if (a === 'black') { bc && bc.postMessage({ t: 'cmd', cmd: 'black' }); return; }
      ({ prev, next })[a]?.();
    });
    $('.elapsed', pv).addEventListener('click', () => { startedAt = Date.now(); });
    setInterval(() => {
      const d = new Date();
      $('.clock', pv).textContent = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      const s = Math.floor((Date.now() - startedAt) / 1000);
      $('.elapsed', pv).textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }, 500);
    document.title = 'Выступоўца — ' + document.title;
    bc && bc.postMessage({ t: 'hello' });
  }
  function fitMini() {
    if (!mini) return;
    const w = mini.parentElement.getBoundingClientRect().width;
    mini.style.transform = `scale(${w / 1920})`;
  }
  function updatePresenter() {
    if (!pv) return;
    const s = slides[idx];
    $('.count', pv).textContent = `${idx + 1} / ${slides.length}`;
    $('.title', pv).textContent = s.dataset.title || '';
    $('.nb', pv).innerHTML = notesHtml(idx);
    $('.steps', pv).textContent = builds[idx].length ? `Крок ${step} з ${builds[idx].length}` : '';
    const hasMoreSteps = step < builds[idx].length;
    const target = hasMoreSteps ? s : slides[idx + 1];
    $('.pv-next .lbl', pv).textContent = hasMoreSteps ? 'Наступны крок' : (target ? 'Наступны слайд' : 'Канец');
    mini.innerHTML = '';
    if (target) {
      const c = target.cloneNode(true);
      c.classList.remove('active');
      if (hasMoreSteps) $$('.b', c).forEach((b, i) => b.classList.toggle('shown', i <= step));
      else $$('.b', c).forEach(b => b.classList.add('shown'));
      c.removeAttribute('aria-hidden');
      mini.appendChild(c);
    }
    fitMini();
  }

  /* ---------- Старт ---------- */
  if (PRESENTER) buildPresenter();
  initLinks();
  sRender();
  tRender();
  fit();
  const start = fromHash();
  idx = start ?? 0;
  step = (start !== null || STATIC) ? builds[idx].length : 0;
  render();
  hook(idx, 'enter');
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);
})();
