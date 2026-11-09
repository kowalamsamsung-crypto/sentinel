(function () {
  'use strict';

  const POLL_MS = 2500;

  function getDeviceId() {
    const key = 'sentinel-sync-device-id';
    let value = localStorage.getItem(key);
    if (!value) {
      value = (crypto.randomUUID ? crypto.randomUUID() : 'device-' + Date.now() + '-' + Math.random().toString(36).slice(2));
      localStorage.setItem(key, value);
    }
    return value;
  }

  function isNativeShell() {
    try {
      const cap = window.Capacitor || (window.parent && window.parent.Capacitor);
      return !!(cap && cap.isNativePlatform && cap.isNativePlatform());
    } catch (e) {
      return false;
    }
  }

  function serverBase() {
    if (!isNativeShell()) return /^https?:$/.test(location.protocol) ? location.origin : '';
    let value = '';
    try { value = localStorage.getItem('sentinelServer') || ''; } catch (e) {}
    try {
      if (!value && window.parent && window.parent !== window) {
        value = window.parent.localStorage.getItem('sentinelServer') || '';
      }
    } catch (e) {}
    value = String(value || '').trim().replace(/\/$/, '');
    if (value && !/^https?:\/\//i.test(value)) value = 'http://' + value;
    return value;
  }

  function createBadge(label) {
    const badge = document.createElement('button');
    badge.type = 'button';
    badge.title = 'Kliknij, aby zsynchronizowac teraz';
    badge.style.cssText = 'position:fixed;left:10px;bottom:10px;z-index:99999;border:1px solid rgba(148,163,184,.55);border-radius:999px;padding:6px 10px;background:#0f172a;color:#e2e8f0;font:600 11px/1.2 system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.25);cursor:pointer;max-width:calc(100vw - 20px);white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
    badge.textContent = label + ': laczenie...';
    document.body.appendChild(badge);
    return badge;
  }

  async function fetchJson(url, options) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(url, { ...(options || {}), cache: 'no-store', signal: controller.signal });
      const payload = await response.json().catch(() => ({}));
      return { response, payload };
    } finally {
      clearTimeout(timer);
    }
  }

  function same(a, b) {
    try { return JSON.stringify(a) === JSON.stringify(b); } catch (e) { return false; }
  }

  function create(options) {
    if (!options || !options.module || typeof options.read !== 'function' || typeof options.apply !== 'function') {
      throw new Error('Niepelna konfiguracja SentinelSync');
    }

    const moduleName = String(options.module).toLowerCase();
    const label = options.label || moduleName;
    const deviceId = getDeviceId();
    const badge = createBadge(label);
    let revision = 0;
    let dirty = false;
    let applying = false;
    let initialized = false;
    let busy = false;
    let stopped = false;
    let pushTimer = null;

    function notify(state, detail) {
      const colors = {
        online: ['#052e16', '#86efac'],
        pending: ['#422006', '#fde68a'],
        syncing: ['#172554', '#93c5fd'],
        offline: ['#450a0a', '#fca5a5']
      };
      const pair = colors[state] || colors.syncing;
      badge.style.background = pair[0];
      badge.style.color = pair[1];
      badge.textContent = label + ': ' + detail;
      try {
        window.parent.postMessage({ type: 'sentinel-module-sync', module: moduleName, state, detail, revision }, '*');
      } catch (e) {}
      if (typeof options.onStatus === 'function') options.onStatus(state, detail);
    }

    async function readLocal() {
      return await options.read();
    }

    async function applyState(state) {
      applying = true;
      try { await options.apply(state); }
      finally { applying = false; }
    }

    function merge(local, remote, context) {
      return typeof options.merge === 'function' ? options.merge(local, remote, context) : remote;
    }

    async function postState(state, retry) {
      const base = serverBase();
      if (!base) throw new Error('Ustaw adres serwera Sentinel');
      const { response, payload } = await fetchJson(base + '/api/module-sync/' + encodeURIComponent(moduleName), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId, baseRevision: revision, data: state })
      });
      if (response.status === 409 && payload.current && retry !== false) {
        revision = Number(payload.current.revision) || 0;
        const local = await readLocal();
        const combined = merge(local, payload.current.data, 'conflict');
        await applyState(combined);
        return postState(combined, false);
      }
      if (!response.ok) throw new Error(payload.error || ('HTTP ' + response.status));
      revision = Number(payload.revision) || revision;
      dirty = false;
      notify('online', 'zsynchronizowano');
    }

    async function push() {
      if (!initialized || applying || busy || stopped) return;
      busy = true;
      notify('syncing', 'wysylanie...');
      try {
        await postState(await readLocal(), true);
      } catch (e) {
        dirty = true;
        notify('offline', e.message || 'brak polaczenia');
      } finally {
        busy = false;
      }
    }

    function markDirty() {
      if (applying || stopped) return;
      dirty = true;
      notify('pending', 'oczekuje na zapis');
      clearTimeout(pushTimer);
      pushTimer = setTimeout(push, 700);
    }

    async function pull() {
      if (busy || stopped) return;
      const base = serverBase();
      if (!base) {
        notify('offline', 'ustaw adres serwera');
        return;
      }
      busy = true;
      try {
        const suffix = initialized ? '?since=' + encodeURIComponent(revision) : '';
        const { response, payload } = await fetchJson(base + '/api/module-sync/' + encodeURIComponent(moduleName) + suffix);
        if (!response.ok) throw new Error(payload.error || ('HTTP ' + response.status));

        if (!initialized) {
          revision = Number(payload.revision) || 0;
          if (!payload.exists) {
            initialized = true;
            busy = false;
            await push();
            return;
          }
          const local = await readLocal();
          const combined = merge(local, payload.data, 'initial');
          await applyState(combined);
          initialized = true;
          if (!same(combined, payload.data)) {
            dirty = true;
            busy = false;
            await push();
            return;
          }
          dirty = false;
          notify('online', 'zsynchronizowano');
          return;
        }

        if (payload.changed) {
          const local = await readLocal();
          const combined = dirty ? merge(local, payload.data, 'remote-while-dirty') : payload.data;
          revision = Number(payload.revision) || revision;
          await applyState(combined);
          if (dirty && !same(combined, payload.data)) {
            busy = false;
            await push();
            return;
          }
          dirty = false;
        }
        notify('online', dirty ? 'oczekuje na zapis' : 'zsynchronizowano');
      } catch (e) {
        notify('offline', e.name === 'AbortError' ? 'przekroczono czas' : (e.message || 'brak polaczenia'));
      } finally {
        busy = false;
      }
    }

    badge.addEventListener('click', async () => {
      if (dirty) await push();
      else await pull();
    });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) pull(); });
    window.addEventListener('online', pull);
    setInterval(pull, POLL_MS);
    setTimeout(pull, 0);

    return {
      markDirty,
      syncNow: async () => { if (dirty) await push(); else await pull(); },
      isApplying: () => applying,
      stop: () => { stopped = true; clearTimeout(pushTimer); }
    };
  }

  window.SentinelSync = { create };
})();
