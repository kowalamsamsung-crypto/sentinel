(function () {
  'use strict';

  function serverBase() {
    let value = '';
    try {
      const cap = window.Capacitor || (window.parent && window.parent.Capacitor);
      const native = !!(cap && cap.isNativePlatform && cap.isNativePlatform());
      if (!native && /^https?:$/.test(location.protocol)) return location.origin;
      value = localStorage.getItem('sentinelServer') || '';
      if (!value && window.parent && window.parent !== window) value = window.parent.localStorage.getItem('sentinelServer') || '';
    } catch (e) {}
    value = String(value || '').trim().replace(/\/$/, '');
    if (value && !/^https?:\/\//i.test(value)) value = 'http://' + value;
    return value;
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
      reader.onerror = () => reject(reader.error || new Error('Nie udało się odczytać pliku'));
      reader.readAsDataURL(blob);
    });
  }

  function textToBase64(text) {
    const bytes = new TextEncoder().encode(String(text || ''));
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
  }

  function base64ToBlob(base64, mimeType) {
    const binary = atob(String(base64 || ''));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mimeType || 'application/octet-stream' });
  }

  async function archive(options) {
    options = options || {};
    const base = serverBase();
    if (!base) return { saved: false, error: 'Ustaw adres serwera Sentinel' };
    try {
      let reportBase64 = options.reportBase64 || '';
      if (!reportBase64 && options.reportBlob) reportBase64 = await blobToBase64(options.reportBlob);
      if (!reportBase64 && options.reportText !== undefined) reportBase64 = textToBase64(options.reportText);
      const response = await fetch(base + '/api/report-history/' + encodeURIComponent(options.module), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: options.title,
          createdAt: options.createdAt || new Date().toISOString(),
          reportName: options.reportName,
          mimeType: options.mimeType,
          reportBase64,
          summary: options.summary || {},
          state: options.state === undefined ? null : options.state
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || ('HTTP ' + response.status));
      window.dispatchEvent(new CustomEvent('sentinel-report-archived', { detail: payload }));
      return { saved: true, ...payload };
    } catch (error) {
      console.warn('Historia raportów:', error);
      return { saved: false, error: error.message || String(error) };
    }
  }

  function formatDate(value) {
    try { return new Date(value).toLocaleString('pl-PL'); }
    catch (e) { return String(value || ''); }
  }

  function image(value, alt) {
    if (!/^data:image\//i.test(String(value || ''))) return '';
    return `<img src="${escapeHtml(value)}" alt="${escapeHtml(alt || 'Zdjęcie')}" style="width:120px;height:90px;object-fit:cover;border-radius:8px;border:1px solid #475569;background:#020617">`;
  }

  function ddmsPreview(state) {
    const rows = (state && state.records || []).map((item, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(item.ddmsCode)}</td><td>${escapeHtml(item.serialNumber)}</td><td>${escapeHtml(item.status)}</td><td>${escapeHtml(formatDate(item.timestamp))}</td><td>${image(item.photoData, item.serialNumber)}</td></tr>`).join('');
    return `<table><thead><tr><th>Lp.</th><th>DDMS</th><th>S/N</th><th>Status</th><th>Data</th><th>Zdjęcie</th></tr></thead><tbody>${rows || '<tr><td colspan="6">Brak zapisów</td></tr>'}</tbody></table>`;
  }

  function warehousePreview(state) {
    const defects = [...(state && state.warehouseDefects || []), ...(state && state.loadingDefects || [])];
    const rows = defects.map((item, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(item.zone || item.types && item.types.join(', ') || '-')}</td><td>${escapeHtml(item.notes || '-')}</td><td>${image(item.photo, 'Uszkodzenie')}</td></tr>`).join('');
    const slots = Object.entries(state && state.loadingPhotos || {}).map(([key, value]) => `<figure><figcaption>${escapeHtml(key)}</figcaption>${image(value, key)}</figure>`).join('');
    return `<table><thead><tr><th>Lp.</th><th>Pozycja / typ</th><th>Uwagi</th><th>Zdjęcie</th></tr></thead><tbody>${rows || '<tr><td colspan="4">Brak uszkodzeń</td></tr>'}</tbody></table><div class="srh-gallery">${slots}</div>`;
  }

  function cleanilyPreview(state) {
    const areas = (state && state.areas || []).map((item, i) => `<figure><figcaption>Strefa ${i + 1}: ${escapeHtml(item.photoName || '')}</figcaption>${image(item.photo, 'Strefa ' + (i + 1))}</figure>`).join('');
    const panorama = state && state.panorama ? `<figure><figcaption>Całe laboratorium</figcaption>${image(state.panorama, 'Panorama')}</figure>` : '';
    return `<div class="srh-gallery">${areas}${panorama}</div>`;
  }

  function statePreview(moduleName, state) {
    if (moduleName === 'ddms') return ddmsPreview(state);
    if (moduleName === 'warehouse') return warehousePreview(state);
    if (moduleName === 'cleanily') return cleanilyPreview(state);
    return `<pre>${escapeHtml(JSON.stringify(state, null, 2))}</pre>`;
  }

  function ensureUi() {
    if (document.getElementById('sentinel-report-history-modal')) return;
    const style = document.createElement('style');
    style.textContent = `
      .srh-open{position:fixed;right:10px;bottom:10px;z-index:99990;border:1px solid #60a5fa;border-radius:999px;padding:9px 13px;background:#172554;color:#dbeafe;font:700 12px system-ui;box-shadow:0 5px 20px #0008;cursor:pointer}
      .srh-modal{position:fixed;inset:0;z-index:100000;background:#020617dd;display:none;padding:18px;overflow:auto;color:#e2e8f0;font:14px/1.4 system-ui}
      .srh-modal.open{display:block}.srh-card{width:min(1050px,100%);margin:auto;background:#0f172a;border:1px solid #334155;border-radius:16px;padding:16px;box-shadow:0 20px 60px #000a}
      .srh-head{display:flex;align-items:center;justify-content:space-between;gap:12px}.srh-head h2{margin:0;font-size:21px}.srh-close{border:1px solid #64748b;background:#1e293b;color:#fff;border-radius:9px;padding:8px 12px;cursor:pointer}
      .srh-list{display:grid;gap:8px;margin-top:14px}.srh-item{display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center;border:1px solid #334155;border-radius:10px;padding:10px;background:#111c31}
      .srh-item small{display:block;color:#94a3b8}.srh-item button,.srh-item a{border:1px solid #3b82f6;background:#1d4ed8;color:#fff;border-radius:8px;padding:7px 10px;text-decoration:none;cursor:pointer}
      .srh-actions{display:flex;gap:7px;flex-wrap:wrap}.srh-preview{margin-top:15px;border-top:1px solid #334155;padding-top:15px;overflow:auto}.srh-preview table{width:100%;border-collapse:collapse}.srh-preview th,.srh-preview td{border:1px solid #334155;padding:7px;text-align:left;vertical-align:top}.srh-preview th{background:#1e293b}.srh-gallery{display:flex;gap:10px;flex-wrap:wrap;margin-top:12px}.srh-gallery figure{margin:0;padding:7px;border:1px solid #334155;border-radius:9px}.srh-gallery figcaption{max-width:140px;margin-bottom:5px;color:#cbd5e1;font-size:11px}
      @media(max-width:600px){.srh-modal{padding:8px}.srh-item{grid-template-columns:1fr}.srh-actions{justify-content:flex-start}}
    `;
    document.head.appendChild(style);
    const modal = document.createElement('div');
    modal.id = 'sentinel-report-history-modal';
    modal.className = 'srh-modal';
    modal.innerHTML = '<div class="srh-card"><div class="srh-head"><h2>Historia raportów</h2><button class="srh-close" type="button">Zamknij</button></div><div class="srh-list"></div><div class="srh-preview"></div></div>';
    document.body.appendChild(modal);
    modal.querySelector('.srh-close').addEventListener('click', () => modal.classList.remove('open'));
    modal.addEventListener('click', event => { if (event.target === modal) modal.classList.remove('open'); });
  }

  async function showHistory(moduleName) {
    ensureUi();
    const modal = document.getElementById('sentinel-report-history-modal');
    const list = modal.querySelector('.srh-list');
    const preview = modal.querySelector('.srh-preview');
    modal.classList.add('open');
    list.textContent = 'Wczytywanie historii…';
    preview.innerHTML = '';
    const base = serverBase();
    if (!base) { list.textContent = 'Ustaw adres serwera Sentinel.'; return; }
    try {
      const response = await fetch(base + '/api/report-history/' + encodeURIComponent(moduleName), { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || ('HTTP ' + response.status));
      if (!payload.items.length) { list.textContent = 'Brak zapisanych raportów.'; return; }
      list.innerHTML = payload.items.map(item => `<div class="srh-item"><div><strong>${escapeHtml(item.title || item.reportName)}</strong><small>${escapeHtml(formatDate(item.createdAt))} · ${escapeHtml(item.reportName || '')}</small></div><div class="srh-actions"><button type="button" data-preview="${escapeHtml(item.id)}">Podgląd</button><a href="${escapeHtml(base + item.reportUrl)}" target="_blank" rel="noopener">Otwórz plik</a></div></div>`).join('');
      list.querySelectorAll('[data-preview]').forEach(button => button.addEventListener('click', async () => {
        preview.textContent = 'Wczytywanie podglądu…';
        try {
          const detailResponse = await fetch(base + '/api/report-history/' + encodeURIComponent(moduleName) + '/' + encodeURIComponent(button.dataset.preview), { cache: 'no-store' });
          const detail = await detailResponse.json();
          if (!detailResponse.ok) throw new Error(detail.error || ('HTTP ' + detailResponse.status));
          preview.innerHTML = `<h3>${escapeHtml(detail.title || detail.reportName)}</h3>${statePreview(moduleName, detail.state)}`;
        } catch (error) { preview.textContent = error.message || String(error); }
      }));
    } catch (error) { list.textContent = error.message || String(error); }
  }

  function mount(moduleName) {
    if (document.querySelector('.srh-open')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'srh-open';
    button.textContent = 'Historia raportów';
    button.addEventListener('click', () => showHistory(moduleName));
    document.body.appendChild(button);
  }

  window.SentinelReportHistory = { archive, blobToBase64, textToBase64, base64ToBlob, mount, showHistory, serverBase };
})();
