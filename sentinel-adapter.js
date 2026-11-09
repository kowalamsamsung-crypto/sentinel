(function () {
  'use strict';

  const DELETED_KEY = 'sentinel-ddms-deleted-v1';
  const PHOTO_RESET_KEY = 'sentinel-ddms-photo-reset-v1';
  const PHOTO_RESET_VERSION = 1;
  let sync = null;
  let resetPromise = null;

  function ensureInitialPhotoReset() {
    if (resetPromise) return resetPromise;
    resetPromise = (async () => {
      if (localStorage.getItem(PHOTO_RESET_KEY) === String(PHOTO_RESET_VERSION)) return;
      await DdmsDB.clearAll();
      localStorage.removeItem(DELETED_KEY);
      localStorage.setItem(PHOTO_RESET_KEY, String(PHOTO_RESET_VERSION));
    })();
    return resetPromise;
  }

  function deletedList() {
    try {
      const value = JSON.parse(localStorage.getItem(DELETED_KEY) || '[]');
      return Array.isArray(value) ? value : [];
    } catch (e) {
      return [];
    }
  }

  function saveDeleted(items) {
    const cutoff = Date.now() - 180 * 24 * 60 * 60 * 1000;
    const compact = Array.from(new Map((items || [])
      .filter(item => item && item.id && (!item.at || item.at >= cutoff))
      .map(item => [item.id, item])).values()).slice(-5000);
    localStorage.setItem(DELETED_KEY, JSON.stringify(compact));
  }

  function recordId(record) {
    return record.syncId || ['legacy', record.timestamp || '', record.serialNumber || '', record.ddmsCode || ''].join('|');
  }

  function blobToDataUrl(blob) {
    if (!blob) return Promise.resolve('');
    if (typeof blob === 'string') return Promise.resolve(blob);
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  function dataUrlToBlob(value) {
    if (!value || typeof value !== 'string') return null;
    const match = /^data:([^;,]+)?(?:;base64)?,(.*)$/s.exec(value);
    if (!match) return null;
    const bytes = value.includes(';base64,') ? atob(match[2]) : decodeURIComponent(match[2]);
    const out = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) out[i] = bytes.charCodeAt(i);
    return new Blob([out], { type: match[1] || 'image/jpeg' });
  }

  async function readState() {
    await ensureInitialPhotoReset();
    const records = await DdmsDB.getAll();
    return {
      photoResetVersion: PHOTO_RESET_VERSION,
      records: await Promise.all(records.map(async record => ({
        syncId: recordId(record),
        ddmsCode: record.ddmsCode || '',
        serialNumber: record.serialNumber || '',
        status: record.status || 'OK',
        note: record.note || '',
        timestamp: record.timestamp || new Date().toISOString(),
        photoData: await blobToDataUrl(record.photoBlob)
      }))),
      deleted: deletedList()
    };
  }

  function mergeState(local, remote) {
    local = local || { records: [], deleted: [] };
    remote = remote || { records: [], deleted: [] };
    const localVersion = Number(local.photoResetVersion || 0);
    const remoteVersion = Number(remote.photoResetVersion || 0);
    if (localVersion !== remoteVersion) return localVersion > remoteVersion ? local : remote;
    const deleted = new Map();
    [...(remote.deleted || []), ...(local.deleted || [])].forEach(item => {
      if (!item || !item.id) return;
      const old = deleted.get(item.id);
      if (!old || Number(item.at || 0) > Number(old.at || 0)) deleted.set(item.id, item);
    });
    const records = new Map();
    [...(remote.records || []), ...(local.records || [])].forEach(record => {
      if (!record) return;
      const id = recordId(record);
      if (!deleted.has(id)) records.set(id, { ...record, syncId: id });
    });
    return {
      photoResetVersion: Math.max(localVersion, remoteVersion),
      records: Array.from(records.values()),
      deleted: Array.from(deleted.values())
    };
  }

  async function applyState(state) {
    state = state || { records: [], deleted: [] };
    if (Number(state.photoResetVersion || 0) >= PHOTO_RESET_VERSION) {
      localStorage.setItem(PHOTO_RESET_KEY, String(PHOTO_RESET_VERSION));
    }
    saveDeleted(state.deleted || []);
    const records = (state.records || []).map(record => ({
      syncId: recordId(record),
      ddmsCode: record.ddmsCode || '',
      serialNumber: record.serialNumber || '',
      status: record.status || 'OK',
      note: record.note || '',
      timestamp: record.timestamp || new Date().toISOString(),
      photoBlob: dataUrlToBlob(record.photoData)
    }));
    await DdmsDB.replaceAll(records);
    window.dispatchEvent(new CustomEvent('sentinel-ddms-updated'));
  }

  function rememberDeleted(records) {
    const at = Date.now();
    const all = deletedList();
    (Array.isArray(records) ? records : []).forEach(record => {
      if (record) all.push({ id: recordId(record), at });
    });
    saveDeleted(all);
  }

  window.DdmsSyncBridge = {
    changed: () => { if (sync) sync.markDirty(); },
    deleted: record => rememberDeleted([record]),
    deletedMany: records => rememberDeleted(records)
  };

  sync = window.SentinelSync.create({
    module: 'ddms',
    label: 'DDMS sync',
    read: readState,
    apply: applyState,
    merge: mergeState
  });
})();
