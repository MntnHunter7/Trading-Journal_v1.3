/* ═══════════════════════════════════════════════════════════════
   APEX // TRADING JOURNAL — APPLICATION LOGIC
   Vanilla JS · localStorage · JSON I/O · 3 Tabs · Calendar
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const STORAGE_KEY  = 'apex_tj_trades_v1';
  const ACTIVE_TAB_K = 'apex_tj_tab_v1';

  const IMG_MAX_DIM      = 1400;
  const IMG_JPEG_QUALITY = 0.80;
  const IMG_MAX_BYTES    = 15 * 1024 * 1024;

  const MONTHS = [
    'JANUAR', 'FEBRUAR', 'MÄRZ', 'APRIL', 'MAI', 'JUNI',
    'JULI', 'AUGUST', 'SEPTEMBER', 'OKTOBER', 'NOVEMBER', 'DEZEMBER'
  ];

  const TABS = ['dashboard', 'history', 'calendar'];
  const PANEL_OF = {
    dashboard: 'tabDashboard',
    history:   'tabHistory',
    calendar:  'tabCalendar'
  };

  /* ═══════════ UTILS ═══════════ */
  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  const num = (v) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  };

  const uid = () =>
    Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  const pad2 = (n) => String(n).padStart(2, '0');

  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));

  const fmtMoney = (v) => {
    if (!Number.isFinite(v)) return '$0.00';
    const s = v < 0 ? '-' : '';
    return s + '$' + Math.abs(v).toFixed(2);
  };

  const fmtPct = (v) => {
    if (!Number.isFinite(v)) return '0.00%';
    return (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
  };

  const fmtR = (v) => {
    if (!Number.isFinite(v)) return '0.00R';
    return (v >= 0 ? '+' : '') + v.toFixed(2) + 'R';
  };

  const fmtBytes = (b) => {
    if (!b) return '0 B';
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
    return (b / (1024 * 1024)).toFixed(2) + ' MB';
  };

  const fmtDT = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${String(d.getFullYear()).slice(-2)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  };

  const toLocalInput = (d = new Date()) =>
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

  const dayKey = (input) => {
    const d = input instanceof Date ? input : new Date(input);
    if (isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  };

  /* ═══════════ IMAGE PIPELINE ═══════════ */
  function fileToDataURL(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = () => rej(new Error('read failed'));
      r.readAsDataURL(file);
    });
  }

  function loadImg(src) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => rej(new Error('load failed'));
      img.src = src;
    });
  }

  async function compressImage(file) {
    if (!file.type.startsWith('image/')) throw new Error('Not an image');

    const raw = await fileToDataURL(file);
    const img = await loadImg(raw);

    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    const scale = Math.min(1, IMG_MAX_DIM / Math.max(w, h));
    const tw = Math.max(1, Math.round(w * scale));
    const th = Math.max(1, Math.round(h * scale));

    const canvas = document.createElement('canvas');
    canvas.width = tw;
    canvas.height = th;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, tw, th);
    ctx.drawImage(img, 0, 0, tw, th);

    const dataUrl = canvas.toDataURL('image/jpeg', IMG_JPEG_QUALITY);
    return {
      dataUrl,
      originalSize: file.size,
      compressedSize: Math.round((dataUrl.length * 3) / 4)
    };
  }

  /* ═══════════ STATE ═══════════ */
  const state = {
    trades: [],
    filters: { ticker: '', type: '', setup: '' },
    editingId: null,
    activeTab: 'dashboard',
    pendingImage: null,
    calCursor: (() => {
      const n = new Date();
      return new Date(n.getFullYear(), n.getMonth(), 1);
    })()
  };

  /* ═══════════ STORAGE ═══════════ */
  function loadTrades() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      state.trades = Array.isArray(arr)
        ? arr.map(normalizeTrade).filter(Boolean)
        : [];
    } catch (e) {
      console.warn('load failed', e);
      state.trades = [];
    }
  }

  function persistTrades() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.trades));
      return true;
    } catch (e) {
      if (e && e.name === 'QuotaExceededError') {
        toast('SPEICHER VOLL — BILD/TRADES ENTFERNEN', 'err');
      } else {
        toast('SPEICHERN FEHLGESCHLAGEN', 'err');
      }
      return false;
    }
  }

  function loadActiveTab() {
    try {
      const t = localStorage.getItem(ACTIVE_TAB_K);
      if (TABS.includes(t)) state.activeTab = t;
    } catch (e) { /* noop */ }
  }

  function saveActiveTab() {
    try { localStorage.setItem(ACTIVE_TAB_K, state.activeTab); } catch (e) { /* noop */ }
  }

  /* ═══════════ NORMALIZE ═══════════ */
  function normalizeType(v) {
    const s = String(v ?? '').toLowerCase();
    return s === 'short' ? 'short' : 'long';
  }

  function normalizeTrade(t) {
    if (!t || typeof t !== 'object') return null;

    const dtRaw = t.datetime || t.date || t.timestamp || '';
    const dt = dtRaw ? String(dtRaw) : toLocalInput();

    const img = typeof t.image === 'string' && t.image.startsWith('data:image/')
      ? t.image
      : null;

    return {
      id: typeof t.id === 'string' && t.id ? t.id : uid(),
      datetime: dt,
      ticker: String(t.ticker || t.symbol || '').toUpperCase(),
      type: normalizeType(t.type),
      setup: String(t.setup || t.strategy || ''),
      entry: num(t.entry),
      exit: num(t.exit),
      position: num(t.position ?? t.positionSize ?? t.size),
      stopLoss: num(t.stopLoss ?? t.stop),
      notes: String(t.notes || ''),
      image: img,
      createdAt: t.createdAt || new Date().toISOString(),
      updatedAt: t.updatedAt || null
    };
  }

  /* ═══════════ COMPUTE ═══════════ */
  function computeTrade(t) {
    const entry = num(t.entry);
    const exit  = num(t.exit);
    const size  = num(t.position);
    const stop  = num(t.stopLoss);
    const dir   = t.type === 'short' ? -1 : 1;

    const perUnit = (exit - entry) * dir;
    const pnl     = perUnit * size;
    const pnlPct  = entry !== 0 ? (perUnit / entry) * 100 : 0;

    const risk = Math.abs(entry - stop);
    const crv  = (stop && risk > 0) ? perUnit / risk : 0;

    let status = 'BE';
    if (pnl > 0.0001) status = 'WIN';
    else if (pnl < -0.0001) status = 'LOSS';

    return { pnl, pnlPct, crv, status, dir };
  }

  function computeKPIs(list) {
    const n = list.length;
    const ms = list.map(computeTrade);

    const totalPnl = ms.reduce((s, m) => s + m.pnl, 0);
    const wins   = ms.filter(m => m.status === 'WIN');
    const losses = ms.filter(m => m.status === 'LOSS');

    const winRate = n ? (wins.length / n) * 100 : 0;

    const grossG = wins.reduce((s, m) => s + m.pnl, 0);
    const grossL = Math.abs(losses.reduce((s, m) => s + m.pnl, 0));

    let pf = 0;
    if (grossL > 0) pf = grossG / grossL;
    else if (grossG > 0) pf = Infinity;

    const avgWin  = wins.length   ? grossG / wins.length   : 0;
    const avgLoss = losses.length ? -grossL / losses.length : 0;

    const sorted = [...list].sort(
      (a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime()
    );
    let eq = 0, peak = 0, dd = 0;
    for (const t of sorted) {
      eq += computeTrade(t).pnl;
      if (eq > peak) peak = eq;
      const d = peak - eq;
      if (d > dd) dd = d;
    }

    return {
      totalPnl, winRate, pf, maxDD: dd, avgWin, avgLoss,
      count: n, wins: wins.length, losses: losses.length
    };
  }

  /* ═══════════ RENDER — KPIs ═══════════ */
  function renderKPIs() {
    const k = computeKPIs(state.trades);

    const heroEl = $('#kpiTotalPnl');
    heroEl.textContent = fmtMoney(k.totalPnl);
    heroEl.classList.remove('is-neg', 'is-zero');
    if (k.totalPnl > 0) { /* emerald default */ }
    else if (k.totalPnl < 0) heroEl.classList.add('is-neg');
    else heroEl.classList.add('is-zero');

    $('#kpiTotalPnlSub').textContent = k.count
      ? `${k.count} TRADES · ${k.wins}W · ${k.losses}L`
      : 'KEINE DATEN';

    const wr = $('#kpiWinRate');
    wr.textContent = k.count ? k.winRate.toFixed(1) + '%' : '—';
    wr.classList.remove('c-em', 'c-ros', 'c-amb');
    if (k.count) {
      if (k.winRate >= 55) wr.classList.add('c-em');
      else if (k.winRate < 40) wr.classList.add('c-ros');
    }

    $('#kpiWinRateSub').textContent = `${k.wins} / ${k.losses}`;

    const pfEl = $('#kpiProfitFactor');
    if (!k.count) pfEl.textContent = '—';
    else if (k.pf === Infinity) pfEl.textContent = '∞';
    else pfEl.textContent = k.pf.toFixed(2);
    pfEl.classList.remove('c-em', 'c-ros', 'c-amb');
    if (k.count) {
      if (k.pf >= 1.5) pfEl.classList.add('c-em');
      else if (k.pf >= 1) pfEl.classList.add('c-amb');
      else pfEl.classList.add('c-ros');
    }

    const ddEl = $('#kpiMaxDD');
    ddEl.textContent = k.count && k.maxDD > 0
      ? '-$' + k.maxDD.toFixed(2)
      : (k.count ? '$0.00' : '—');
    ddEl.classList.remove('c-ros');
    if (k.maxDD > 0) ddEl.classList.add('c-ros');

    const aw = $('#kpiAvgWin');
    const al = $('#kpiAvgLoss');
    aw.textContent = k.wins ? fmtMoney(k.avgWin) : '—';
    al.textContent = k.losses ? fmtMoney(k.avgLoss) : '—';
    aw.classList.remove('c-em'); aw.classList.add('c-em');
    al.classList.remove('c-ros'); al.classList.add('c-ros');
  }

  /* ═══════════ RENDER — SETUP FILTER ═══════════ */
  function renderSetupFilter() {
    const setups = Array.from(
      new Set(state.trades.map(t => (t.setup || '').trim()).filter(Boolean))
    ).sort((a, b) => a.localeCompare(b));

    const sel = $('#filterSetup');
    const cur = state.filters.setup;

    sel.innerHTML = '<option value="">ALLE SETUPS</option>' +
      setups.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('');

    if (setups.includes(cur)) sel.value = cur;
    else { sel.value = ''; state.filters.setup = ''; }
  }

  /* ═══════════ RENDER — TABLE ═══════════ */
  function filteredTrades() {
    const f = state.filters;
    return state.trades
      .filter(t => {
        if (f.ticker && !(t.ticker || '').toLowerCase().includes(f.ticker.toLowerCase())) return false;
        if (f.type && t.type !== f.type) return false;
        if (f.setup && (t.setup || '') !== f.setup) return false;
        return true;
      })
      .sort((a, b) => new Date(b.datetime).getTime() - new Date(a.datetime).getTime());
  }

  function renderTable() {
    const tb = $('#tradesBody');
    if (!tb) return;

    const list = filteredTrades();
    const total = state.trades.length;

    $('#tableCount').textContent = total === 0
      ? '0 RECORDS'
      : `${list.length} / ${total} RECORDS`;

    if (!list.length) {
      tb.innerHTML = `<tr><td colspan="14" class="ta-c cell-dim" style="padding:36px 12px;letter-spacing:.18em;font-size:11px;">KEINE TRADES</td></tr>`;
      return;
    }

    tb.innerHTML = list.map(t => {
      const m = computeTrade(t);
      const pnlCls = m.pnl > 0 ? 'c-em' : m.pnl < 0 ? 'c-ros' : 'cell-dim';

      const sideTag  = t.type === 'short' ? 'tag tag-short' : 'tag tag-long';
      const sideLbl  = t.type === 'short' ? 'SHORT' : 'LONG';

      const statusTag = m.status === 'WIN' ? 'tag tag-win'
                      : m.status === 'LOSS' ? 'tag tag-loss'
                      : 'tag tag-be';

      const hasImg = typeof t.image === 'string' && t.image.startsWith('data:image/');
      const thumb = hasImg
        ? `<button type="button" class="thumb" data-action="show-image" title="Chart öffnen"><img src="${t.image}" alt="chart" loading="lazy"></button>`
        : `<span class="thumb-empty">—</span>`;

      const stopCell = t.stopLoss ? num(t.stopLoss).toFixed(4) : '—';
      const rCell    = t.stopLoss ? fmtR(m.crv) : '—';

      return `<tr data-id="${esc(t.id)}">
        <td class="cell-dim">${esc(fmtDT(t.datetime))}</td>
        <td><strong>${esc(t.ticker)}</strong></td>
        <td><span class="${sideTag}">${sideLbl}</span></td>
        <td class="cell-dim">${esc(t.setup || '—')}</td>
        <td class="ta-r">${num(t.entry).toFixed(4)}</td>
        <td class="ta-r">${num(t.exit).toFixed(4)}</td>
        <td class="ta-r">${num(t.position)}</td>
        <td class="ta-r cell-dim">${stopCell}</td>
        <td class="ta-r ${pnlCls}" style="font-weight:700">${fmtMoney(m.pnl)}</td>
        <td class="ta-r ${pnlCls}">${fmtPct(m.pnlPct)}</td>
        <td class="ta-r ${pnlCls}">${rCell}</td>
        <td class="ta-c"><span class="${statusTag}">${m.status}</span></td>
        <td class="ta-c">${thumb}</td>
        <td class="ta-c">
          <button type="button" class="row-act" data-action="edit" title="Bearbeiten">✎</button>
          <button type="button" class="row-act row-act-danger" data-action="delete" title="Löschen">×</button>
        </td>
      </tr>`;
    }).join('');
  }

  /* ═══════════ RENDER — CALENDAR ═══════════ */
  function monthTrades(y, mIdx) {
    return state.trades.filter(t => {
      const d = new Date(t.datetime);
      if (isNaN(d.getTime())) return false;
      return d.getFullYear() === y && d.getMonth() === mIdx;
    });
  }

  function buildDayMap(list) {
    const map = new Map();
    for (const t of list) {
      const k = dayKey(t.datetime);
      if (!k) continue;
      const { pnl } = computeTrade(t);
      const prev = map.get(k) || { pnl: 0, count: 0 };
      map.set(k, { pnl: prev.pnl + pnl, count: prev.count + 1 });
    }
    return map;
  }

  function renderCalendar() {
    const grid = $('#calGrid');
    if (!grid) return;

    const cur = state.calCursor;
    const y = cur.getFullYear();
    const m = cur.getMonth();

    $('#calTitle').textContent = `${MONTHS[m]} · ${y}`;

    const first = new Date(y, m, 1);
    const jsDow = first.getDay();
    const offset = (jsDow + 6) % 7;

    const days = new Date(y, m + 1, 0).getDate();
    const mTrades = monthTrades(y, m);
    const dayMap = buildDayMap(mTrades);
    const todayK = dayKey(new Date());

    let html = '';
    for (let i = 0; i < offset; i++) {
      html += `<div class="cal-cell is-empty"></div>`;
    }

    for (let d = 1; d <= days; d++) {
      const k = `${y}-${pad2(m + 1)}-${pad2(d)}`;
      const entry = dayMap.get(k);
      const isToday = k === todayK;

      let cls = 'cal-cell';
      let pnlText = '—';
      let cntText = '';

      if (entry) {
        if (entry.pnl > 0.0001) cls += ' is-win';
        else if (entry.pnl < -0.0001) cls += ' is-loss';
        pnlText = fmtMoney(entry.pnl);
        cntText = `${entry.count}×`;
      }
      if (isToday) cls += ' is-today';

      html += `<div class="${cls}">
        <div class="cal-day-n">${d}</div>
        <div>
          <div class="cal-day-pnl">${esc(pnlText)}</div>
          ${cntText ? `<div class="cal-day-cnt">${cntText}</div>` : ''}
        </div>
      </div>`;
    }

    const totalCells = offset + days;
    const rem = totalCells % 7;
    if (rem !== 0) {
      for (let i = 0; i < 7 - rem; i++) html += `<div class="cal-cell is-empty"></div>`;
    }

    grid.innerHTML = html;

    const mPnl = mTrades.reduce((s, t) => s + computeTrade(t).pnl, 0);
    const winDays  = Array.from(dayMap.values()).filter(v => v.pnl > 0.0001).length;
    const lossDays = Array.from(dayMap.values()).filter(v => v.pnl < -0.0001).length;

    const mpEl = $('#calMonthPnl');
    mpEl.textContent = fmtMoney(mPnl);
    mpEl.classList.remove('cs-em', 'cs-ros');
    if (mPnl > 0) mpEl.classList.add('cs-em');
    else if (mPnl < 0) mpEl.classList.add('cs-ros');

    $('#calWinDays').textContent = String(winDays);
    $('#calLossDays').textContent = String(lossDays);
    $('#calTradeCount').textContent = String(mTrades.length);
  }

  function calShift(delta) {
    const c = state.calCursor;
    state.calCursor = new Date(c.getFullYear(), c.getMonth() + delta, 1);
    renderCalendar();
  }

  function calToday() {
    const n = new Date();
    state.calCursor = new Date(n.getFullYear(), n.getMonth(), 1);
    renderCalendar();
  }

  /* ═══════════ TABS ═══════════ */
  function switchTab(name) {
    if (!TABS.includes(name)) return;
    state.activeTab = name;
    saveActiveTab();

    $$('.tab').forEach(b => {
      const on = b.getAttribute('data-tab') === name;
      b.classList.toggle('tab-on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });

    TABS.forEach(t => {
      const p = document.getElementById(PANEL_OF[t]);
      if (!p) return;
      if (t === name) p.removeAttribute('hidden');
      else p.setAttribute('hidden', '');
    });

    if (name === 'history') renderTable();
    if (name === 'calendar') renderCalendar();
  }

  function onTabClick(e) {
    const b = e.target.closest('.tab');
    if (!b) return;
    switchTab(b.getAttribute('data-tab'));
  }

  function onTabKey(e) {
    const b = e.target.closest('.tab');
    if (!b) return;
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    const btns = $$('.tab');
    const i = btns.indexOf(b);
    let next = i;
    if (e.key === 'ArrowLeft') next = (i - 1 + btns.length) % btns.length;
    else if (e.key === 'ArrowRight') next = (i + 1) % btns.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = btns.length - 1;
    btns[next].focus();
    switchTab(btns[next].getAttribute('data-tab'));
  }

  /* ═══════════ FORM ═══════════ */
  function readForm() {
    return {
      datetime: $('#fDateTime').value,
      ticker: $('#fTicker').value.trim().toUpperCase(),
      type: $('#fType').value,
      setup: $('#fSetup').value.trim(),
      entry: num($('#fEntry').value),
      exit: num($('#fExit').value),
      position: num($('#fPosition').value),
      stopLoss: num($('#fStop').value),
      notes: $('#fNotes').value.trim()
    };
  }

  function updatePreview() {
    const el = $('#preview');
    if (!el) return;

    const e = $('#fEntry').value;
    const x = $('#fExit').value;
    const p = $('#fPosition').value;

    if (!e || !x || !p) {
      el.innerHTML = `<span class="pv-key">VORSCHAU</span><span class="pv-sep">│</span><span class="pv-empty">WARTE AUF INPUT…</span>`;
      return;
    }

    const d = readForm();
    const m = computeTrade(d);
    const cls = m.pnl > 0 ? 'c-em' : m.pnl < 0 ? 'c-ros' : 'cell-dim';

    const rPart = d.stopLoss
      ? `<span class="pv-sep">│</span><span class="${cls}">R ${fmtR(m.crv)}</span>`
      : '';

    const statusTag = m.status === 'WIN'  ? 'tag tag-win'
                    : m.status === 'LOSS' ? 'tag tag-loss'
                    : 'tag tag-be';

    el.innerHTML = `
      <span class="pv-key">VORSCHAU</span>
      <span class="pv-sep">│</span>
      <span class="${cls}" style="font-weight:700;font-size:14px;">${fmtMoney(m.pnl)}</span>
      <span class="${cls}">(${fmtPct(m.pnlPct)})</span>
      ${rPart}
      <span class="pv-sep">│</span>
      <span class="${statusTag}">${m.status}</span>
    `;
  }

  function onSubmit(e) {
    e.preventDefault();
    const d = readForm();

    if (!d.datetime) return toast('ZEITSTEMPEL FEHLT', 'err');
    if (!d.ticker)   return toast('TICKER FEHLT', 'err');
    if (!d.entry)    return toast('ENTRY FEHLT', 'err');
    if (!d.exit)     return toast('EXIT FEHLT', 'err');
    if (!d.position) return toast('POSITIONSGRÖSSE FEHLT', 'err');

    const img = state.pendingImage ? state.pendingImage.dataUrl : null;

    if (state.editingId) {
      const i = state.trades.findIndex(t => t.id === state.editingId);
      if (i >= 0) {
        state.trades[i] = {
          ...state.trades[i],
          ...d,
          image: img,
          updatedAt: new Date().toISOString()
        };
        if (!persistTrades()) return;
        toast('TRADE AKTUALISIERT', 'ok');
      }
      state.editingId = null;
      updateFormMode();
    } else {
      const t = {
        id: uid(),
        ...d,
        image: img,
        createdAt: new Date().toISOString(),
        updatedAt: null
      };
      state.trades.push(t);
      if (!persistTrades()) { state.trades.pop(); return; }
      toast('TRADE GESPEICHERT', 'ok');
    }

    resetForm();
    renderAll();
  }

  function updateFormMode() {
    const title  = $('.card-title');
    const submit = $('#submitBtn');
    const cancel = $('#cancelEditBtn');
    if (state.editingId) {
      if (title) title.textContent = 'TRADE BEARBEITEN';
      submit.textContent = 'Änderungen speichern';
      cancel.removeAttribute('hidden');
    } else {
      if (title) title.textContent = 'NEUEN TRADE ERFASSEN';
      submit.textContent = 'Trade speichern';
      cancel.setAttribute('hidden', '');
    }
  }

  function resetForm() {
    $('#tradeForm').reset();
    $('#fDateTime').value = toLocalInput();
    state.editingId = null;
    state.pendingImage = null;
    updateFormMode();
    renderUploadUI();
    updatePreview();
  }

  /* ═══════════ UPLOAD UI ═══════════ */
  async function handleImageSelect(file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) return toast('NUR BILDER ERLAUBT', 'err');
    if (file.size > IMG_MAX_BYTES) return toast('DATEI > 15 MB', 'err');

    try {
      toast('BILD WIRD VERARBEITET…', 'ok');
      const r = await compressImage(file);
      state.pendingImage = {
        dataUrl: r.dataUrl,
        originalSize: r.originalSize,
        compressedSize: r.compressedSize
      };
      renderUploadUI();
      toast('BILD HINZUGEFÜGT', 'ok');
    } catch (err) {
      console.warn(err);
      toast('BILD KONNTE NICHT VERARBEITET WERDEN', 'err');
    }
  }

  function renderUploadUI() {
    const zone  = $('#uploadZone');
    const idle  = $('#uploadIdle');
    const thumb = $('#uploadThumb');
    const rm    = $('#removeImageBtn');
    const meta  = $('#uploadMeta');
    if (!zone) return;

    if (state.pendingImage && state.pendingImage.dataUrl) {
      thumb.src = state.pendingImage.dataUrl;
      thumb.removeAttribute('hidden');
      idle.setAttribute('hidden', '');
      rm.removeAttribute('hidden');

      const o = state.pendingImage.originalSize || 0;
      const c = state.pendingImage.compressedSize || 0;
      if (c) {
        meta.textContent = `${fmtBytes(o)} → ${fmtBytes(c)}`;
        meta.removeAttribute('hidden');
      } else {
        meta.setAttribute('hidden', '');
        meta.textContent = '';
      }

      zone.classList.add('has-img');
    } else {
      thumb.removeAttribute('src');
      thumb.setAttribute('hidden', '');
      idle.removeAttribute('hidden');
      rm.setAttribute('hidden', '');
      meta.setAttribute('hidden', '');
      meta.textContent = '';
      zone.classList.remove('has-img');
    }
  }

  function clearImage() {
    state.pendingImage = null;
    const fi = $('#fImage');
    if (fi) fi.value = '';
    renderUploadUI();
  }

  /* ═══════════ ROW ACTIONS ═══════════ */
  function onTableClick(e) {
    const b = e.target.closest('button[data-action]');
    if (!b) return;
    const row = b.closest('tr');
    if (!row) return;
    const id = row.getAttribute('data-id');
    if (!id) return;

    const act = b.getAttribute('data-action');
    if (act === 'edit') startEdit(id);
    else if (act === 'delete') deleteTrade(id);
    else if (act === 'show-image') {
      const t = state.trades.find(x => x.id === id);
      if (t) showModal(t);
    }
  }

  function startEdit(id) {
    const t = state.trades.find(x => x.id === id);
    if (!t) return;

    state.editingId = id;

    $('#fDateTime').value = t.datetime || toLocalInput();
    $('#fTicker').value   = t.ticker || '';
    $('#fType').value     = t.type || 'long';
    $('#fSetup').value    = t.setup || '';
    $('#fEntry').value    = t.entry ?? '';
    $('#fExit').value     = t.exit ?? '';
    $('#fPosition').value = t.position ?? '';
    $('#fStop').value     = t.stopLoss ?? '';
    $('#fNotes').value    = t.notes || '';

    if (typeof t.image === 'string' && t.image.startsWith('data:image/')) {
      state.pendingImage = {
        dataUrl: t.image,
        originalSize: 0,
        compressedSize: Math.round((t.image.length * 3) / 4)
      };
    } else {
      state.pendingImage = null;
    }
    const fi = $('#fImage');
    if (fi) fi.value = '';

    renderUploadUI();
    updateFormMode();
    updatePreview();
    switchTab('dashboard');

    setTimeout(() => {
      const f = $('#tradeForm');
      if (f) f.scrollIntoView({ behavior: 'smooth', block: 'start' });
      $('#fTicker').focus();
    }, 60);
  }

  function deleteTrade(id) {
    const t = state.trades.find(x => x.id === id);
    if (!t) return;
    if (!window.confirm(`TRADE "${t.ticker}" LÖSCHEN?`)) return;

    state.trades = state.trades.filter(x => x.id !== id);
    if (state.editingId === id) { state.editingId = null; resetForm(); }

    persistTrades();
    renderAll();
    toast('TRADE GELÖSCHT', 'ok');
  }

  /* ═══════════ MODAL ═══════════ */
  function showModal(t) {
    if (!t || !t.image || !t.image.startsWith('data:image/')) return;

    const modal = $('#imageModal');
    $('#modalImage').src = t.image;
    $('#modalTitle').textContent = `${t.ticker || 'CHART'}`;
    $('#modalSub').textContent = `${fmtDT(t.datetime)} · ${t.type.toUpperCase()}${t.setup ? ' · ' + t.setup.toUpperCase() : ''}`;

    modal.removeAttribute('hidden');
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
  }

  function closeModal() {
    const modal = $('#imageModal');
    if (!modal) return;
    modal.classList.remove('is-open');
    modal.setAttribute('hidden', '');
    modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('modal-open');
    setTimeout(() => { const img = $('#modalImage'); if (img) img.removeAttribute('src'); }, 180);
  }

  /* ═══════════ FILTERS ═══════════ */
  function onFilter() {
    state.filters.ticker = $('#filterTicker').value.trim();
    state.filters.type   = $('#filterType').value;
    state.filters.setup  = $('#filterSetup').value;
    renderTable();
  }

  function clearFilters() {
    $('#filterTicker').value = '';
    $('#filterType').value   = '';
    $('#filterSetup').value  = '';
    state.filters = { ticker: '', type: '', setup: '' };
    renderTable();
  }

  /* ═══════════ IMPORT / EXPORT ═══════════ */
  function exportJSON() {
    if (!state.trades.length) return toast('KEINE TRADES ZUM EXPORT', 'err');

    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      count: state.trades.length,
      trades: state.trades
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `apex-journal-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toast(`${state.trades.length} TRADES EXPORTIERT`, 'ok');
  }

  function importJSON(file) {
    if (!file) return;
    const r = new FileReader();

    r.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target.result);
        let raw = [];
        if (Array.isArray(parsed)) raw = parsed;
        else if (parsed && Array.isArray(parsed.trades)) raw = parsed.trades;
        else throw new Error('Ungültiges Format.');

        const cleaned = raw.map(normalizeTrade).filter(t => t && t.ticker && (t.entry || t.exit));
        if (!cleaned.length) return toast('KEINE GÜLTIGEN TRADES', 'err');

        let replace = true;
        if (state.trades.length) {
          replace = window.confirm(
            `AKTUELL: ${state.trades.length} · IMPORT: ${cleaned.length}\n\n` +
            `OK = ERSETZEN\nABBRECHEN = ZUSAMMENFÜHREN`
          );
        }

        const prev = state.trades;
        if (replace) state.trades = cleaned;
        else {
          const m = new Map(state.trades.map(t => [t.id, t]));
          for (const t of cleaned) m.set(t.id, t);
          state.trades = Array.from(m.values());
        }

        if (!persistTrades()) { state.trades = prev; return; }

        state.editingId = null;
        state.pendingImage = null;
        resetForm();
        renderAll();
        toast(`${cleaned.length} TRADES IMPORTIERT`, 'ok');
      } catch (err) {
        console.warn(err);
        toast('IMPORT FEHLGESCHLAGEN', 'err');
      }
    };

    r.onerror = () => toast('DATEI NICHT LESBAR', 'err');
    r.readAsText(file);
  }

  /* ═══════════ TOAST ═══════════ */
  let toastT = null;
  function toast(msg, kind) {
    const el = $('#toast');
    if (!el) return;
    el.textContent = msg;
    let cls = 'toast mono is-show';
    if (kind === 'err') cls += ' is-err';
    else if (kind === 'ok') cls += ' is-ok';
    el.className = cls;
    clearTimeout(toastT);
    toastT = setTimeout(() => { el.className = 'toast mono'; }, 2600);
  }

  /* ═══════════ RENDER ALL ═══════════ */
  function renderAll() {
    renderKPIs();
    renderSetupFilter();
    renderTable();
    renderCalendar();
  }

  /* ═══════════ INIT ═══════════ */
  function init() {
    loadTrades();
    loadActiveTab();

    // Form
    const form = $('#tradeForm');
    form.addEventListener('submit', onSubmit);
    form.addEventListener('input', updatePreview);
    form.addEventListener('change', updatePreview);

    $('#resetFormBtn').addEventListener('click', resetForm);
    $('#cancelEditBtn').addEventListener('click', resetForm);

    // Tabs
    const strip = $('.tabs-strip');
    if (strip) {
      strip.addEventListener('click', onTabClick);
      strip.addEventListener('keydown', onTabKey);
    }

    // Table
    $('#tradesBody').addEventListener('click', onTableClick);

    // Filters
    $('#filterTicker').addEventListener('input', onFilter);
    $('#filterType').addEventListener('change', onFilter);
    $('#filterSetup').addEventListener('change', onFilter);
    $('#clearFilters').addEventListener('click', clearFilters);

    // Import/Export
    $('#exportBtn').addEventListener('click', exportJSON);
    $('#importInput').addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      if (f) importJSON(f);
      e.target.value = '';
    });

    // Upload
    const zone = $('#uploadZone');
    const fi   = $('#fImage');

    zone.addEventListener('click', (e) => {
      if (e.target.closest('#removeImageBtn')) return;
      if (zone.classList.contains('has-img')) return;
      fi.click();
    });

    fi.addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      if (f) handleImageSelect(f);
      e.target.value = '';
    });

    ['dragenter', 'dragover'].forEach(ev =>
      zone.addEventListener(ev, (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!zone.classList.contains('has-img')) zone.classList.add('is-drag');
      })
    );

    ['dragleave', 'drop'].forEach(ev =>
      zone.addEventListener(ev, (e) => {
        e.preventDefault();
        e.stopPropagation();
        zone.classList.remove('is-drag');
      })
    );

    zone.addEventListener('drop', (e) => {
      const dt = e.dataTransfer;
      if (dt && dt.files && dt.files.length) handleImageSelect(dt.files[0]);
    });

    $('#removeImageBtn').addEventListener('click', (e) => {
      e.stopPropagation();
      clearImage();
    });

    // Calendar
    $('#calPrevBtn').addEventListener('click', () => calShift(-1));
    $('#calNextBtn').addEventListener('click', () => calShift(1));
    $('#calTodayBtn').addEventListener('click', calToday);

    // Modal
    $('#modalCloseBtn').addEventListener('click', closeModal);
    $('#imageModal').addEventListener('click', (e) => {
      if (e.target.closest('[data-close]') || e.target.id === 'imageModal') closeModal();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeModal();
    });

    // Defaults
    $('#fDateTime').value = toLocalInput();

    updateFormMode();
    renderUploadUI();
    renderAll();
    updatePreview();
    switchTab(state.activeTab || 'dashboard');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
