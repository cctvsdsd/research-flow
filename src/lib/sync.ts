import { useTaskStore } from '../store/useTaskStore';
import { TrashItem, ViewId } from '../types';

/**
 * 网盘同步：把整份数据写成目录里的一个 JSON 文件，丢进 OneDrive / 坚果云 / Dropbox 等
 * 会自动上传到云端，其他设备打开同一目录即拿到最新数据 —— 以此实现跨设备。
 *
 * 实现要点：
 *  - 用 File System Access API 的 showDirectoryPicker 让用户绑一个本地目录（在网盘同步文件夹里）
 *  - 目录句柄存 IndexedDB，下次打开自动重新申请权限，无需重复选
 *  - 任何任务变化（debounce 1.5s）后把整份状态写回文件，文件名恒定，天然"后写覆盖"
 *  - 启动时若已绑定目录，先读文件把内容载入 store —— 等于"拿到别的设备改的最新版"
 *  - 不支持的浏览器（Firefox/Safari/部分内嵌浏览器）降级：UI 提示用「导出/导入」手动同步
 */

const FILE = 'research-flow.json';
const DIR_KEY = 'rf-sync-dir-handle';
const IDB = 'rf-sync-db';
/** 记录本地最后一次写入的数据签名，用于判断本地是否比远端新 */
const SIG_KEY = 'rf-sync-local-sig';
/** 记录本地最后一次写入的版本号，用于跨设备比较新旧 */
const REV_KEY = 'rf-sync-local-rev';

export type SyncStatus = 'unsupported' | 'unbound' | 'syncing' | 'synced' | 'error';

// 目录句柄无法被结构化克隆持久化到 localStorage，只能放 IndexedDB
function openIDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains('kv')) req.result.createObjectStore('kv');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key: string): Promise<unknown> {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readonly');
    const req = tx.objectStore('kv').get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function syncSupported(): boolean {
  return typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type DirHandle = any;

let dir: DirHandle | null = null;
let writeTimer: ReturnType<typeof setTimeout> | null = null;
let watching = false;
let listeners = new Set<(s: SyncStatus) => void>();
let status: SyncStatus = 'unbound';

function emit(s: SyncStatus) {
  status = s;
  listeners.forEach((l) => l(s));
}
export function onSyncStatus(cb: (s: SyncStatus) => void) {
  listeners.add(cb);
  cb(status);
  return () => listeners.delete(cb);
}

function payload() {
  const s = useTaskStore.getState();
  // 版本号：取本地 rev +1，或从 1 开始
  const rev = (Number(lastLocalRev) || 0) + 1;
  lastLocalRev = rev;
  void idbSet(REV_KEY, rev);
  return {
    app: 'research-flow',
    exportedAt: new Date().toISOString(),
    rev,
    tasks: s.tasks,
    collapsed: s.collapsed,
    view: s.view,
    dayWidth: s.dayWidth,
    hideDone: s.hideDone,
    panelOpen: s.panelOpen,
    trash: s.trash,
  };
}

let lastLocalRev: number | null = null;

/**
 * 生成数据指纹：忽略时间戳，只看实际内容。
 * 用来判断"本地数据"和"远端文件数据"哪个更新——
 * 防止新设备空数据覆盖掉远端已同步的数据。
 */
function signature(data: { tasks?: unknown[]; trash?: unknown[]; collapsed?: unknown }): string {
  const t = JSON.stringify(data?.tasks ?? []);
  const r = JSON.stringify(data?.trash ?? []);
  const c = JSON.stringify(data?.collapsed ?? {});
  // 简单长度+前缀，不用完整 hash 也够区分
  return `${t.length}:${t.slice(0, 40)}|${r.length}:${r.slice(0, 40)}|${c.length}`;
}

/** 读远端文件的签名+版本号；文件不存在返回 null */
async function remoteSignature(): Promise<{ sig: string; rev: number; data: Record<string, unknown> | null }> {
  if (!dir) return { sig: '', rev: 0, data: null };
  try {
    const fh = await dir.getFileHandle(FILE, { create: false });
    const f = await fh.getFile();
    const text = await f.text();
    const data = JSON.parse(text);
    const rev = Number(data?.rev) || 0;
    return { sig: signature(data), rev, data };
  } catch {
    return { sig: '', rev: 0, data: null }; // 文件不存在
  }
}

export async function bindDirectory(): Promise<boolean> {
  if (!syncSupported()) return false;
  try {
    const h: DirHandle = await (window as any).showDirectoryPicker({ mode: 'readwrite' });
    const perm = await h.queryPermission?.({ mode: 'readwrite' });
    if (perm !== 'granted') {
      const r = await h.requestPermission({ mode: 'readwrite' });
      if (r !== 'granted') return false;
    }
    dir = h;
    await idbSet(DIR_KEY, h);
    emit('syncing');

    // ★ 核心防覆盖逻辑：比较本地 rev 和远端 rev，谁新用谁的
    const localRev = Number(lastLocalRev) || 0;
    const remote = await remoteSignature();

    if (remote.data && remote.rev > localRev) {
      // 远端版本比本地新 → 拉取远端（远端 rev 写入本地）
      await pull();
    } else if (remote.data && remote.rev < localRev) {
      // 本地比远端新 → 把本地写进去（覆盖远端旧的）
      await flush();
    } else if (remote.data && remote.rev === localRev && remote.sig !== signature(payload())) {
      // rev 一致但内容不同（极端情况）→ 以远端为准，拉取
      await pull();
    } else if (!remote.data) {
      // 远端没有文件（首次绑定空目录）→ 把本地数据写进去
      await flush();
    } else {
      // 完全一致 → 无需操作
      await idbSet(SIG_KEY, remote.sig);
      lastLocalRev = remote.rev;
      await idbSet(REV_KEY, remote.rev);
    }

    emit('synced');
    return true;
  } catch {
    return false; // 用户取消选择
  }
}

export async function unbind(): Promise<void> {
  dir = null;
  await idbSet(DIR_KEY, null);
  stopWatching();
  stopPolling();
  emit('unbound');
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

export async function flush(): Promise<void> {
  if (!dir) return;
  try {
    const p = payload();
    const fh = await dir.getFileHandle(FILE, { create: true });
    const w = await fh.createWritable();
    await w.write(JSON.stringify(p, null, 2));
    await w.close();
    await idbSet(SIG_KEY, signature(p));
    emit('synced');
  } catch {
    emit('error');
  }
}

async function pull(): Promise<void> {
  if (!dir) return;
  try {
    const fh = await dir.getFileHandle(FILE, { create: false });
    const f = await fh.getFile();
    const text = await f.text();
    const data = JSON.parse(text);
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
      await idbSet(SIG_KEY, signature(data));
      // 同步远端 rev 到本地，这样本地改动时 rev 会从远端最新值递增
      const rev = Number(data?.rev) || 0;
      lastLocalRev = rev;
      await idbSet(REV_KEY, rev);
    }
  } catch {
    // 文件还不存在（首次绑定空目录）：忽略，flush 会创建它
  }
}

async function ensurePermission(h: DirHandle): Promise<boolean> {
  try {
    const perm = await h.queryPermission?.({ mode: 'readwrite' });
    if (perm === 'granted') return true;
    const r = await h.requestPermission({ mode: 'readwrite' });
    return r === 'granted';
  } catch {
    return false;
  }
}

let initPromise: Promise<void> | null = null;

export function initSync(): Promise<void> {
  if (!syncSupported()) {
    emit('unsupported');
    return Promise.resolve();
  }
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const h = (await idbGet(DIR_KEY)) as DirHandle | null;
    // 恢复本地 rev
    lastLocalRev = (Number(await idbGet(REV_KEY))) || 0;
    if (!h) {
      emit('unbound');
      return;
    }
    const ok = await ensurePermission(h);
    if (!ok) {
      emit('unbound');
      return;
    }
    dir = h;
    emit('syncing');
    // 启动时也要比较 rev：远端比本地新才拉取
    const remote = await remoteSignature();
    const localRev = Number(lastLocalRev) || 0;
    if (remote.data && remote.rev > localRev) {
      await pull();
    } else if (remote.data && remote.rev < localRev) {
      // 本地比远端新（比如上次写入后网盘没上传完）→ 把本地写回
      await flush();
    }
    startWatching();
    startPolling();
    emit('synced');
  })();
  return initPromise;
}

// 定期轮询：检测网盘是否从云端下载了新版本（别人在另一台设备改了）
let pollTimer: ReturnType<typeof setInterval> | null = null;
function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  let lastSig = '';
  pollTimer = setInterval(async () => {
    if (!dir) return;
    const remote = await remoteSignature();
    if (!remote.data) return;
    const localRev = Number(lastLocalRev) || 0;
    // 远端 rev 比本地大，且签名变了 → 拉取
    if (remote.rev > localRev && remote.sig !== lastSig) {
      lastSig = remote.sig;
      emit('syncing');
      await pull();
      emit('synced');
    } else {
      lastSig = remote.sig;
    }
  }, 5000);
}

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

function stopWatching() {
  watching = false;
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

/** 手动立即同步（按钮调用） */
export function syncNow() {
  if (writeTimer) clearTimeout(writeTimer);
  flush();
}
