(function () {
  'use strict';

  const bridge = window.CleanilySyncBridge;
  if (!bridge) return;

  function isBlank(state) {
    return !state || (!(state.panorama) && !(state.areas || []).some(area => area && area.photo));
  }

  function mergeState(local, remote, context) {
    if (!remote) return local;
    if (!local) return remote;
    const localVersion = Number(local._photoResetVersion || 0);
    const remoteVersion = Number(remote._photoResetVersion || 0);
    if (localVersion !== remoteVersion) return localVersion > remoteVersion ? local : remote;
    if (context === 'initial' && isBlank(local) && !isBlank(remote)) return remote;

    const localReset = Number(local._resetAt || 0);
    const remoteReset = Number(remote._resetAt || 0);
    const base = localReset > remoteReset ? local : remote;
    const out = JSON.parse(JSON.stringify(base));
    out._photoResetVersion = Math.max(localVersion, remoteVersion);
    out._resetAt = Math.max(localReset, remoteReset);
    out.startedAt = base.startedAt || local.startedAt || remote.startedAt;
    out.areas = [];
    for (let i = 0; i < 5; i++) {
      const left = (local.areas || [])[i] || {};
      const right = (remote.areas || [])[i] || {};
      out.areas[i] = Number(left._updatedAt || 0) > Number(right._updatedAt || 0) ? left : right;
    }
    if (Number(local._panoramaUpdatedAt || 0) > Number(remote._panoramaUpdatedAt || 0)) {
      out.panorama = local.panorama || '';
      out.panoramaName = local.panoramaName || '';
      out._panoramaUpdatedAt = Number(local._panoramaUpdatedAt || 0);
    } else {
      out.panorama = remote.panorama || '';
      out.panoramaName = remote.panoramaName || '';
      out._panoramaUpdatedAt = Number(remote._panoramaUpdatedAt || 0);
    }
    return out;
  }

  const sync = window.SentinelSync.create({
    module: 'cleanily',
    label: 'Cleanily sync',
    read: () => bridge.getState(),
    apply: state => bridge.applyState(state),
    merge: mergeState
  });

  bridge.changed = () => sync.markDirty();
})();
