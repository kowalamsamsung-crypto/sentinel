(function () {
  'use strict';

  const META_KEY = 'sentinel-warehouse-sync-meta-v1';
  const PHOTO_RESET_KEY = 'sentinel-warehouse-photo-reset-v1';
  const PHOTO_RESET_VERSION = 1;
  const FIELD_IDS = ['truckId','pptxCustomer','pptxDO','pptxDate','pptxDeadline','pptxInspector','pptxModel','pptxPIC','pptxQty','pptxResponsible','pptxResult','pptxSeries'];
  let sync = null;

  function ensureInitialPhotoReset() {
    if (localStorage.getItem(PHOTO_RESET_KEY) === String(PHOTO_RESET_VERSION)) return;
    warehouseDefects = [];
    loadingDefects = [];
    loadingPhotos = {};
    localStorage.removeItem(META_KEY);
    localStorage.setItem(PHOTO_RESET_KEY, String(PHOTO_RESET_VERSION));
    renderWarehouseList();
    renderLoadingSlots();
    renderLoadingDefectsList();
    updateLoadingProgress();
  }

  function loadMeta() {
    try {
      const value = JSON.parse(localStorage.getItem(META_KEY) || '{}');
      return { deleted: [], slots: {}, fields: {}, ...value };
    } catch (e) {
      return { deleted: [], slots: {}, fields: {} };
    }
  }

  function saveMeta(meta) {
    localStorage.setItem(META_KEY, JSON.stringify(meta));
  }

  function readFields() {
    const values = {};
    FIELD_IDS.forEach(id => {
      const element = document.getElementById(id);
      if (element) values[id] = element.value;
    });
    return values;
  }

  function readState() {
    const meta = loadMeta();
    return {
      photoResetVersion: PHOTO_RESET_VERSION,
      warehouseDefects: JSON.parse(JSON.stringify(warehouseDefects || [])),
      loadingDefects: JSON.parse(JSON.stringify(loadingDefects || [])),
      loadingPhotos: { ...(loadingPhotos || {}) },
      fields: readFields(),
      fieldTimes: { ...(meta.fields || {}) },
      slotTimes: { ...(meta.slots || {}) },
      deleted: Array.isArray(meta.deleted) ? meta.deleted : []
    };
  }

  function mergeItems(left, right, deletedMap, kind) {
    const result = new Map();
    [...(right || []), ...(left || [])].forEach(item => {
      if (!item || item.id === undefined) return;
      const key = kind + ':' + item.id;
      if (!deletedMap.has(key)) result.set(String(item.id), item);
    });
    return Array.from(result.values()).sort((a, b) => Number(a.id || 0) - Number(b.id || 0));
  }

  function mergeState(local, remote) {
    local = local || {};
    remote = remote || {};
    const localVersion = Number(local.photoResetVersion || 0);
    const remoteVersion = Number(remote.photoResetVersion || 0);
    if (localVersion !== remoteVersion) return localVersion > remoteVersion ? local : remote;
    const deletedMap = new Map();
    [...(remote.deleted || []), ...(local.deleted || [])].forEach(item => {
      if (!item || !item.key) return;
      const old = deletedMap.get(item.key);
      if (!old || Number(item.at || 0) > Number(old.at || 0)) deletedMap.set(item.key, item);
    });

    const fieldTimes = {};
    const fields = {};
    FIELD_IDS.forEach(id => {
      const lt = Number((local.fieldTimes || {})[id] || 0);
      const rt = Number((remote.fieldTimes || {})[id] || 0);
      if (lt > rt) {
        fields[id] = (local.fields || {})[id] || '';
        fieldTimes[id] = lt;
      } else {
        fields[id] = (remote.fields || {})[id] || '';
        fieldTimes[id] = rt;
      }
    });

    const allSlots = new Set([
      ...Object.keys(local.loadingPhotos || {}), ...Object.keys(remote.loadingPhotos || {}),
      ...Object.keys(local.slotTimes || {}), ...Object.keys(remote.slotTimes || {})
    ]);
    const loadingPhotosOut = {};
    const slotTimes = {};
    allSlots.forEach(id => {
      const lt = Number((local.slotTimes || {})[id] || 0);
      const rt = Number((remote.slotTimes || {})[id] || 0);
      const value = lt > rt ? (local.loadingPhotos || {})[id] : (remote.loadingPhotos || {})[id];
      if (value) loadingPhotosOut[id] = value;
      slotTimes[id] = Math.max(lt, rt);
    });

    return {
      photoResetVersion: Math.max(localVersion, remoteVersion),
      warehouseDefects: mergeItems(local.warehouseDefects, remote.warehouseDefects, deletedMap, 'warehouse'),
      loadingDefects: mergeItems(local.loadingDefects, remote.loadingDefects, deletedMap, 'loading'),
      loadingPhotos: loadingPhotosOut,
      fields,
      fieldTimes,
      slotTimes,
      deleted: Array.from(deletedMap.values())
    };
  }

  function applyState(state) {
    state = state || {};
    if (Number(state.photoResetVersion || 0) >= PHOTO_RESET_VERSION) {
      localStorage.setItem(PHOTO_RESET_KEY, String(PHOTO_RESET_VERSION));
    }
    warehouseDefects = Array.isArray(state.warehouseDefects) ? state.warehouseDefects : [];
    loadingDefects = Array.isArray(state.loadingDefects) ? state.loadingDefects : [];
    loadingPhotos = state.loadingPhotos && typeof state.loadingPhotos === 'object' ? state.loadingPhotos : {};
    FIELD_IDS.forEach(id => {
      const element = document.getElementById(id);
      if (element && state.fields && state.fields[id] !== undefined) element.value = state.fields[id];
    });
    saveMeta({
      deleted: Array.isArray(state.deleted) ? state.deleted : [],
      slots: state.slotTimes || {},
      fields: state.fieldTimes || {}
    });
    renderWarehouseList();
    renderLoadingSlots();
    renderLoadingDefectsList();
    updateLoadingProgress();
  }

  window.WarehouseSyncBridge = {
    changed: () => { if (sync) sync.markDirty(); },
    deleted: (kind, id) => {
      const meta = loadMeta();
      const key = kind + ':' + id;
      meta.deleted = (meta.deleted || []).filter(item => item.key !== key);
      meta.deleted.push({ key, at: Date.now() });
      saveMeta(meta);
    },
    slotChanged: id => {
      const meta = loadMeta();
      meta.slots[id] = Date.now();
      saveMeta(meta);
      if (sync) sync.markDirty();
    }
  };

  ensureInitialPhotoReset();

  sync = window.SentinelSync.create({
    module: 'warehouse',
    label: 'W/H sync',
    read: readState,
    apply: applyState,
    merge: mergeState
  });

  FIELD_IDS.forEach(id => {
    const element = document.getElementById(id);
    if (!element) return;
    element.addEventListener('input', () => {
      if (sync.isApplying()) return;
      const meta = loadMeta();
      meta.fields[id] = Date.now();
      saveMeta(meta);
      sync.markDirty();
    });
  });
})();
