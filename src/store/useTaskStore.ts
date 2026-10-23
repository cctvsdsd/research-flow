import { useMemo } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Canvas, DEFAULT_CANVAS_ID, DEFAULT_SETTINGS, DEFAULT_SHOW_IN_CALENDAR, LogEntry, ProgressMode, Settings, Source, Task, TaskKind, TrashItem, ViewId } from '../types';
import { addDaysSafe, diffDaysSafe, maxDateSafe, today } from '../lib/date';
import { childrenOf, descendantsOf, flattenTree, normalize, topoSort } from '../lib/schedule';
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
  /** 节点手动摆放位置：撤销/重做时一并回滚，保证排版改动也能撤销 */
  positions: Record<string, { x: number; y: number }>;
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
  /** 甘特/日历：隐藏「不在日历中显示」的任务 */
  hideNotInCal: boolean;
  /** 每条连线的样式覆盖（key 为 edgeId，如 tree-<childId> / dep-<a>_<b>） */
  edgeStyles: Record<string, { type: 'plain' | 'arrow' | 'dashed'; width: number }>;
  /** 复制粘贴剪贴板：存被选中的任务 id 集合（含选区内部子树） */
  clipboard: { ids: string[]; copyCanvas: string } | null;

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
  /** 批量写入节点位置（拖拽多选时用），会记入撤销栈 */
  setPositions: (entries: Record<string, { x: number; y: number }>, meta: Meta) => void;
  resetLayout: () => void;
  select: (id: string | null) => void;
  setSelection: (ids: string[]) => void;
  toggleCollapse: (id: string) => void;
  /** 批量折叠 / 展开（用于框选后批量操作） */
  bulkCollapse: (ids: string[], collapsed: boolean, meta?: Meta) => void;
  /** 全部折叠 / 全部展开当前画布里有子任务的节点 */
  collapseAll: () => void;
  expandAll: () => void;
  setDayWidth: (w: number) => void;
  setHideDone: (v: boolean) => void;
  setHideNotInCal: (v: boolean) => void;
  setPanelOpen: (v: boolean) => void;
  /** 任务详情面板折叠开关 */
  setPanelCollapsed: (v: boolean) => void;
  /** 设置单条连线样式（id 为 edgeId） */
  setEdgeStyle: (id: string, patch: Partial<{ type: 'plain' | 'arrow' | 'dashed'; width: number }> | null) => void;
  /** 按当前设置把全部连线样式重置为默认 */
  resetEdgeStyles: () => void;

  addTask: (init: Partial<Task> & { parentId?: string | null }, meta: Meta) => string;
  addChild: (parentId: string | null, meta: Meta, kind?: TaskKind) => string;
  updateTask: (id: string, patch: Partial<Task>, meta: Meta) => void;
  removeTask: (id: string, meta: Meta) => void;
  setProgress: (id: string, progress: number, meta: Meta) => void;
  /** 切换单个任务的进度模式（自动汇总 / 自由设定） */
  setProgressMode: (id: string, mode: ProgressMode, meta: Meta) => void;
  /** 批量切换进度模式 */
  bulkProgressMode: (ids: string[], mode: ProgressMode, meta: Meta) => void;
  toggleDone: (id: string, meta: Meta) => void;
  setDates: (id: string, startDate: string | null, dueDate: string | null, meta: Meta) => void;
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
  bulkOwner: (ids: string[], owner: string, meta: Meta) => void;
  bulkRemove: (ids: string[], meta: Meta) => void;
  /** 把选中的任务按当前顺序串成依赖链：前一个完成 → 后一个开始 */
  chainDependencies: (ids: string[], meta: Meta) => void;
  /** 复制当前选中的任务（含选区内部子树）到剪贴板 */
  copyTasks: (ids: string[]) => void;
  /** 粘贴剪贴板内容：重建 id，偏移位置，保持内部层级与依赖，返回新根 id 列表 */
  pasteTasks: (meta: Meta) => string[];

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
    hideNotInCal?: boolean;
    panelOpen?: boolean;
    edgeStyles?: Record<string, { type: 'plain' | 'arrow' | 'dashed'; width: number }>;
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
      (o.progressMode ?? 'auto') !== (t.progressMode ?? 'auto') ||
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
        // 快照同时记下节点位置，这样"拖动节点改排版"也能被撤销/重做还原
        const merged =
          !!meta.coalesce && !!s.lastCoalesce && s.lastCoalesce.key === meta.coalesce && now - s.lastCoalesce.ts < 900;
        const past = merged
          ? s.past
          : [
              ...s.past,
              { tasks: prev, selectedId: s.selectedId, positions: s.positions, label: meta.action },
            ].slice(-UNDO_LIMIT);

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
        hideNotInCal: false,
        edgeStyles: {},
        clipboard: null,
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

        /**
         * 批量写位置并记入撤销栈：拖动节点时用，撤销/重做可还原排版。
         * 整批只在「按下→抬起」结束时提交一次，避免拖拽过程刷屏。
         */
        setPositions: (entries, meta) => {
          const s = get();
          const next = { ...s.positions };
          for (const [id, p] of Object.entries(entries)) next[id] = p;
          set({
            positions: next,
            past: [
              ...s.past,
              { tasks: s.tasks, selectedId: s.selectedId, positions: s.positions, label: meta.action },
            ].slice(-UNDO_LIMIT),
            future: [],
            lastCoalesce: null,
          });
        },

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

        bulkCollapse: (ids, want, meta) => {
          if (!ids.length) return;
          const parentIds = new Set(childrenOf(get().tasks, null).map((t) => t.id));
          for (const t of get().tasks) parentIds.add(t.id);
          const next = { ...get().collapsed };
          // 只有"自己确实有子任务"的节点才值得折叠/展开
          let n = 0;
          for (const id of ids) {
            if (!parentIds.has(id)) continue;
            if (!childrenOf(get().tasks, id).length) continue;
            if (!!next[id] === want) continue;
            next[id] = want;
            n++;
          }
          if (!n) return;
          if (meta) {
            const s = get();
            const entry: LogEntry = {
              id: uid(),
              ts: Date.now(),
              time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
              source: meta.source,
              action: meta.action,
              detail: meta.detail ?? '',
              affected: ids,
            };
            set({ collapsed: next, log: [entry, ...s.log].slice(0, 40) });
          } else {
            set({ collapsed: next });
          }
        },

        collapseAll: () =>
          set((s) => {
            const next: Record<string, boolean> = {};
            for (const t of s.tasks) {
              if (t.canvasId === s.currentCanvasId && childrenOf(s.tasks, t.id).length) next[t.id] = true;
            }
            return { collapsed: next };
          }),

        expandAll: () =>
          set((s) => {
            const next: Record<string, boolean> = {};
            // 保留折叠标记但全部置为展开（false = 展开）
            for (const t of s.tasks) {
              if (t.canvasId === s.currentCanvasId && childrenOf(s.tasks, t.id).length) next[t.id] = false;
            }
            return { collapsed: next };
          }),

        setDayWidth: (w) => set({ dayWidth: Math.min(56, Math.max(8, w)) }),
        setHideDone: (v) => set({ hideDone: v }),
        setHideNotInCal: (v) => set({ hideNotInCal: v }),
        setPanelOpen: (v) => set({ panelOpen: v }),
        setPanelCollapsed: (v) => set((s) => ({ settings: { ...s.settings, panelCollapsed: v } })),
        setEdgeStyle: (id, patch) =>
          set((s) =>
            patch === null
              ? { edgeStyles: Object.fromEntries(Object.entries(s.edgeStyles).filter(([k]) => k !== id)) as typeof s.edgeStyles }
              : {
                  edgeStyles: {
                    ...s.edgeStyles,
                    [id]: { ...(s.edgeStyles[id] ?? { type: 'arrow' as const, width: s.settings.edgeWidth }), ...patch },
                  },
                },
          ),
        resetEdgeStyles: () => set({ edgeStyles: {} }),

        addTask: (init, meta) => {
          const st = get();
          const id = init.id ?? uid();
          const parentId = init.parentId ?? null;
          const tasks = st.tasks;
          const settings = st.settings;
          const kind: TaskKind = init.kind ?? settings.defaultKind;
          // 新计划默认无日期（未排期）；其余沿用传入或默认
          const planNoDate = kind === 'plan' && init.startDate === undefined && init.dueDate === undefined;
          let startDate: string | null;
          let dueDate: string | null;
          if (planNoDate) {
            startDate = null;
            dueDate = null;
          } else {
            const siblings = tasks.filter((t) => t.parentId === parentId);
            let start: string | null = init.startDate ?? today();
            if (!init.startDate && siblings.length) {
              let mx: string | null = start;
              for (const t of siblings) mx = maxDateSafe(mx, addDaysSafe(t.dueDate, 1));
              start = mx;
            }
            if (!init.startDate && parentId) {
              const p = tasks.find((t) => t.id === parentId);
              if (p && p.startDate) start = maxDateSafe(start, p.startDate);
            }
            const dur = init.dueDate ? Math.max(1, diffDaysSafe(start, init.dueDate) + 1) : settings.defaultDuration;
            startDate = start;
            dueDate = init.dueDate ?? addDaysSafe(start, dur - 1);
          }
          const task: Task = {
            id,
            title: init.title ?? (kind === 'plan' ? '新计划' : '新任务'),
            parentId,
            dependsOn: init.dependsOn ?? [],
            startDate,
            dueDate,
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
            progressMode: init.progressMode ?? settings.defaultProgressMode,
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
          const self = tasks.find((t) => t.id === id);
          // 父任务进度由子任务汇总而来，直接勾选父任务时级联到整棵子树
          const kids = descendantsOf(tasks, id);
          // 进度模式为「自动汇总」且自己确有子任务时，进度由子任务决定，不允许手动拖动
          const selfLocked = !!self && (self.progressMode ?? 'auto') === 'auto' && childrenOf(tasks, id).length > 0;
          commit(
            tasks.map((t) => {
              if (kids.has(t.id)) return { ...t, progress: p, statusLocked: p >= 100 ? false : t.statusLocked };
              if (t.id === id) {
                if (selfLocked) return t;
                return { ...t, progress: p, statusLocked: p >= 100 ? false : t.statusLocked };
              }
              return t;
            }),
            meta,
            { selectedId: id },
          );
        },

        setProgressMode: (id, mode, meta) => {
          const tasks = get().tasks;
          commit(
            tasks.map((t) => (t.id === id ? { ...t, progressMode: mode } : t)),
            meta,
            { selectedId: id },
          );
        },

        bulkProgressMode: (ids, mode, meta) => {
          if (!ids.length) return;
          const set2 = new Set(ids);
          const tasks = get().tasks;
          commit(
            tasks.map((t) => (set2.has(t.id) ? { ...t, progressMode: mode } : t)),
            meta,
            { selectedIds: ids, selectedId: ids[ids.length - 1] },
          );
        },

        toggleDone: (id, meta) => {
          const t = get().tasks.find((x) => x.id === id);
          if (!t) return;
          get().setProgress(id, t.progress >= 100 ? 0 : 100, meta);
        },

        setDates: (id, startDate, dueDate, meta) => {
          const tasks = get().tasks;
          // 都为 null → 直接清空；否则若起 > 止，把止改成起（避免负工期）
          let s = startDate;
          let d = dueDate;
          if (s && d && diffDaysSafe(s, d) < 0) d = s;
          commit(tasks.map((t) => (t.id === id ? { ...t, startDate: s, dueDate: d } : t)), meta, { selectedId: id });
        },

        shiftDates: (id, days, meta) => {
          const tasks = get().tasks;
          const move = new Set([id, ...descendantsOf(tasks, id)]);
          commit(
            tasks.map((t) =>
              move.has(t.id)
                ? { ...t, startDate: addDaysSafe(t.startDate, days), dueDate: addDaysSafe(t.dueDate, days) }
                : t,
            ),
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
            tasks.map((t) => (move.has(t.id) ? { ...t, startDate: addDaysSafe(t.startDate, days), dueDate: addDaysSafe(t.dueDate, days) } : t)),
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

        bulkOwner: (ids, owner, meta) => {
          if (!ids.length) return;
          const set2 = new Set(ids);
          const tasks = get().tasks;
          commit(
            tasks.map((t) => (set2.has(t.id) ? { ...t, owner } : t)),
            meta,
            { selectedIds: ids },
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

        copyTasks: (ids) => {
          if (!ids.length) return;
          const tasks = get().tasks;
          const sel = new Set(ids);
          // 选区内部子树：若某节点的祖先都在选区内，则一并复制，保持层级完整
          const byId = new Map(tasks.map((t) => [t.id, t]));
          const include = new Set<string>();
          for (const id of sel) {
            // 沿祖先链向上，若祖先全部在 sel 内则该节点纳入
            let cur = id;
            let ok = true;
            while (true) {
              const t = byId.get(cur);
              if (!t || !t.parentId) break;
              if (sel.has(t.parentId)) cur = t.parentId;
              else {
                ok = false;
                break;
              }
            }
            if (ok && !include.has(id)) include.add(id);
          }
          // 包含选区中节点的后代（仅在选区内的后代）
          for (const t of tasks) {
            if (!include.has(t.id)) continue;
            for (const c of descendantsOf(tasks, t.id)) if (sel.has(c) || include.has(c)) include.add(c);
          }
          set({ clipboard: { ids: [...include], copyCanvas: get().currentCanvasId } });
        },

        pasteTasks: (meta) => {
          const clip = get().clipboard;
          if (!clip) return [];
          const tasks = get().tasks;
          const map = new Map(tasks.map((t) => [t.id, t]));
          const clipSet = new Set(clip.ids);
          const clipTasks = clip.ids.map((id) => map.get(id)).filter(Boolean) as Task[];
          if (!clipTasks.length) return [];
          // 仅保留在剪贴板内的依赖关系；跨边界依赖丢弃
          const newId = (_old: string) => `T${Date.now().toString(36).slice(-5)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;
          const idMap = new Map<string, string>();
          clipTasks.forEach((t) => idMap.set(t.id, newId(t.id)));
          // 计算包围盒以确定偏移
          const xs = clipTasks.map((t) => get().positions[t.id]?.x ?? 0);
          const ys = clipTasks.map((t) => get().positions[t.id]?.y ?? 0);
          const minX = xs.length ? Math.min(...xs) : 0;
          const minY = ys.length ? Math.min(...ys) : 0;
          const OFF = 48;
          const created: Task[] = clipTasks.map((t) => ({
            ...t,
            id: idMap.get(t.id)!,
            parentId: t.parentId && clipSet.has(t.parentId) ? idMap.get(t.parentId)! : t.parentId,
            dependsOn: t.dependsOn.filter((d) => clipSet.has(d)).map((d) => idMap.get(d)!),
            canvasId: get().currentCanvasId,
          }));
          const newPositions: Record<string, { x: number; y: number }> = {};
          clipTasks.forEach((t) => {
            const p = get().positions[t.id];
            newPositions[idMap.get(t.id)!] = p ? { x: p.x - minX + OFF, y: p.y - minY + OFF } : { x: OFF, y: OFF };
          });
          commit([...tasks, ...created], meta, {});
          // 写入新位置（不记入撤销，属于附带信息）
          useTaskStore.setState((s) => ({ positions: { ...s.positions, ...newPositions } }));
          set({ selectedIds: created.map((t) => t.id) });
          return created.map((t) => t.id);
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
            positions: snap.positions ?? s.positions,
            past: s.past.slice(0, -1),
            future: [
              { tasks: s.tasks, selectedId: s.selectedId, positions: s.positions, label: snap.label },
              ...s.future,
            ].slice(0, UNDO_LIMIT),
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
            positions: snap.positions ?? s.positions,
            past: [
              ...s.past,
              { tasks: s.tasks, selectedId: s.selectedId, positions: s.positions, label: snap.label },
            ].slice(-UNDO_LIMIT),
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
            past: [
              ...s.past,
              { tasks: s.tasks, selectedId: s.selectedId, positions: s.positions, label: '彻底删除回收站项' },
            ].slice(-UNDO_LIMIT),
            future: [],
            lastCoalesce: null,
          });
        },

        emptyTrash: () => {
          const s = get();
          if (!s.trash.length) return;
          set({
            trash: [],
            past: [
              ...s.past,
              { tasks: s.tasks, selectedId: s.selectedId, positions: s.positions, label: '清空回收站' },
            ].slice(-UNDO_LIMIT),
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
            hideNotInCal: payload.hideNotInCal ?? false,
            panelOpen: payload.panelOpen ?? false,
            edgeStyles: payload.edgeStyles ?? {},
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
        edgeStyles: s.edgeStyles,
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
