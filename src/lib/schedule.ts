import { Derived, Task } from '../types';
import { addDays, diffDays, maxDate, minDate, today } from './date';

/** 工期（含首尾） */
export function durationOf(t: Task): number {
  return Math.max(1, diffDays(t.startDate, t.dueDate) + 1);
}

export function indexById(tasks: Task[]): Map<string, Task> {
  return new Map(tasks.map((t) => [t.id, t]));
}

export function childrenOf(tasks: Task[], id: string | null): Task[] {
  return tasks.filter((t) => t.parentId === id);
}

export function descendantsOf(tasks: Task[], id: string): Set<string> {
  const out = new Set<string>();
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const t of tasks) {
      if (t.parentId === cur && !out.has(t.id)) {
        out.add(t.id);
        stack.push(t.id);
      }
    }
  }
  return out;
}

/** 拓扑排序：被依赖者在前。返回顺序 + 参与环的任务集合 */
export function topoSort(tasks: Task[]): { order: string[]; cyclic: Set<string> } {
  const ids = tasks.map((t) => t.id);
  const idSet = new Set(ids);
  const indeg = new Map<string, number>();
  const succ = new Map<string, string[]>();
  for (const t of tasks) {
    indeg.set(t.id, 0);
    succ.set(t.id, []);
  }
  for (const t of tasks) {
    for (const dep of t.dependsOn) {
      if (!idSet.has(dep) || dep === t.id) continue;
      succ.get(dep)!.push(t.id);
      indeg.set(t.id, (indeg.get(t.id) ?? 0) + 1);
    }
  }
  const queue = ids.filter((id) => (indeg.get(id) ?? 0) === 0);
  const order: string[] = [];
  while (queue.length) {
    const cur = queue.shift()!;
    order.push(cur);
    for (const s of succ.get(cur) ?? []) {
      const d = (indeg.get(s) ?? 0) - 1;
      indeg.set(s, d);
      if (d === 0) queue.push(s);
    }
  }
  const cyclic = new Set(ids.filter((id) => !order.includes(id)));
  return { order, cyclic };
}

/**
 * 自动顺延：依赖任务未结束前，下游任务不得开始。
 * 拓扑推进，若当前 startDate 早于依赖约束的最早开始日，则整段平移（保持工期）。
 * 返回新数组（未变化的任务保持原引用，便于 React 精确重渲染）。
 */
export function reschedule(input: Task[]): Task[] {
  const map = indexById(input);
  const { order } = topoSort(input);
  const out = input.slice();
  const pos = new Map(out.map((t, i) => [t.id, i]));
  for (const id of order) {
    const i = pos.get(id)!;
    const t = out[i];
    let earliest = t.startDate;
    for (const depId of t.dependsOn) {
      const dep = map.get(depId);
      if (!dep) continue;
      const req = addDays(dep.dueDate, 1);
      if (diffDays(earliest, req) > 0) earliest = req;
    }
    if (earliest !== t.startDate) {
      const dur = durationOf(t);
      out[i] = { ...t, startDate: earliest, dueDate: addDays(earliest, dur - 1) };
      map.set(id, out[i]);
    }
  }
  return out;
}

/** 父任务汇总：日期取子任务并集，进度按工期加权平均（自底向上） */
export function rollUp(input: Task[]): Task[] {
  const out = input.slice();
  const map = indexById(out);
  const kids = new Map<string | null, Task[]>();
  for (const t of out) {
    const arr = kids.get(t.parentId) ?? [];
    arr.push(t);
    kids.set(t.parentId, arr);
  }
  // 按深度从大到小处理
  const depth = new Map<string, number>();
  const getDepth = (id: string, seen: Set<string> = new Set()): number => {
    if (depth.has(id)) return depth.get(id)!;
    if (seen.has(id)) return 0;
    seen.add(id);
    const t = map.get(id);
    if (!t || !t.parentId || !map.has(t.parentId)) {
      depth.set(id, 0);
      return 0;
    }
    const d = getDepth(t.parentId, seen) + 1;
    depth.set(id, d);
    return d;
  };
  out.forEach((t) => getDepth(t.id));
  const sorted = out
    .map((t, i) => ({ i, d: depth.get(t.id) ?? 0 }))
    .sort((a, b) => b.d - a.d);
  for (const { i } of sorted) {
    const t = out[i];
    const list = kids.get(t.id) ?? [];
    if (!list.length) continue;
    let start = list[0].startDate;
    let due = list[0].dueDate;
    let wSum = 0;
    let pSum = 0;
    for (const c of list) {
      start = minDate(start, c.startDate);
      due = maxDate(due, c.dueDate);
      const w = durationOf(c);
      wSum += w;
      pSum += c.progress * w;
    }
    const progress = wSum ? Math.round(pSum / wSum) : t.progress;
    if (t.startDate === start && t.dueDate === due && t.progress === progress) continue;
    out[i] = { ...t, startDate: start, dueDate: due, progress };
  }
  return out;
}

/** 老数据补字段：历史存档里没有 kind / showInCalendar，这里兜底，避免升版本丢数据 */
export function withDefaults(tasks: Task[]): Task[] {
  return tasks.map((t) => {
    const kind = t.kind ?? 'task';
    return {
      ...t,
      dependsOn: t.dependsOn ?? [],
      kind,
      showInCalendar: typeof t.showInCalendar === 'boolean' ? t.showInCalendar : kind === 'task',
    };
  });
}

/** 归一化入口：补默认值 + 顺延 + 汇总，返回稳定结果 */
export function normalize(tasks: Task[]): Task[] {
  let out = reschedule(withDefaults(tasks));
  out = rollUp(out);
  // 汇总后父节点变长可能再次触发依赖顺延，再跑一轮取收敛
  const second = reschedule(out);
  const changed = second.some((t, i) => t.startDate !== out[i].startDate || t.dueDate !== out[i].dueDate);
  if (changed) out = rollUp(second);
  return out;
}

/**
 * 计算派生信息：状态、阻塞、关键路径（CPM）。
 */
export function computeDerived(tasks: Task[], refDay: string = today()): Record<string, Derived> {
  const map = indexById(tasks);
  const { order, cyclic } = topoSort(tasks);
  const dur = new Map<string, number>();
  const es = new Map<string, string>();
  const ef = new Map<string, string>();
  const succ = new Map<string, string[]>();
  const pred = new Map<string, string[]>();

  for (const t of tasks) {
    dur.set(t.id, durationOf(t));
    succ.set(t.id, []);
    pred.set(t.id, []);
  }
  for (const t of tasks) {
    for (const dep of t.dependsOn) {
      if (!map.has(dep) || dep === t.id) continue;
      pred.get(t.id)!.push(dep);
      succ.get(dep)!.push(t.id);
    }
  }

  // 前向：ES / EF（考虑自身计划日期作为下界）
  for (const id of order) {
    const t = map.get(id)!;
    let start = t.startDate;
    for (const dep of pred.get(id)!) {
      const depTask = map.get(dep)!;
      const req = addDays(depTask.dueDate, 1);
      if (diffDays(start, req) > 0) start = req;
    }
    es.set(id, start);
    ef.set(id, addDays(start, dur.get(id)! - 1));
  }
  // 环内任务兜底
  for (const id of cyclic) {
    const t = map.get(id)!;
    es.set(id, t.startDate);
    ef.set(id, t.dueDate);
  }

  let projectEnd = ef.get(order[0]) ?? refDay;
  for (const id of order) projectEnd = maxDate(projectEnd, ef.get(id)!);

  // 后向：LS / LF → 总浮动
  const lf = new Map<string, string>();
  const ls = new Map<string, string>();
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i];
    const s = succ.get(id)!.filter((x) => ls.has(x));
    // 后继的最晚开始日 - 1 天 = 本任务的最晚完成日
    let finish = s.length ? s.reduce((acc, x) => minDate(acc, addDays(ls.get(x)!, -1)), addDays(ls.get(s[0])!, -1)) : projectEnd;
    finish = maxDate(finish, ef.get(id)!);
    lf.set(id, finish);
    ls.set(id, addDays(finish, -(dur.get(id)! - 1)));
  }

  const kids = new Map<string | null, Task[]>();
  for (const t of tasks) {
    const arr = kids.get(t.parentId) ?? [];
    arr.push(t);
    kids.set(t.parentId, arr);
  }
  const depthMap = new Map<string, number>();
  const subtree = new Map<string, number>();
  const walk = (id: string, d: number): number => {
    depthMap.set(id, d);
    let n = 1;
    for (const c of kids.get(id) ?? []) n += walk(c.id, d + 1);
    subtree.set(id, n);
    return n;
  };
  for (const t of tasks) if (t.parentId === null || !map.has(t.parentId)) walk(t.id, 0);

  const res: Record<string, Derived> = {};
  for (const t of tasks) {
    const blockedBy = t.dependsOn.filter((d) => map.has(d) && map.get(d)!.progress < 100);
    const isDone = t.progress >= 100;
    const isBlocked = blockedBy.length > 0 && !isDone;
    const isDelayed = !isDone && diffDays(t.dueDate, refDay) > 0;
    let status: Task['status'];
    if (t.statusLocked) status = t.status;
    else if (isDone) status = 'done';
    else if (isBlocked) status = 'blocked';
    else if (isDelayed) status = 'delayed';
    else if (t.progress > 0) status = 'doing';
    else status = 'todo';

    const slack = ls.has(t.id) && es.has(t.id) ? diffDays(es.get(t.id)!, ls.get(t.id)!) : 0;
    const critical = !cyclic.has(t.id) && slack <= 0 && !isDone && (pred.get(t.id)!.length > 0 || succ.get(t.id)!.length > 0);

    res[t.id] = {
      status,
      isDone,
      isDelayed,
      isBlocked,
      blockedBy,
      earliestStart: es.get(t.id) ?? t.startDate,
      slack,
      critical,
      duration: dur.get(t.id)!,
      depth: depthMap.get(t.id) ?? 0,
      hasChildren: (kids.get(t.id) ?? []).length > 0,
      subtreeSize: subtree.get(t.id) ?? 1,
    };
  }
  return res;
}

/** 关键路径上的依赖边（用于高亮连线） */
export function criticalEdges(tasks: Task[], derived: Record<string, Derived>): Set<string> {
  const out = new Set<string>();
  for (const t of tasks) {
    if (!derived[t.id]?.critical) continue;
    for (const dep of t.dependsOn) {
      if (derived[dep]?.critical) out.add(`${dep}->${t.id}`);
    }
  }
  return out;
}

/** 树形 DFS 顺序（甘特图/侧栏用） */
export function flattenTree(tasks: Task[], collapsed: Record<string, boolean> = {}): Task[] {
  const kids = new Map<string | null, Task[]>();
  for (const t of tasks) {
    const arr = kids.get(t.parentId) ?? [];
    arr.push(t);
    kids.set(t.parentId, arr);
  }
  const byId = new Set(tasks.map((t) => t.id));
  // 父 id 指向不存在节点的，视为顶层
  const pidOf = (t: Task): string | null => (t.parentId && byId.has(t.parentId) ? t.parentId : null);
  if (tasks.some((t) => pidOf(t) !== t.parentId)) {
    kids.clear();
    for (const t of tasks) {
      const key = pidOf(t) ?? '';
      const arr = kids.get(key) ?? [];
      arr.push(t);
      kids.set(key, arr);
    }
  }
  const out: Task[] = [];
  const walk = (pid: string) => {
    const list = kids.get(pid) ?? [];
    // 按开始日期排序，保证甘特图行序稳定
    list.sort((a, b) => (a.startDate === b.startDate ? a.title.localeCompare(b.title) : a.startDate < b.startDate ? -1 : 1));
    for (const t of list) {
      out.push(t);
      if (!collapsed[t.id]) walk(t.id);
    }
  };
  walk('');
  const seen = new Set(out.map((t) => t.id));
  for (const t of tasks) if (!seen.has(t.id)) out.push(t);
  return out;
}
