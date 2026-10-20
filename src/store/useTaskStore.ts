import { useMemo } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Canvas, DEFAULT_CANVAS_ID, DEFAULT_SETTINGS, DEFAULT_SHOW_IN_CALENDAR, LogEntry, Settings, Source, Task, TaskKind, TrashItem, ViewId } from '../types';
import { addDays, diffDays, maxDate, today } from '../lib/date';
import { descendantsOf, flattenTree, normalize, topoSort } from '../lib/schedule';
import { blankTasks, sampleTasks } from '../lib/sample';

interface Meta {
  source: Source;
  action: string;
  detail?: string;
  /** 同一 key 的连续操作在 900ms 内合并为一个撤销步（拖拽/滑杆用） */
  coalesce?: string;
}

/** 撤销栈里的一步 */
interface Snapshot {
  tasks: Task[];
  selectedId: string | null;
  /** 触发这一步的动作名，用于「撤销 XXX」提示 */
  label: string;
}

const UNDO_LIMIT = 120;
const TRASH_LIMIT = 60;

interface State {
  tasks: Task[];
  selectedId: string | null;
  /** 框选出来的多选集合（思维导图框选 / 批量操作） */
  selectedIds: string[];
  view: ViewId;
  /** 多画布：画布列表与当前画布 id */
  canvases: Canvas[];
  currentCanvasId: string;
  /** 全局默认参数（设置面板） */
  settings: Settings;
  /** 思维导图节点手动摆放位置（按任务 id），持久化；有则优先于自动布局 */
  positions: Record<string, { x: number; y: number }>;
  collapsed: Record<string, boolean>;
  dayWidth: number;
  log: LogEntry[];
  /** 只显示未完成任务的日历过滤 */
  hideDone: boolean;
  /** 总览（三视图同屏）下的编辑面板是否展开 */
  panelOpen: boolean;

  /** 回收站（软删除的任务树） */
  trash: TrashItem[];
  /** 撤销栈 / 重做栈，仅内存，不持久化 */
  past: Snapshot[];
  future: Snapshot[];
  lastCoalesce: { key: string; ts: number } | null;

  setView: (v: ViewId) => void;
  setCurrentCanvas: (id: string) => void;
  addCanvas: (name: string) => string;
  renameCanvas: (id: string, name: string) => void;
  removeCanvas: (id: string) => void;
  setSettings: (patch: Partial<Settings>) => void;
  setPosition: (id: string, pos: { x: number; y: number }) => void;
  resetLayout: () => void;
  select: (id: string | null) => void;
  setSelection: (ids: string[]) => void;
  toggleCollapse: (id: string) => void;
  setDayWidth: (w: number) => void;
  setHideDone: (v: boolean) => void;
  setPanelOpen: (v: boolean) => void;

  addTask: (init: Partial<Task> & { parentId?: string | null }, meta: Meta) => string;
  addChild: (parentId: string | null, meta: Meta, kind?: TaskKind) => string;
  updateTask: (id: string, patch: Partial<Task>, meta: Meta) => void;
  removeTask: (id: string, meta: Meta) => void;
  setProgress: (id: string, progress: number, meta: Meta) => void;
  toggleDone: (id: string, meta: Meta) => void;
  setDates: (id: string, startDate: string, dueDate: string, meta: Meta) => void;
  shiftDates: (id: string, days: number, meta: Meta) => void;
  setParent: (id: string, parentId: string | null, meta: Meta) => void;
  addDependency: (id: string, depId: string, meta: Meta) => boolean;
  removeDependency: (id: string, depId: string, meta: Meta) => void;
  setStatusLock: (id: string, status: Task['status'] | null, meta: Meta) => void;
  /** 切换 计划 / 任务（会按类型重置日历默认值，之后仍可单独改显隐） */
  setKind: (id: string, kind: TaskKind, meta: Meta) => void;
  bulkKind: (ids: string[], kind: TaskKind, meta: Meta) => void;
  /** 单独控制「是否在日历显示」——与完成状态无关 */
  toggleCalendar: (id: string, meta: Meta) => void;
  bulkCalendar: (ids: string[], show: boolean, meta: Meta) => void;

  /** 批量操作：一次 commit，避免刷出一堆联动日志 */
  bulkProgress: (ids: string[], progress: number, meta: Meta) => void;
  bulkShift: (ids: string[], days: number, meta: Meta) => void;
  bulkStatus: (ids: string[], status: Task['status'] | null, meta: Meta) => void;
  bulkRemove: (ids: string[], meta: Meta) => void;
  /** 把选中的任务按当前顺序串成依赖链：前一个完成 → 后一个开始 */
  chainDependencies: (ids: string[], meta: Meta) => void;

  undo: () => void;
  redo: () => void;

  restoreTrash: (trashId: string) => void;
  purgeTrash: (trashId: string) => void;
  emptyTrash: () => void;

  resetSample: () => void;
  clearAll: () => void;
  importTasks: (tasks: Task[], canvasId?: string) => void;
  /** 从同步文件整份载入（保留日历显隐、回收站、视图等所有持久化字段） */
  loadSync: (payload: {
    tasks: Task[];
    collapsed?: Record<string, boolean>;
    view?: ViewId;
    dayWidth?: number;
    hideDone?: boolean;
    panelOpen?: boolean;
    trash?: TrashItem[];
    canvases?: Canvas[];
    currentCanvasId?: string;
    settings?: Partial<Settings>;
    positions?: Record<string, { x: number; y: number }>;
  }) => void;
}

let seq = 0;
const uid = () => `T${Date.now().toString(36).slice(-5)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/** 比较两次任务数组，找出真正发生变化的任务 id（联动证据） */
function changedIds(before: Task[], after: Task[]): string[] {
  const b = new Map(before.map((t) => [t.id, t]));
  const a = new Map(after.map((t) => [t.id, t]));
  const ids = new Set<string>();
  for (const [id, t] of a) {
    const o = b.get(id);
    if (!o) {
      ids.add(id);
      continue;
    }
    if (
      o.title !== t.title ||
      o.startDate !== t.startDate ||
      o.dueDate !== t.dueDate ||
      o.startTime !== t.startTime ||
      o.endTime !== t.endTime ||
      o.progress !== t.progress ||
      o.parentId !== t.parentId ||
      o.status !== t.status ||
      o.owner !== t.owner ||
      o.note !== t.note ||
      o.kind !== t.kind ||
      o.showInCalendar !== t.showInCalendar ||
      o.canvasId !== t.canvasId ||
      o.dependsOn.join(',') !== t.dependsOn.join(',')
    ) {
      ids.add(id);
    }
  }
  for (const id of b.keys()) if (!a.has(id)) ids.add(id);
  return [...ids];
}

/** 给缺失 canvasId 的任务补上画布 id（旧数据 / 示例迁移用） */
function withCanvas(tasks: Task[], canvasId: string): Task[] {
  return tasks.map((t) => (t.canvasId ? t : { ...t, canvasId }));
}

/** 把任意来源的任务数组 + 配套字段，迁移到当前多画布结构（缺啥补啥） */
function migratePayload(input: {
  tasks?: Task[];
  canvases?: Canvas[];
  currentCanvasId?: string;
  settings?: Partial<Settings>;
  positions?: Record<string, { x: number; y: number }>;
}): {
  tasks: Task[];
  canvases: Canvas[];
  currentCanvasId: string;
  settings: Settings;
  positions: Record<string, { x: number; y: number }>;
} {
  const rawTasks = input.tasks ?? [];
  let canvases = input.canvases && input.canvases.length ? input.canvases : [{ id: DEFAULT_CANVAS_ID, name: '画布 1' }];
  // 旧数据没有画布：把所有任务归入默认画布
  const hasCanvas = rawTasks.some((t) => t.canvasId);
  const tasks = hasCanvas ? withCanvas(rawTasks, DEFAULT_CANVAS_ID) : withCanvas(rawTasks, canvases[0].id);
  const ids = new Set(canvases.map((c) => c.id));
  if (!ids.has(DEFAULT_CANVAS_ID)) canvases = [{ id: DEFAULT_CANVAS_ID, name: '画布 1' }, ...canvases];
  const currentCanvasId = input.currentCanvasId && ids.has(input.currentCanvasId) ? input.currentCanvasId : canvases[0].id;
  const settings = { ...DEFAULT_SETTINGS, ...(input.settings ?? {}) };
  const positions = input.positions ?? {};
  return { tasks, canvases, currentCanvasId, settings, positions };
}

export const useTaskStore = create<State>()(
  persist(
    (set, get) => {
      /** 所有写操作的统一出口：归一化 + 撤销快照 + 联动日志 */
      const commit = (next: Task[], meta: Meta, extra?: Partial<State>) => {
        const s = get();
        const prev = s.tasks;
        const normalized = normalize(next);
        const affected = changedIds(prev, normalized);
        const now = Date.now();
        const entry: LogEntry = {
          id: uid(),
          ts: now,
          time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
          source: meta.source,
          action: meta.action,
          detail: meta.detail ?? '',
          affected,
        };
        const log = s.log;
        const last = log[0];
        // 连续拖拽会产生大量同构操作，合并为一条，避免日志刷屏
        let nextLog: LogEntry[];
        if (
          last &&
          last.source === meta.source &&
          last.action === meta.action &&
          last.detail === meta.detail &&
          now - last.ts < 900
        ) {
          nextLog = [{ ...entry, id: last.id, affected: [...new Set([...last.affected, ...affected])] }, ...log.slice(1)];
        } else {
          nextLog = [entry, ...log].slice(0, 40);
        }

        // 撤销步：同一 coalesce key 在 900ms 内视为一次连续操作，只保留拖动前的那一步
        const merged =
          !!meta.coalesce && !!s.lastCoalesce && s.lastCoalesce.key === meta.coalesce && now - s.lastCoalesce.ts < 900;
        const past = merged
          ? s.past
          : [...s.past, { tasks: prev, selectedId: s.selectedId, label: meta.action }].slice(-UNDO_LIMIT);

        set({
          tasks: normalized,
          log: nextLog,
          past,
          future: [],
          lastCoalesce: meta.coalesce ? { key: meta.coalesce, ts: now } : null,
          ...extra,
        });
      };

      /** 把一批任务移入回收站：保留整棵子树、父链接与来自外部的依赖引用 */
      const trashBatch = (rootIds: string[], meta: Meta, reason: string) => {
        const s = get();
        const tasks = s.tasks;
        const doomed = new Set<string>();
        for (const id of rootIds) {
          doomed.add(id);
          for (const k of descendantsOf(tasks, id)) doomed.add(k);
        }
        if (!doomed.size) return;
        const removed = tasks.filter((t) => doomed.has(t.id));
        const kept = tasks.filter((t) => !doomed.has(t.id));
        const externalDeps: { ownerId: string; depId: string }[] = [];
        const next = kept.map((t) => {
          const lost = t.dependsOn.filter((d) => doomed.has(d));
          if (!lost.length) return t;
          for (const depId of lost) externalDeps.push({ ownerId: t.id, depId });
          return { ...t, dependsOn: t.dependsOn.filter((d) => !doomed.has(d)) };
        });
        const item: TrashItem = {
          id: uid(),
          ts: Date.now(),
          time: new Date().toLocaleString('zh-CN', { hour12: false }),
          reason,
          tasks: removed,
          rootIds: rootIds.filter((id) => doomed.has(id)),
          parentLinks: Object.fromEntries(removed.map((t) => [t.id, t.parentId])),
          externalDeps,
        };
        commit(next, meta, {
          selectedId: null,
          selectedIds: [],
          trash: [item, ...s.trash].slice(0, TRASH_LIMIT),
        });
      };

      return {
        tasks: withCanvas(normalize(blankTasks()), DEFAULT_CANVAS_ID),
        selectedId: 'ROOT',
        selectedIds: ['ROOT'],
        view: 'all',
        canvases: [{ id: DEFAULT_CANVAS_ID, name: '画布 1' }],
        currentCanvasId: DEFAULT_CANVAS_ID,
        settings: DEFAULT_SETTINGS,
        positions: {},
        collapsed: {},
        dayWidth: 22,
        log: [],
        hideDone: false,
        panelOpen: false,
        trash: [],
        past: [],
        future: [],
        lastCoalesce: null,

        setView: (v) => set({ view: v }),

        setCurrentCanvas: (id) =>
          set((s) => (s.canvases.some((c) => c.id === id) ? { currentCanvasId: id, selectedId: null, selectedIds: [] } : {})),

        addCanvas: (name) => {
          const id = `cv${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
          set((s) => ({
            canvases: [...s.canvases, { id, name: name.trim() || `画布 ${s.canvases.length + 1}` }],
            currentCanvasId: id,
            selectedId: null,
            selectedIds: [],
          }));
          return id;
        },

        renameCanvas: (id, name) =>
          set((s) => ({ canvases: s.canvases.map((c) => (c.id === id ? { ...c, name: name.trim() || c.name } : c)) })),

        removeCanvas: (id) => {
          const s = get();
          if (s.canvases.length <= 1) return; // 至少保留一个画布
          const doomed = new Set(s.tasks.filter((t) => t.canvasId === id).map((t) => t.id));
          if (doomed.size) trashBatch([...doomed], { source: 'system', action: '删除画布（数据入回收站）', detail: s.canvases.find((c) => c.id === id)?.name ?? id }, `画布「${s.canvases.find((c) => c.id === id)?.name ?? id}」`);
          const canvases = s.canvases.filter((c) => c.id !== id);
          const currentCanvasId = s.currentCanvasId === id ? canvases[0].id : s.currentCanvasId;
          const positions = { ...s.positions };
          for (const k of Object.keys(positions)) if (doomed.has(k)) delete positions[k];
          set({ canvases, currentCanvasId, positions, selectedId: null, selectedIds: [] });
        },

        setSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),

        setPosition: (id, pos) => set((s) => ({ positions: { ...s.positions, [id]: pos } })),

        resetLayout: () =>
          set((s) => {
            const keep = { ...s.positions };
            for (const t of s.tasks) if (t.canvasId === s.currentCanvasId) delete keep[t.id];
            return { positions: keep };
          }),

        select: (id) => {
          const s = get();
          const next = id ? [id] : [];
          const same = s.selectedIds.length === next.length && next.every((x, i) => s.selectedIds[i] === x);
          if (same && s.selectedId === id) return;
          set({ selectedId: id, selectedIds: next });
        },
        setSelection: (ids) => {
          // 内容相同就不写 store：否则与思维导图重建节点形成无限回环
          const s = get();
          const same = s.selectedIds.length === ids.length && ids.every((x, i) => s.selectedIds[i] === x);
          if (same) return;
          set({ selectedIds: ids, selectedId: ids.length ? ids[ids.length - 1] : null });
        },
        toggleCollapse: (id) => set((s) => ({ collapsed: { ...s.collapsed, [id]: !s.collapsed[id] } })),
        setDayWidth: (w) => set({ dayWidth: Math.min(56, Math.max(8, w)) }),
        setHideDone: (v) => set({ hideDone: v }),
        setPanelOpen: (v) => set({ panelOpen: v }),

        addTask: (init, meta) => {
          const st = get();
          const id = init.id ?? uid();
          const parentId = init.parentId ?? null;
          const tasks = st.tasks;
          const settings = st.settings;
          const siblings = tasks.filter((t) => t.parentId === parentId);
          let start = init.startDate ?? today();
          if (!init.startDate && siblings.length) {
            start = maxDate(start, siblings.reduce((acc, t) => maxDate(acc, addDays(t.dueDate, 1)), start));
          }
          if (!init.startDate && parentId) {
            const p = tasks.find((t) => t.id === parentId);
            if (p) start = maxDate(start, p.startDate);
          }
          const dur = init.dueDate ? Math.max(1, diffDays(start, init.dueDate) + 1) : settings.defaultDuration;
          const kind: TaskKind = init.kind ?? settings.defaultKind;
          const task: Task = {
            id,
            title: init.title ?? (kind === 'plan' ? '新计划' : '新任务'),
            parentId,
            dependsOn: init.dependsOn ?? [],
            startDate: start,
            dueDate: init.dueDate ?? addDays(start, dur - 1),
            startTime: init.startTime ?? '',
            endTime: init.endTime ?? '',
            progress: init.progress ?? 0,
            status: init.status ?? 'todo',
            owner: init.owner ?? '',
            note: init.note ?? '',
            statusLocked: false,
            kind,
            showInCalendar: init.showInCalendar ?? (kind === 'plan' ? false : settings.defaultInCalendar),
            canvasId: st.currentCanvasId,
          };
          commit([...tasks, task], meta, { selectedId: id });
          return id;
        },

        addChild: (parentId, meta, kind) => get().addTask({ parentId, kind: kind ?? get().settings.defaultKind }, meta),

        updateTask: (id, patch, meta) => {
          const tasks = get().tasks;
          commit(tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)), meta, { selectedId: id });
        },

        removeTask: (id, meta) => {
          trashBatch([id], meta, `${meta.action}：${meta.detail ?? ''}`);
        },

        setProgress: (id, progress, meta) => {
          const p = Math.round(Math.min(100, Math.max(0, progress)));
          const tasks = get().tasks;
          // 父任务进度由子任务汇总而来，直接勾选父任务时级联到整棵子树
          const kids = descendantsOf(tasks, id);
          commit(
            tasks.map((t) =>
              t.id === id || kids.has(t.id) ? { ...t, progress: p, statusLocked: p >= 100 ? false : t.statusLocked } : t,
            ),
            meta,
            { selectedId: id },
          );
        },

        toggleDone: (id, meta) => {
          const t = get().tasks.find((x) => x.id === id);
          if (!t) return;
          get().setProgress(id, t.progress >= 100 ? 0 : 100, meta);
        },

        setDates: (id, startDate, dueDate, meta) => {
          const tasks = get().tasks;
          const safe = diffDays(startDate, dueDate) < 0 ? startDate : dueDate;
          commit(tasks.map((t) => (t.id === id ? { ...t, startDate, dueDate: safe } : t)), meta, { selectedId: id });
        },

        shiftDates: (id, days, meta) => {
          const tasks = get().tasks;
          const move = new Set([id, ...descendantsOf(tasks, id)]);
          commit(
            tasks.map((t) => (move.has(t.id) ? { ...t, startDate: addDays(t.startDate, days), dueDate: addDays(t.dueDate, days) } : t)),
            meta,
            { selectedId: id },
          );
        },

        setParent: (id, parentId, meta) => {
          const tasks = get().tasks;
          if (id === parentId) return;
          if (parentId && descendantsOf(tasks, id).has(parentId)) return; // 不能挂到自己的后代
          commit(tasks.map((t) => (t.id === id ? { ...t, parentId } : t)), meta, { selectedId: id });
        },

        addDependency: (id, depId, meta) => {
          const tasks = get().tasks;
          if (id === depId) return false;
          const probe = tasks.map((t) => (t.id === id && !t.dependsOn.includes(depId) ? { ...t, dependsOn: [...t.dependsOn, depId] } : t));
          if (topoSort(probe).cyclic.size > 0) return false; // 环：拒绝
          commit(probe, meta, { selectedId: id });
          return true;
        },

        removeDependency: (id, depId, meta) => {
          const tasks = get().tasks;
          commit(tasks.map((t) => (t.id === id ? { ...t, dependsOn: t.dependsOn.filter((d) => d !== depId) } : t)), meta, { selectedId: id });
        },

        setStatusLock: (id, status, meta) => {
          const tasks = get().tasks;
          commit(
            tasks.map((t) => (t.id === id ? { ...t, statusLocked: status !== null, status: status ?? t.status } : t)),
            meta,
            { selectedId: id },
          );
        },

        setKind: (id, kind, meta) => {
          const tasks = get().tasks;
          commit(
            tasks.map((t) => (t.id === id ? { ...t, kind, showInCalendar: DEFAULT_SHOW_IN_CALENDAR[kind] } : t)),
            meta,
            { selectedId: id },
          );
        },

        bulkKind: (ids, kind, meta) => {
          if (!ids.length) return;
          const set2 = new Set(ids);
          const tasks = get().tasks;
          commit(
            tasks.map((t) => (set2.has(t.id) ? { ...t, kind, showInCalendar: DEFAULT_SHOW_IN_CALENDAR[kind] } : t)),
            meta,
            { selectedIds: ids, selectedId: ids[ids.length - 1] },
          );
        },

        toggleCalendar: (id, meta) => {
          const tasks = get().tasks;
          const t = tasks.find((x) => x.id === id);
          if (!t) return;
          commit(tasks.map((x) => (x.id === id ? { ...x, showInCalendar: !x.showInCalendar } : x)), meta, { selectedId: id });
        },

        bulkCalendar: (ids, show, meta) => {
          if (!ids.length) return;
          const set2 = new Set(ids);
          const tasks = get().tasks;
          commit(tasks.map((t) => (set2.has(t.id) ? { ...t, showInCalendar: show } : t)), meta, {
            selectedIds: ids,
            selectedId: ids[ids.length - 1],
          });
        },

        bulkProgress: (ids, progress, meta) => {
          if (!ids.length) return;
          const p = Math.round(Math.min(100, Math.max(0, progress)));
          const tasks = get().tasks;
          const all = new Set<string>();
          for (const id of ids) {
            all.add(id);
            for (const k of descendantsOf(tasks, id)) all.add(k);
          }
          commit(
            tasks.map((t) => (all.has(t.id) ? { ...t, progress: p, statusLocked: p >= 100 ? false : t.statusLocked } : t)),
            meta,
            { selectedIds: ids, selectedId: ids[ids.length - 1] },
          );
        },

        bulkShift: (ids, days, meta) => {
          if (!ids.length || !days) return;
          const tasks = get().tasks;
          const move = new Set<string>();
          for (const id of ids) {
            move.add(id);
            for (const k of descendantsOf(tasks, id)) move.add(k);
          }
          commit(
            tasks.map((t) => (move.has(t.id) ? { ...t, startDate: addDays(t.startDate, days), dueDate: addDays(t.dueDate, days) } : t)),
            meta,
            { selectedIds: ids, selectedId: ids[ids.length - 1] },
          );
        },

        bulkStatus: (ids, status, meta) => {
          if (!ids.length) return;
          const set2 = new Set(ids);
          const tasks = get().tasks;
          commit(
            tasks.map((t) => (set2.has(t.id) ? { ...t, statusLocked: status !== null, status: status ?? t.status } : t)),
            meta,
            { selectedIds: ids, selectedId: ids[ids.length - 1] },
          );
        },

        bulkRemove: (ids, meta) => {
          if (!ids.length) return;
          trashBatch(ids, meta, `${meta.action}：${meta.detail ?? ''}`);
        },

        chainDependencies: (ids, meta) => {
          if (ids.length < 2) return;
          const tasks = get().tasks;
          // 按甘特行序（树序）串联，保证顺序与视觉一致
          const order = flattenTree(tasks, {});
          const idx = new Map(order.map((t, i) => [t.id, i]));
          const sorted = [...ids].sort((a, b) => (idx.get(a) ?? 9999) - (idx.get(b) ?? 9999));
          let next = tasks;
          let linked = 0;
          for (let i = 1; i < sorted.length; i++) {
            const from = sorted[i - 1];
            const to = sorted[i];
            const t = next.find((x) => x.id === to);
            if (!t || t.dependsOn.includes(from)) continue;
            const probe = next.map((x) => (x.id === to ? { ...x, dependsOn: [...x.dependsOn, from] } : x));
            if (topoSort(probe).cyclic.size > 0) continue; // 会成环，跳过这一对
            next = probe;
            linked++;
          }
          if (!linked) return;
          commit(next, meta, { selectedIds: sorted, selectedId: sorted[sorted.length - 1] });
        },

        undo: () => {
          const s = get();
          if (!s.past.length) return;
          const snap = s.past[s.past.length - 1];
          const entry: LogEntry = {
            id: uid(),
            ts: Date.now(),
            time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
            source: 'system',
            action: '撤销',
            detail: snap.label,
            affected: changedIds(s.tasks, snap.tasks),
          };
          set({
            tasks: snap.tasks,
            selectedId: snap.selectedId ?? s.selectedId,
            past: s.past.slice(0, -1),
            future: [{ tasks: s.tasks, selectedId: s.selectedId, label: snap.label }, ...s.future].slice(0, UNDO_LIMIT),
            log: [entry, ...s.log].slice(0, 40),
            lastCoalesce: null,
          });
        },

        redo: () => {
          const s = get();
          if (!s.future.length) return;
          const snap = s.future[0];
          const entry: LogEntry = {
            id: uid(),
            ts: Date.now(),
            time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
            source: 'system',
            action: '重做',
            detail: snap.label,
            affected: changedIds(s.tasks, snap.tasks),
          };
          set({
            tasks: snap.tasks,
            selectedId: snap.selectedId ?? s.selectedId,
            past: [...s.past, { tasks: s.tasks, selectedId: s.selectedId, label: snap.label }].slice(-UNDO_LIMIT),
            future: s.future.slice(1),
            log: [entry, ...s.log].slice(0, 40),
            lastCoalesce: null,
          });
        },

        restoreTrash: (trashId) => {
          const s = get();
          const item = s.trash.find((x) => x.id === trashId);
          if (!item) return;
          const existing = new Set(s.tasks.map((t) => t.id));
          const restored = item.tasks
            .filter((t) => !existing.has(t.id))
            .map((t) => ({ ...t, parentId: item.parentLinks[t.id] ?? t.parentId }));
          if (!restored.length) {
            set({ trash: s.trash.filter((x) => x.id !== trashId) });
            return;
          }
          let next = [...s.tasks, ...restored];
          const idSet = new Set(next.map((t) => t.id));
          // 补回「留存任务 → 被删任务」的依赖引用
          for (const { ownerId, depId } of item.externalDeps) {
            if (!idSet.has(depId)) continue;
            next = next.map((t) =>
              t.id === ownerId && !t.dependsOn.includes(depId) ? { ...t, dependsOn: [...t.dependsOn, depId] } : t,
            );
          }
          const rootId = item.rootIds[0] ?? restored[0]?.id ?? null;
          commit(next, { source: 'system', action: '从回收站还原', detail: item.reason }, {
            trash: s.trash.filter((x) => x.id !== trashId),
            selectedId: rootId,
            selectedIds: rootId ? [rootId] : [],
          });
        },

        purgeTrash: (trashId) => {
          const s = get();
          set({
            trash: s.trash.filter((x) => x.id !== trashId),
            past: [...s.past, { tasks: s.tasks, selectedId: s.selectedId, label: '彻底删除回收站项' }].slice(-UNDO_LIMIT),
            future: [],
            lastCoalesce: null,
          });
        },

        emptyTrash: () => {
          const s = get();
          if (!s.trash.length) return;
          set({
            trash: [],
            past: [...s.past, { tasks: s.tasks, selectedId: s.selectedId, label: '清空回收站' }].slice(-UNDO_LIMIT),
            future: [],
            lastCoalesce: null,
          });
        },

        // 载入示例 / 清空都会覆盖现有数据 —— 先整份送进回收站，误点了还能捞回来
        resetSample: () => {
          const cid = get().currentCanvasId;
          const roots = get().tasks.filter((t) => !t.parentId && t.canvasId === cid).map((t) => t.id);
          if (roots.length) {
            const count = get().tasks.filter((t) => t.canvasId === cid).length;
            trashBatch(roots, { source: 'system', action: '载入示例（旧数据入回收站）', detail: `${count} 项` }, '载入示例前的原有数据');
          }
          commit(
            sampleTasks().map((t) => ({ ...t, canvasId: cid })),
            { source: 'system', action: '载入示例', detail: '示例课题' },
            {
              selectedId: 'P',
              selectedIds: ['P'],
              collapsed: {},
            },
          );
        },
        clearAll: () => {
          const cid = get().currentCanvasId;
          const roots = get().tasks.filter((t) => !t.parentId && t.canvasId === cid).map((t) => t.id);
          if (!roots.length) return;
          const count = get().tasks.filter((t) => t.canvasId === cid).length;
          trashBatch(roots, { source: 'system', action: '清空全部', detail: `${count} 项已移入回收站` }, '清空全部');
          set({ collapsed: {}, selectedId: null, selectedIds: [] });
        },
        importTasks: (input, canvasId) => {
          const cid = canvasId ?? get().currentCanvasId;
          const incoming = input.map((t) => ({ ...t, canvasId: cid }));
          const existing = get().tasks.filter((t) => t.canvasId !== cid);
          commit([...existing, ...incoming], { source: 'system', action: '导入 JSON', detail: `${incoming.length} 项（当前画布）` }, {
            selectedId: null,
            selectedIds: [],
          });
        },
        loadSync: (payload) => {
          const m = migratePayload(payload);
          commit(m.tasks, { source: 'system', action: '从同步文件载入', detail: `${m.tasks.length} 项` }, {
            canvases: m.canvases,
            currentCanvasId: m.currentCanvasId,
            settings: m.settings,
            positions: m.positions,
            collapsed: payload.collapsed ?? {},
            view: payload.view ?? 'all',
            dayWidth: payload.dayWidth ?? 22,
            hideDone: payload.hideDone ?? false,
            panelOpen: payload.panelOpen ?? false,
            trash: payload.trash ?? [],
            selectedId: null,
            selectedIds: [],
          });
        },
      };
    },
    {
      name: 'researchflow-v2',
      version: 2,
      partialize: (s) => ({
        tasks: s.tasks,
        collapsed: s.collapsed,
        view: s.view,
        dayWidth: s.dayWidth,
        hideDone: s.hideDone,
        panelOpen: s.panelOpen,
        trash: s.trash,
        canvases: s.canvases,
        currentCanvasId: s.currentCanvasId,
        settings: s.settings,
        positions: s.positions,
      }),
      onRehydrateStorage: () => (state) => {
        if (state?.tasks?.length) {
          // 旧存档没有 canvasId → 全部归入默认画布，保证升级不丢数据
          state.tasks = normalize(withCanvas(state.tasks, DEFAULT_CANVAS_ID));
        }
      },
    },
  ),
);

/** 只返回「当前画布」的任务（多画布隔离），供各视图消费 */
export function useCanvasTasks(): Task[] {
  const tasks = useTaskStore((s) => s.tasks);
  const cid = useTaskStore((s) => s.currentCanvasId);
  return useMemo(() => tasks.filter((t) => t.canvasId === cid), [tasks, cid]);
}
