/**
 * 云端同步：通过 Cloudflare Pages Functions + KV 实现跨设备同步。
 * 不依赖网盘或 File System Access API，任何浏览器都可用。
 *
 * 流程：
 *  - 启动时从 /api/data 拉取最新数据载入 store
 *  - 任何任务变化（debounce 1.5s）后 PUT 到 /api/data
 *  - 定期轮询（5s）检测其他设备的更新
 *  - 版本号（rev）机制防止旧数据覆盖新数据
 */

import { useTaskStore } from '../store/useTaskStore';
import { TrashItem, ViewId } from '../types';

const API = '/api/data';
const LOCAL_REV = 'rf-cloud-rev';

export type CloudStatus = 'idle' | 'syncing' | 'synced' | 'error' | 'offline';

let listeners = new Set<(s: CloudStatus) => void>();
let status: CloudStatus = 'idle';
let writeTimer: ReturnType<typeof setTimeout> | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let watching = false;
let localRev = 0;
let lastSig = '';

function emit(s: CloudStatus) {
  status = s;
  listeners.forEach((l) => l(s));
}

export function onCloudStatus(cb: (s: CloudStatus) => void) {
  listeners.add(cb);
  cb(status);
  return () => listeners.delete(cb);
}

function signature(data: { tasks?: unknown[]; trash?: unknown[]; collapsed?: unknown }): string {
  const t = JSON.stringify(data?.tasks ?? []);
  const r = JSON.stringify(data?.trash ?? []);
  const c = JSON.stringify(data?.collapsed ?? {});
  return `${t.length}:${t.slice(0, 40)}|${r.length}:${r.slice(0, 40)}|${c.length}`;
}

function payload() {
  const s = useTaskStore.getState();
  localRev = localRev + 1;
  try { localStorage.setItem(LOCAL_REV, String(localRev)); } catch { /* ignore */ }
  return {
    app: 'research-flow',
    exportedAt: new Date().toISOString(),
    rev: localRev,
    tasks: s.tasks,
    collapsed: s.collapsed,
    view: s.view,
    dayWidth: s.dayWidth,
    hideDone: s.hideDone,
    panelOpen: s.panelOpen,
    trash: s.trash,
  };
}

/** 从远端拉取数据 */
async function pull(): Promise<boolean> {
  try {
    const res = await fetch(API);
    if (!res.ok) { emit('error'); return false; }
    const data = await res.json();
    if (Array.isArray(data?.tasks)) {
      const s = useTaskStore.getState();
      s.loadSync({
        tasks: data.tasks,
        collapsed: data.collapsed,
        view: data.view as ViewId,
        dayWidth: data.dayWidth,
        hideDone: data.hideDone,
        panelOpen: data.panelOpen,
        trash: (data.trash ?? []) as TrashItem[],
      });
      localRev = Number(data.rev) || 0;
      lastSig = signature(data);
      try { localStorage.setItem(LOCAL_REV, String(localRev)); } catch { /* ignore */ }
      return true;
    }
    return false;
  } catch {
    emit('offline');
    return false;
  }
}

/** 写入远端 */
async function flush(): Promise<void> {
  try {
    const p = payload();
    const res = await fetch(API, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(p),
    });
    if (!res.ok) { emit('error'); return; }
    const result = await res.json();
    if (result.action === 'rejected') {
      // 远端比本地新 → 拉取远端
      await pull();
    } else {
      lastSig = signature(p);
      emit('synced');
    }
  } catch {
    emit('offline');
  }
}

/** 启动时初始化 */
export async function initCloudSync(): Promise<void> {
  // 恢复本地 rev
  try {
    const r = localStorage.getItem(LOCAL_REV);
    if (r) localRev = Number(r) || 0;
  } catch { /* ignore */ }

  emit('syncing');
  const ok = await pull();
  if (!ok) {
    // API 不可用，不启动轮询和写入
    return;
  }
  startWatching();
  startPolling();
  emit('synced');
}

/** 立即同步（手动触发） */
export async function cloudSyncNow(): Promise<void> {
  emit('syncing');
  await flush();
}

/** 订阅 store 变化，自动写入 */
function startWatching() {
  if (watching) return;
  watching = true;
  let prev = pickRelevant(useTaskStore.getState());
  useTaskStore.subscribe((state) => {
    const next = pickRelevant(state);
    if (
      next.tasks === prev.tasks &&
      next.collapsed === prev.collapsed &&
      next.view === prev.view &&
      next.dayWidth === prev.dayWidth &&
      next.hideDone === prev.hideDone &&
      next.panelOpen === prev.panelOpen &&
      next.trash === prev.trash
    ) {
      return;
    }
    prev = next;
    scheduleWrite();
  });
}

function pickRelevant(s: ReturnType<typeof useTaskStore.getState>) {
  return {
    tasks: s.tasks,
    collapsed: s.collapsed,
    view: s.view,
    dayWidth: s.dayWidth,
    hideDone: s.hideDone,
    panelOpen: s.panelOpen,
    trash: s.trash,
  };
}

function scheduleWrite() {
  if (writeTimer) clearTimeout(writeTimer);
  emit('syncing');
  writeTimer = setTimeout(() => {
    flush();
  }, 1500);
}

/** 定期轮询：检测其他设备的更新 */
function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    try {
      const res = await fetch(API);
      if (!res.ok) return;
      const data = await res.json();
      if (!Array.isArray(data?.tasks)) return;
      const remoteRev = Number(data.rev) || 0;
      const remoteSig = signature(data);
      // 远端 rev 比本地大，且签名变了 → 拉取
      if (remoteRev > localRev && remoteSig !== lastSig) {
        lastSig = remoteSig;
        emit('syncing');
        await pull();
        emit('synced');
      } else {
        lastSig = remoteSig;
      }
    } catch {
      // 网络错误，静默
    }
  }, 5000);
}
