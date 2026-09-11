/* ============================================================
   Trading Journal – Anwendungslogik
   Vanilla JS · localStorage · JSON Import/Export · Tab-Switching
   Bild-Upload via FileReader + Canvas-Kompression
   ============================================================ */

(function () {
  'use strict';

  const STORAGE_KEY = 'trading_journal_trades_v1';
  const ACTIVE_TAB_KEY = 'trading_journal_active_tab_v1';

  // Bild-Kompression
  const IMG_MAX_DIM = 1400;        // längste Kante in px
  const IMG_JPEG_QUALITY = 0.75;   // 0..1

  /* =========================================================
     Utilities
     ========================================================= */
  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const num = (v) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  };

  const uid = () =>
    Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  const escapeHtml = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[c]));

  const safeUrl = (u) => {
    if (!u) return '';
    try {
      const url = new URL(u, window.location.href);
      if (url.protocol === 'http:' || url.protocol === 'https:') return url.href;
    } catch (err) { /* ignore */ }
    return '';
  };

  const fmtMoney = (v) => {
    if (!Number.isFinite(v)) return '$0.00';
    return (v < 0 ? '-$' : '$') + Math.abs(v).toFixed(2);
  };

  const fmtPct = (v) => {
    if (!Number.isFinite(v)) return '0.00%';
    return (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
  };

  const fmtR = (v) => {
    if (!Number.isFinite(v)) return '0.00R';
    return (v >= 0 ? '+' : '') + v.toFixed(2) + 'R';
  };

  const fmtBytes = (bytes) => {
    if (!bytes) return '0 B';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  };

  const fmtDateTime = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString('de-DE', {
      year: '2-digit',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const toLocalDatetimeInput = (d = new Date()) => {
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  /* =========================================================
     Bild-Handling: File → Base64 (komprimiert)
     ========================================================= */
  function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Datei konnte nicht gelesen werden.'));
      reader.readAsDataURL(file);
    });
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Bild konnte nicht geladen werden.'));
      img.src = src;
    });
  }

  async function compressImage(file, maxDim = IMG_MAX_DIM, quality = IMG_JPEG_QUALITY) {
    if (!file.type.startsWith('image/')) {
      throw new Error('Datei ist kein Bild.');
    }

    const originalDataUrl = await readFileAsDataURL(file);
    const img = await loadImage(originalDataUrl);

    let { width, height } = img;
    const scale = Math.min(1, maxDim / Math.max(width, height));
    const targetW = Math.max(1, Math.round(width * scale));
    const targetH = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');

    // Weißer Hintergrund, damit transparente PNGs beim JPEG nicht schwarz werden
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, targetW, targetH);
    ctx.drawImage(img, 0, 0, targetW, targetH);

    const compressed = canvas.toDataURL('image/jpeg', quality);

    return {
      dataUrl: compressed,
      originalSize: file.size,
      compressedSize: Math.round((compressed.length * 3) / 4) // grobe Schätzung
    };
  }

  /* =========================================================
     State
     ========================================================= */
  const state = {
    trades: [],
    filters: { ticker: '', type: '', setup: '' },
    editingId: null,
    activeTab: 'dashboard',
    pendingImage: null // { dataUrl, meta }
  };

  /* =========================================================
     Storage
     ========================================================= */
  function loadTrades() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      state.trades = Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      console.warn('Konnte Trades nicht laden:', err);
      state.trades = [];
    }
  }

  function saveTrades() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.trades));
      return true;
    } catch (err) {
      console.warn('Konnte Trades nicht speichern:', err);
      if (err && err.name === 'QuotaExceededError') {
        toast('Speicher voll! Bitte alte Trades oder Bilder löschen.', 'error');
      } else {
        toast('Speichern fehlgeschlagen', 'error');
      }
      return false;
    }
  }

  function loadActiveTab() {
    try {
      const t = localStorage.getItem(ACTIVE_TAB_KEY);
      if (t === 'dashboard' || t === 'history') state.activeTab = t;
    } catch (err) { /* ignore */ }
  }

  function saveActiveTab() {
    try {
      localStorage.setItem(ACTIVE_TAB_KEY, state.activeTab);
    } catch (err) { /* ignore */ }
  }

  /* =========================================================
     Tab-Switching
     ========================================================= */
  function switchTab(tabName) {
    if (tabName !== 'dashboard' && tabName !== 'history') return;

    state.activeTab = tabName;
    saveActiveTab();

    $$('.tab-btn').forEach((btn) => {
      const isActive = btn.getAttribute('data-tab') === tabName;
      btn.classList.toggle('tab-btn-active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });

    const panelDashboard = $('#tabDashboard');
    const panelHistory = $('#tabHistory');

    if (tabName === 'dashboard') {
      panelDashboard.classList.remove('hidden');
      panelHistory.classList.add('hidden');
    } else {
      panelDashboard.classList.add('hidden');
      panelHistory.classList.remove('hidden');
      renderTable();
    }
  }

  function handleTabClick(e) {
    const btn = e.target.closest('.tab-btn');
    if (!btn) return;
    switchTab(btn.getAttribute('data-tab'));
  }

  function handleTabKeydown(e) {
    const btn = e.target.closest('.tab-btn');
    if (!btn) return;

    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (!keys.includes(e.key)) return;

    e.preventDefault();
    const buttons = $$('.tab-btn');
    const currentIdx = buttons.indexOf(btn);
    let nextIdx = currentIdx;

    if (e.key === 'ArrowLeft') nextIdx = (currentIdx - 1 + buttons.length) % buttons.length;
    else if (e.key === 'ArrowRight') nextIdx = (currentIdx + 1) % buttons.length;
    else if (e.key === 'Home') nextIdx = 0;
    else if (e.key === 'End') nextIdx = buttons.length - 1;

    buttons[nextIdx].focus();
    switchTab(buttons[nextIdx].getAttribute('data-tab'));
  }

  /* =========================================================
     Berechnungen
     ========================================================= */
  function computeTrade(t) {
    const entry = num(t.entry);
    const exit = num(t.exit);
    const size = num(t.position);
    const stop = num(t.stopLoss);
    const dir = t.type === 'short' ? -1 : 1;

    const diffPerUnit = (exit - entry) * dir;
    const pnl = diffPerUnit * size;
    const pnlPct = entry !== 0 ? (diffPerUnit / entry) * 100 : 0;

    const riskPerUnit = Math.abs(entry - stop);
    const rMultiple = (stop && riskPerUnit > 0) ? diffPerUnit / riskPerUnit : 0;

    let status = 'BE';
    if (pnl > 0.0001) status = 'WIN';
    else if (pnl < -0.0001) status = 'LOSS';

    return { pnl, pnlPct, rMultiple, status, dir };
  }

  function computeKPIs(list) {
    const n = list.length;
    const metrics = list.map(computeTrade);

    const totalPnl = metrics.reduce((s, m) => s + m.pnl, 0);

    const wins = metrics.filter((m) => m.status === 'WIN');
    const losses = metrics.filter((m) => m.status === 'LOSS');

    const winRate = n ? (wins.length / n) * 100 : 0;

    const grossProfit = wins.reduce((s, m) => s + m.pnl, 0);
    const grossLoss = Math.abs(losses.reduce((s, m) => s + m.pnl, 0));

    let profitFactor = 0;
    if (grossLoss > 0) profitFactor = grossProfit / grossLoss;
    else if (grossProfit > 0) profitFactor = Infinity;

    const avgWin = wins.length ? grossProfit / wins.length : 0;
    const avgLoss = losses.length ? -grossLoss / losses.length : 0;

    const sorted = [...list].sort(
      (a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime()
    );

    let equity = 0;
    let peak = 0;
    let maxDD = 0;

    for (const t of sorted) {
      equity += computeTrade(t).pnl;
      if (equity > peak) peak = equity;
      const dd = peak - equity;
      if (dd > maxDD) maxDD = dd;
    }

    return {
      totalPnl,
      winRate,
      profitFactor,
      maxDD,
      avgWin,
      avgLoss,
      count: n,
      wins: wins.length,
      losses: losses.length
    };
  }

  /* =========================================================
     Rendering – KPIs
     ========================================================= */
  function renderKPIs() {
    const k = computeKPIs(state.trades);

    const totalPnlEl = $('#kpiTotalPnl');
    totalPnlEl.textContent = fmtMoney(k.totalPnl);
    totalPnlEl.className = 'kpi-value ' +
      (k.totalPnl > 0 ? 'text-emerald-400'
        : k.totalPnl < 0 ? 'text-rose-400'
          : 'text-slate-100');

    $('#kpiTotalPnlSub').textContent = k.count
      ? `${k.wins}W / ${k.losses}L`
      : 'Noch keine Trades';

    $('#kpiWinRate').textContent = k.count ? k.winRate.toFixed(1) + '%' : '–';
    $('#kpiWinRateSub').textContent = `${k.wins}W / ${k.losses}L`;

    const pfEl = $('#kpiProfitFactor');
    if (!k.count) pfEl.textContent = '–';
    else if (k.profitFactor === Infinity) pfEl.textContent = '∞';
    else pfEl.textContent = k.profitFactor.toFixed(2);
    pfEl.className = 'kpi-value ' +
      (!k.count ? ''
        : k.profitFactor >= 1.5 ? 'text-emerald-400'
          : k.profitFactor >= 1 ? 'text-amber-400'
            : 'text-rose-400');

    const ddEl = $('#kpiMaxDD');
    ddEl.textContent = k.count ? fmtMoney(-k.maxDD) : '–';
    ddEl.className = 'kpi-value ' + (k.maxDD > 0 ? 'text-rose-400' : 'text-slate-100');

    $('#kpiAvgWin').textContent = k.wins ? fmtMoney(k.avgWin) : '–';
    $('#kpiAvgLoss').textContent = k.losses ? fmtMoney(k.avgLoss) : '–';
  }

  function renderTabBadges() {
    const count = state.trades.length;
    const b1 = $('#tabBadgeDashboard');
    const b2 = $('#tabBadgeHistory');
    if (b1) b1.textContent = String(count);
    if (b2) b2.textContent = String(count);
  }

  /* =========================================================
     Rendering – Setup-Filter
     ========================================================= */
  function renderSetupFilter() {
    const setups = Array.from(
      new Set(state.trades.map((t) => (t.setup || '').trim()).filter(Boolean))
    ).sort((a, b) => a.localeCompare(b));

    const sel = $('#filterSetup');
    const current = state.filters.setup;

    sel.innerHTML = '<option value="">Alle Setups</option>' +
      setups.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');

    if (setups.includes(current)) sel.value = current;
    else { sel.value = ''; state.filters.setup = ''; }
  }

  /* =========================================================
     Rendering – Tabelle
     ========================================================= */
  function getFilteredTrades() {
    const f = state.filters;

    return state.trades
      .filter((t) => {
        if (f.ticker && !(t.ticker || '').toLowerCase().includes(f.ticker.toLowerCase())) return false;
        if (f.type && t.type !== f.type) return false;
        if (f.setup && (t.setup || '') !== f.setup) return false;
        return true;
      })
      .sort((a, b) => new Date(b.datetime).getTime() - new Date(a.datetime).getTime());
  }

  function renderTable() {
    const tbody = $('#tradesBody');
    const list = getFilteredTrades();

    const countEl = $('#tableCount');
    const total = state.trades.length;
    const shown = list.length;
    countEl.textContent = total === 0
      ? 'Keine Trades vorhanden'
      : `${shown} von ${total} Trade${total === 1 ? '' : 's'} angezeigt`;

    if (!list.length) {
      tbody.innerHTML = `<tr><td colspan="14" class="text-center py-10 text-slate-500">Keine Trades gefunden.</td></tr>`;
      return;
    }

    tbody.innerHTML = list.map((t) => {
      const m = computeTrade(t);
      const pnlClass = m.pnl > 0 ? 'text-emerald-400'
        : m.pnl < 0 ? 'text-rose-400'
          : 'text-slate-300';

      const statusBadge = m.status === 'WIN' ? 'badge badge-win'
        : m.status === 'LOSS' ? 'badge badge-loss'
          : 'badge badge-be';

      const typeBadge = t.type === 'long' ? 'badge badge-long' : 'badge badge-short';
      const typeLabel = t.type === 'long' ? 'LONG' : 'SHORT';

      const chartUrl = safeUrl(t.chartLink);
      const linkIcon = chartUrl
        ? `<a href="${escapeHtml(chartUrl)}" target="_blank" rel="noopener noreferrer" class="link" title="Chart-Link öffnen">🔗</a>`
        : '';

      const hasImage = typeof t.image === 'string' && t.image.startsWith('data:image/');
      const thumbCell = hasImage
        ? `<button type="button" class="thumb-btn" data-action="show-image" title="Bild vergrößern">
             <img src="${t.image}" alt="Chart" loading="lazy" />
           </button>`
        : `<span class="thumb-empty">–</span>`;

      const stopCell = t.stopLoss ? num(t.stopLoss).toFixed(4) : '–';
      const rCell = t.stopLoss ? fmtR(m.rMultiple) : '–';

      return `<tr data-id="${escapeHtml(t.id)}">
        <td class="whitespace-nowrap text-slate-300">${escapeHtml(fmtDateTime(t.datetime))}</td>
        <td class="font-semibold text-slate-100">${escapeHtml(t.ticker || '')}</td>
        <td><span class="${typeBadge}">${typeLabel}</span></td>
        <td class="text-slate-300">${escapeHtml(t.setup || '–')}</td>
        <td class="text-right tabular-nums">${num(t.entry).toFixed(4)}</td>
        <td class="text-right tabular-nums">${num(t.exit).toFixed(4)}</td>
        <td class="text-right tabular-nums">${num(t.position)}</td>
        <td class="text-right tabular-nums text-slate-400">${stopCell}</td>
        <td class="text-right tabular-nums font-semibold ${pnlClass}">${fmtMoney(m.pnl)}</td>
        <td class="text-right tabular-nums ${pnlClass}">${fmtPct(m.pnlPct)}</td>
        <td class="text-right tabular-nums ${pnlClass}">${rCell}</td>
        <td class="text-center"><span class="${statusBadge}">${m.status}</span></td>
        <td class="text-center">${thumbCell}</td>
        <td class="text-center whitespace-nowrap">
          ${linkIcon}
          <button type="button" class="btn-icon" data-action="edit" title="Bearbeiten">✎</button>
          <button type="button" class="btn-icon text-rose-400" data-action="delete" title="Löschen">✕</button>
        </td>
      </tr>`;
    }).join('');
  }

  /* =========================================================
     Formular-Lesen & Live-Preview
     ========================================================= */
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
      notes: $('#fNotes').value.trim(),
      chartLink: ''
    };
  }

  function updatePreview() {
    const preview = $('#preview');

    const entryRaw = $('#fEntry').value;
    const exitRaw = $('#fExit').value;
    const posRaw = $('#fPosition').value;

    if (!entryRaw || !exitRaw || !posRaw) {
      preview.innerHTML = '<span class="text-slate-500">Vorschau: Fülle Entry, Exit und Position aus.</span>';
      return;
    }

    const data = readForm();
    const m = computeTrade(data);

    const cls = m.pnl > 0 ? 'text-emerald-400'
      : m.pnl < 0 ? 'text-rose-400'
        : 'text-slate-300';

    const badge = m.status === 'WIN' ? 'badge badge-win'
      : m.status === 'LOSS' ? 'badge badge-loss'
        : 'badge badge-be';

    const rPart = data.stopLoss
      ? `<span class="${cls} ml-3 tabular-nums">R: ${fmtR(m.rMultiple)}</span>`
      : '';

    preview.innerHTML = `
      <span class="text-slate-500">Vorschau:</span>
      <span class="${cls} font-semibold ml-1 tabular-nums">${fmtMoney(m.pnl)}</span>
      <span class="${cls} ml-1 tabular-nums">(${fmtPct(m.pnlPct)})</span>
      ${rPart}
      <span class="${badge} ml-3">${m.status}</span>
    `;
  }

  /* =========================================================
     Bild-Upload-Steuerung
     ========================================================= */
  async function handleImageSelect(file) {
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast('Nur Bilddateien erlaubt.', 'error');
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      toast('Datei zu groß (max. 15 MB).', 'error');
      return;
    }

    try {
      toast('Bild wird verarbeitet…', 'success');
      const result = await compressImage(file);

      state.pendingImage = {
        dataUrl: result.dataUrl,
        originalSize: result.originalSize,
        compressedSize: result.compressedSize
      };

      renderImagePreview();
      toast('Bild hinzugefügt', 'success');
    } catch (err) {
      console.warn('Bildfehler:', err);
      toast('Bild konnte nicht verarbeitet werden.', 'error');
    }
  }

  function renderImagePreview() {
    const zone = $('#uploadZone');
    const empty = $('#uploadEmpty');
    const previewWrap = $('#uploadPreview');
    const img = $('#uploadPreviewImg');
    const meta = $('#uploadMeta');

    if (state.pendingImage && state.pendingImage.dataUrl) {
      img.src = state.pendingImage.dataUrl;
      const orig = state.pendingImage.originalSize || 0;
      const comp = state.pendingImage.compressedSize || 0;
      meta.textContent = comp
        ? `${fmtBytes(orig)} → ${fmtBytes(comp)}`
        : '';
      empty.classList.add('hidden');
      previewWrap.classList.remove('hidden');
      zone.classList.add('has-image');
    } else {
      img.removeAttribute('src');
      meta.textContent = '';
      empty.classList.remove('hidden');
      previewWrap.classList.add('hidden');
      zone.classList.remove('has-image');
    }
  }

  function removeImage() {
    state.pendingImage = null;
    const fileInput = $('#fImage');
    if (fileInput) fileInput.value = '';
    renderImagePreview();
  }

  /* =========================================================
     Formular-Submit
     ========================================================= */
  function handleSubmit(e) {
    e.preventDefault();

    const data = readForm();

    if (!data.datetime) { toast('Bitte Datum/Uhrzeit angeben.', 'error'); return; }
    if (!data.ticker) { toast('Bitte Ticker angeben.', 'error'); return; }
    if (!data.entry) { toast('Bitte Entry-Preis angeben.', 'error'); return; }
    if (!data.exit) { toast('Bitte Exit-Preis angeben.', 'error'); return; }
    if (!data.position) { toast('Bitte Positionsgröße angeben.', 'error'); return; }

    const imageData = state.pendingImage ? state.pendingImage.dataUrl : null;

    if (state.editingId) {
      const idx = state.trades.findIndex((t) => t.id === state.editingId);
      if (idx >= 0) {
        const prev = state.trades[idx];
        state.trades[idx] = {
          ...prev,
          ...data,
          // Bild nur überschreiben, wenn bewusst gesetzt oder entfernt
          image: imageData,
          updatedAt: new Date().toISOString()
        };
        const ok = saveTrades();
        toast(ok ? 'Trade aktualisiert' : 'Speichern fehlgeschlagen', ok ? 'success' : 'error');
      }
      state.editingId = null;
      updateFormMode();
    } else {
      const trade = {
        id: uid(),
        ...data,
        image: imageData,
        createdAt: new Date().toISOString()
      };
      state.trades.push(trade);
      const ok = saveTrades();
      if (!ok) {
        // Bei Quota-Fehler den Trade wieder entfernen
        state.trades.pop();
        return;
      }
      toast('Trade gespeichert', 'success');
    }

    resetForm();
    renderAll();
  }

  /* =========================================================
     Formular-Modus
     ========================================================= */
  function updateFormMode() {
    const title = $('#formTitle');
    const submitBtn = $('#submitBtn');
    const cancelBtn = $('#cancelEditBtn');

    if (state.editingId) {
      title.textContent = 'Trade bearbeiten';
      submitBtn.textContent = 'Änderungen speichern';
      cancelBtn.classList.remove('hidden');
    } else {
      title.textContent = 'Neuen Trade erfassen';
      submitBtn.textContent = 'Trade speichern';
      cancelBtn.classList.add('hidden');
    }
  }

  function resetForm() {
    const form = $('#tradeForm');
    form.reset();
    $('#fDateTime').value = toLocalDatetimeInput();
    state.editingId = null;
    state.pendingImage = null;
    updateFormMode();
    renderImagePreview();
    updatePreview();
  }

  /* =========================================================
     Bearbeiten / Löschen
     ========================================================= */
  function startEdit(id) {
    const t = state.trades.find((x) => x.id === id);
    if (!t) return;

    state.editingId = id;

    $('#fDateTime').value = t.datetime || toLocalDatetimeInput();
    $('#fTicker').value = t.ticker || '';
    $('#fType').value = t.type || 'long';
    $('#fSetup').value = t.setup || '';
    $('#fEntry').value = t.entry ?? '';
    $('#fExit').value = t.exit ?? '';
    $('#fPosition').value = t.position ?? '';
    $('#fStop').value = t.stopLoss ?? '';
    $('#fNotes').value = t.notes || '';

    // Bild laden
    if (typeof t.image === 'string' && t.image.startsWith('data:image/')) {
      state.pendingImage = {
        dataUrl: t.image,
        originalSize: 0,
        compressedSize: Math.round((t.image.length * 3) / 4)
      };
    } else {
      state.pendingImage = null;
    }
    const fileInput = $('#fImage');
    if (fileInput) fileInput.value = '';
    renderImagePreview();

    updateFormMode();
    updatePreview();
    switchTab('dashboard');

    setTimeout(() => {
      const form = $('#tradeForm');
      if (form) form.scrollIntoView({ behavior: 'smooth', block: 'start' });
      $('#fTicker').focus();
    }, 80);
  }

  function deleteTrade(id) {
    const t = state.trades.find((x) => x.id === id);
    if (!t) return;

    const ok = window.confirm(`Trade "${t.ticker}" wirklich löschen?`);
    if (!ok) return;

    state.trades = state.trades.filter((x) => x.id !== id);

    if (state.editingId === id) {
      state.editingId = null;
      resetForm();
    }

    saveTrades();
    renderAll();
    toast('Trade gelöscht', 'success');
  }

  /* =========================================================
     Bild-Modal
     ========================================================= */
  function showImageModal(trade) {
    if (!trade) return;
    const modal = $('#imageModal');
    const img = $('#modalImage');
    const title = $('#modalTitle');
    const sub = $('#modalSub');

    if (!trade.image || !trade.image.startsWith('data:image/')) return;

    img.src = trade.image;
    title.textContent = `${trade.ticker || 'Chart'} · ${fmtDateTime(trade.datetime)}`;
    sub.textContent = `${trade.type === 'short' ? 'SHORT' : 'LONG'}${trade.setup ? ' · ' + trade.setup : ''}`;

    modal.classList.add('modal-open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
  }

  function hideImageModal() {
    const modal = $('#imageModal');
    const img = $('#modalImage');
    modal.classList.remove('modal-open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('modal-open');
    setTimeout(() => { img.removeAttribute('src'); }, 200);
  }

  /* =========================================================
     Event-Handler – Tabelle
     ========================================================= */
  function handleTableClick(e) {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;

    const row = btn.closest('tr');
    if (!row) return;

    const id = row.getAttribute('data-id');
    if (!id) return;

    const action = btn.getAttribute('data-action');
    if (action === 'edit') startEdit(id);
    else if (action === 'delete') deleteTrade(id);
    else if (action === 'show-image') {
      const t = state.trades.find((x) => x.id === id);
      if (t) showImageModal(t);
    }
  }

  /* =========================================================
     Filter
     ========================================================= */
  function handleFilterChange() {
    state.filters.ticker = $('#filterTicker').value.trim();
    state.filters.type = $('#filterType').value;
    state.filters.setup = $('#filterSetup').value;
    renderTable();
  }

  function clearFilters() {
    $('#filterTicker').value = '';
    $('#filterType').value = '';
    $('#filterSetup').value = '';
    state.filters = { ticker: '', type: '', setup: '' };
    renderTable();
  }

  /* =========================================================
     Import / Export
     ========================================================= */
  function exportJSON() {
    if (!state.trades.length) {
      toast('Keine Trades zum Exportieren.', 'error');
      return;
    }

    const payload = {
      version: 2,
      exportedAt: new Date().toISOString(),
      count: state.trades.length,
      trades: state.trades
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `trading-journal-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toast(`${state.trades.length} Trade(s) exportiert`, 'success');
  }

  function importJSON(file) {
    if (!file) return;

    const reader = new FileReader();

    reader.onload = (evt) => {
      try {
        const parsed = JSON.parse(evt.target.result);

        let imported = [];
        if (Array.isArray(parsed)) imported = parsed;
        else if (parsed && Array.isArray(parsed.trades)) imported = parsed.trades;
        else throw new Error('Ungültiges Format: "trades" Array fehlt.');

        const cleaned = imported
          .filter((t) => t && typeof t === 'object')
          .map((t) => {
            const img = typeof t.image === 'string' && t.image.startsWith('data:image/')
              ? t.image
              : null;

            return {
              id: typeof t.id === 'string' && t.id ? t.id : uid(),
              datetime: t.datetime || toLocalDatetimeInput(),
              ticker: String(t.ticker || '').toUpperCase(),
              type: t.type === 'short' ? 'short' : 'long',
              setup: String(t.setup || ''),
              entry: num(t.entry),
              exit: num(t.exit),
              position: num(t.position),
              stopLoss: num(t.stopLoss),
              notes: String(t.notes || ''),
              chartLink: '',
              image: img,
              createdAt: t.createdAt || new Date().toISOString(),
              updatedAt: t.updatedAt || null
            };
          })
          .filter((t) => t.ticker && (t.entry || t.exit));

        if (!cleaned.length) {
          toast('Keine gültigen Trades in der Datei gefunden.', 'error');
          return;
        }

        let replace = true;
        if (state.trades.length) {
          replace = window.confirm(
            `Aktuell: ${state.trades.length} Trade(s).\nImport: ${cleaned.length} Trade(s).\n\n` +
            `OK = Bestehende ersetzen\nAbbrechen = Zusammenführen (nach ID)`
          );
        }

        const previous = state.trades;

        if (replace) {
          state.trades = cleaned;
        } else {
          const map = new Map(state.trades.map((t) => [t.id, t]));
          for (const t of cleaned) map.set(t.id, t);
          state.trades = Array.from(map.values());
        }

        // Speichern testen – bei Quota-Fehler zurückrollen
        const success = saveTrades();
        if (!success) {
          state.trades = previous;
          return;
        }

        state.editingId = null;
        state.pendingImage = null;
        resetForm();
        renderAll();

        toast(`${cleaned.length} Trade(s) importiert`, 'success');
      } catch (err) {
        console.warn('Import-Fehler:', err);
        toast('Import fehlgeschlagen: ' + err.message, 'error');
      }
    };

    reader.onerror = () => toast('Datei konnte nicht gelesen werden.', 'error');
    reader.readAsText(file);
  }

  /* =========================================================
     Toast
     ========================================================= */
  let toastTimer = null;

  function toast(msg, type) {
    const el = $('#toast');
    if (!el) return;

    el.textContent = msg;

    let cls = 'toast toast-show';
    if (type === 'error') cls += ' toast-error';
    else if (type === 'success') cls += ' toast-success';

    el.className = cls;

    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.className = 'toast';
    }, 2600);
  }

  /* =========================================================
     Render All
     ========================================================= */
  function renderAll() {
    renderKPIs();
    renderTabBadges();
    renderSetupFilter();
    renderTable();
  }

  /* =========================================================
     Init
     ========================================================= */
  function init() {
    loadTrades();
    loadActiveTab();

    // Formular-Events
    const form = $('#tradeForm');
    form.addEventListener('submit', handleSubmit);
    form.addEventListener('input', updatePreview);
    form.addEventListener('change', updatePreview);

    $('#resetFormBtn').addEventListener('click', resetForm);
    $('#cancelEditBtn').addEventListener('click', resetForm);

    // Tab-Navigation
    const tabNav = document.querySelector('.tab-nav');
    if (tabNav) {
      tabNav.addEventListener('click', handleTabClick);
      tabNav.addEventListener('keydown', handleTabKeydown);
    }

    $$('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        switchTab(btn.getAttribute('data-tab'));
      });
    });

    // Tabelle
    $('#tradesBody').addEventListener('click', handleTableClick);

    // Filter
    $('#filterTicker').addEventListener('input', handleFilterChange);
    $('#filterType').addEventListener('change', handleFilterChange);
    $('#filterSetup').addEventListener('change', handleFilterChange);
    $('#clearFilters').addEventListener('click', clearFilters);

    // Import / Export
    $('#exportBtn').addEventListener('click', exportJSON);
    $('#importInput').addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) importJSON(file);
      e.target.value = '';
    });

    // Bild-Upload
    const zone = $('#uploadZone');
    const fileInput = $('#fImage');

    zone.addEventListener('click', (e) => {
      // Klick auf den "Entfernen"-Button darf nicht den File-Dialog öffnen
      if (e.target.closest('#removeImageBtn')) return;
      if (zone.classList.contains('has-image')) return;
      fileInput.click();
    });

    fileInput.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) handleImageSelect(file);
      e.target.value = '';
    });

    // Drag & Drop
    ['dragenter', 'dragover'].forEach((evt) => {
      zone.addEventListener(evt, (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!zone.classList.contains('has-image')) zone.classList.add('dragging');
      });
    });

    ['dragleave', 'drop'].forEach((evt) => {
      zone.addEventListener(evt, (e) => {
        e.preventDefault();
        e.stopPropagation();
        zone.classList.remove('dragging');
      });
    });

    zone.addEventListener('drop', (e) => {
      const dt = e.dataTransfer;
      if (!dt || !dt.files || !dt.files.length) return;
      handleImageSelect(dt.files[0]);
    });

    $('#removeImageBtn').addEventListener('click', (e) => {
      e.stopPropagation();
      removeImage();
    });

    // Modal
    $('#modalCloseBtn').addEventListener('click', hideImageModal);
    $('#imageModal').addEventListener('click', (e) => {
      if (e.target.closest('[data-close-modal]') || e.target.id === 'imageModal') {
        hideImageModal();
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') hideImageModal();
    });

    // Datum vorbelegen
    $('#fDateTime').value = toLocalDatetimeInput();

    updateFormMode();
    renderImagePreview();
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
