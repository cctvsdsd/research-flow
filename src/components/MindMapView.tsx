import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  Edge,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  Node,
  NodeProps,
  OnNodeDrag,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Derived, STATUS_COLOR, Task, ViewId } from '../types';
import { useCanvasTasks, useTaskStore } from '../store/useTaskStore';
import { NODE_H, NODE_W, treeLayout } from '../lib/layout';
import { descendantsOf } from '../lib/schedule';
import { formatCN } from '../lib/date';
import ContextMenu, { MenuEntry } from './ContextMenu';

export type TaskNodeData = {
  task: Task;
  derived: Derived;
  collapsed: boolean;
  hiddenCount: number;
  multi: boolean;
  /** 由右键菜单触发的「重命名」请求 */
  rename?: boolean;
  onRenameDone?: () => void;
};
export type TaskFlowNode = Node<TaskNodeData, 'task'>;

function TaskNodeCard({ id, data, selected }: NodeProps<TaskFlowNode>) {
  const { task, derived } = data;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(task.title);
  const [dateOpen, setDateOpen] = useState(false);
  /** 连接菜单：null 关闭；'new' 直接创建；'link' 选已有节点 */
  const [connect, setConnect] = useState<null | 'new' | 'link'>(null);
  const [linkTarget, setLinkTarget] = useState('');
  const addChild = useTaskStore((s) => s.addChild);
  const removeTask = useTaskStore((s) => s.removeTask);
  const toggleCollapse = useTaskStore((s) => s.toggleCollapse);
  const updateTask = useTaskStore((s) => s.updateTask);
  const setDates = useTaskStore((s) => s.setDates);
  const select = useTaskStore((s) => s.select);
  const addDependency = useTaskStore((s) => s.addDependency);
  const color = STATUS_COLOR[derived.status];

  useEffect(() => setDraft(task.title), [task.title]);
  useEffect(() => {
    if (data.rename) setEditing(true);
  }, [data.rename]);

  const commitTitle = () => {
    setEditing(false);
    data.onRenameDone?.();
    const v = draft.trim();
    if (v && v !== task.title) updateTask(id, { title: v }, { source: 'mind', action: '重命名节点', detail: v });
  };

  /** 连接菜单里的候选节点：排除自己与自己的整棵子树，避免成环 */
  const tasksForLink = useTaskStore((s) => s.tasks);
  const linkCandidates = useMemo(() => {
    const self = tasksForLink.find((t) => t.id === id);
    if (!self) return [] as Task[];
    const banned = new Set<string>([id, ...descendantsOf(tasksForLink, id)]);
    return tasksForLink.filter((t) => t.canvasId === self.canvasId && !banned.has(t.id));
  }, [tasksForLink, id]);

  /** 在此节点下创建一个新节点（用于"创建新节点"选项） */
  const createAndLink = () => {
    addChild(id, { source: 'mind', action: '创建子节点', detail: `挂在「${task.title}」下` });
    setConnect(null);
  };

  /** 把当前节点链接到已有节点：建立依赖（已有节点 → 当前节点） */
  const linkTo = (targetId: string) => {
    if (!targetId) return;
    const target = linkCandidates.find((t) => t.id === targetId);
    const ok = addDependency(id, targetId, {
      source: 'mind',
      action: '链接节点',
      detail: target ? `「${target.title}」完成后才能开始「${task.title}」` : targetId,
    });
    setConnect(null);
    setLinkTarget('');
    if (!ok) alert('该链接会形成循环，已忽略');
  };

  return (
    <div
      className={`node${selected ? ' selected' : ''}${data.multi ? ' multi' : ''}${derived.critical ? ' critical' : ''}${derived.isDelayed ? ' delayed' : ''}${task.kind === 'plan' ? ' is-plan' : ''}`}
      style={{ borderLeftColor: color }}
      onClick={() => select(id)}
    >
      <Handle type="target" position={Position.Left} id="t" />
      <Handle type="source" position={Position.Right} id="s" />

      <div className="node-actions">
        <button title="新增子任务" onClick={(e) => { e.stopPropagation(); addChild(id, { source: 'mind', action: '思维导图新增子任务', detail: `挂在「${task.title}」下` }); }}>
          +
        </button>
        <button title="新增子计划（默认不进日历）" className="subplan" onClick={(e) => { e.stopPropagation(); addChild(id, { source: 'mind', action: '思维导图新增子计划', detail: `挂在「${task.title}」下` }, 'plan'); }}>
          ⊕
        </button>
        <button title="连接：创建新节点 或 链接已有节点" className="linkbtn" onClick={(e) => { e.stopPropagation(); setConnect((v) => (v ? null : 'new')); }}>
          ⇢
        </button>
        <button title="删除节点（含子任务）" onClick={(e) => { e.stopPropagation(); removeTask(id, { source: 'mind', action: '删除节点', detail: task.title }); }}>
          ×
        </button>
      </div>

      {connect && (
        <div className="nodrag node-connect-menu" onClick={(e) => e.stopPropagation()}>
          <div className="node-connect-title">从此节点「{task.title}」</div>
          {connect === 'new' ? (
            <>
              <button className="primary" onClick={createAndLink}>＋ 创建新节点（作为子任务）</button>
              <button onClick={() => setConnect('link')}>⇢ 链接到已有节点…</button>
              <button className="ghost" onClick={() => setConnect(null)}>取消</button>
            </>
          ) : (
            <>
              <select
                value={linkTarget}
                onChange={(e) => setLinkTarget(e.target.value)}
                onClick={(e) => e.stopPropagation()}
              >
                <option value="">选择要链接的节点…</option>
                {linkCandidates.map((t) => (
                  <option key={t.id} value={t.id}>{t.title}</option>
                ))}
              </select>
              <div className="node-connect-row">
                <button className="primary" disabled={!linkTarget} onClick={() => linkTo(linkTarget)}>建立链接</button>
                <button className="ghost" onClick={() => { setConnect('new'); setLinkTarget(''); }}>‹ 返回</button>
              </div>
            </>
          )}
        </div>
      )}

      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitTitle();
            if (e.key === 'Escape') { setDraft(task.title); setEditing(false); }
          }}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <div className="node-title" onDoubleClick={(e) => { e.stopPropagation(); setEditing(true); }}>
          {task.kind === 'plan' && <span className="node-kind-pill">计划</span>}
          {task.title}
        </div>
      )}

      <div className="node-meta">
        <span className={`pill s-${derived.status}`} style={{ fontSize: 10, padding: '1px 6px' }}>
          <i className="dot" style={{ background: color }} />
          {task.progress}%
        </span>
        {(task.progressMode ?? 'auto') === 'auto' && derived.hasChildren && (
          <span className="node-auto-pct" title="进度由子任务自动汇总，不可拖动">自动</span>
        )}
        <span
          className="node-date"
          title="点击直接修改起止日期 / 时间"
          onClick={(e) => { e.stopPropagation(); setDateOpen((v) => !v); }}
        >
          {formatCN(task.startDate)}–{formatCN(task.dueDate)}
          {(task.startTime || task.endTime) && <em className="node-time"> {task.startTime || '…'}–{task.endTime || '…'}</em>}
        </span>
        {task.owner && <span>· {task.owner}</span>}
      </div>
      <div className="node-bar">
        <i style={{ width: `${task.progress}%`, background: color }} />
      </div>

      {dateOpen && (
        <div className="nodrag node-date-editor" onClick={(e) => e.stopPropagation()}>
          <label>
            开始
            <input type="date" value={task.startDate} onChange={(e) => e.target.value && setDates(id, e.target.value, task.dueDate, { source: 'mind', action: '修改开始日', detail: `${task.title} → ${e.target.value}` })} />
          </label>
          <label>
            截止
            <input type="date" value={task.dueDate} onChange={(e) => e.target.value && setDates(id, task.startDate, e.target.value, { source: 'mind', action: '修改截止日', detail: `${task.title} → ${e.target.value}` })} />
          </label>
          <label>
            起
            <input type="time" value={task.startTime ?? ''} onChange={(e) => updateTask(id, { startTime: e.target.value }, { source: 'mind', action: '修改开始时间', detail: task.title })} />
          </label>
          <label>
            止
            <input type="time" value={task.endTime ?? ''} onChange={(e) => updateTask(id, { endTime: e.target.value }, { source: 'mind', action: '修改结束时间', detail: task.title })} />
          </label>
          <button className="node-date-done" onClick={() => setDateOpen(false)}>完成</button>
        </div>
      )}

      {data.hiddenCount > 0 && (
        <button
          className="node-toggle"
          title={data.collapsed ? '展开子任务' : '折叠子任务'}
          onClick={(e) => { e.stopPropagation(); toggleCollapse(id); }}
        >
          {data.collapsed ? `+${data.hiddenCount}` : '−'}
        </button>
      )}

      {data.collapsed && data.hiddenCount > 0 && (
        <div style={{ marginTop: 4, fontSize: 10, color: 'var(--muted)' }}>已折叠 {data.hiddenCount} 项子任务</div>
      )}
    </div>
  );
}

const nodeTypes = { task: TaskNodeCard };

function visibleIds(tasks: Task[], collapsed: Record<string, boolean>): Set<string> {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const out = new Set<string>();
  const walk = (id: string) => {
    out.add(id);
    if (collapsed[id]) return;
    for (const t of tasks) if (t.parentId === id) walk(t.id);
  };
  const roots = tasks.filter((t) => !t.parentId || !byId.has(t.parentId));
  roots.forEach((r) => walk(r.id));
  // 兜底：父引用不存在的任务
  tasks.forEach((t) => { if (!out.has(t.id)) walk(t.id); });
  return out;
}

function nearestVisible(id: string, tasks: Task[], vis: Set<string>): string | null {
  let cur: string | null = id;
  let guard = 0;
  while (cur && guard++ < 50) {
    if (vis.has(cur)) return cur;
    const t = tasks.find((x) => x.id === cur);
    cur = t ? t.parentId : null;
  }
  return null;
}

function MindMapInner({ derived, compact }: { derived: Record<string, Derived>; compact?: boolean }) {
  const tasks = useCanvasTasks();
  const positions = useTaskStore((s) => s.positions);
  const setPositions = useTaskStore((s) => s.setPositions);
  const lockPositions = useTaskStore((s) => s.settings.lockPositions);
  const collapsed = useTaskStore((s) => s.collapsed);
  const selectedIds = useTaskStore((s) => s.selectedIds);
  const setSelection = useTaskStore((s) => s.setSelection);
  const select = useTaskStore((s) => s.select);
  const setView = useTaskStore((s) => s.setView);
  const setParent = useTaskStore((s) => s.setParent);
  const addDependency = useTaskStore((s) => s.addDependency);
  const removeDependency = useTaskStore((s) => s.removeDependency);
  const removeTask = useTaskStore((s) => s.removeTask);
  const addChild = useTaskStore((s) => s.addChild);
  const setStatusLock = useTaskStore((s) => s.setStatusLock);
  const bulkProgress = useTaskStore((s) => s.bulkProgress);
  const bulkShift = useTaskStore((s) => s.bulkShift);
  const bulkStatus = useTaskStore((s) => s.bulkStatus);
  const bulkRemove = useTaskStore((s) => s.bulkRemove);
  const bulkCollapse = useTaskStore((s) => s.bulkCollapse);
  const collapseAll = useTaskStore((s) => s.collapseAll);
  const expandAll = useTaskStore((s) => s.expandAll);
  const chainDependencies = useTaskStore((s) => s.chainDependencies);
  const resetSample = useTaskStore((s) => s.resetSample);
  const setKind = useTaskStore((s) => s.setKind);
  const toggleCalendar = useTaskStore((s) => s.toggleCalendar);
  const bulkKind = useTaskStore((s) => s.bulkKind);
  const bulkCalendar = useTaskStore((s) => s.bulkCalendar);
  const undo = useTaskStore((s) => s.undo);
  const redo = useTaskStore((s) => s.redo);
  const canUndo = useTaskStore((s) => s.past.length > 0);
  const canRedo = useTaskStore((s) => s.future.length > 0);
  const { fitView } = useReactFlow();

  const [nodes, setNodes, onNodesChange] = useNodesState<TaskFlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [menu, setMenu] = useState<{ x: number; y: number; entries: MenuEntry[] } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const nodesRef = useRef<TaskFlowNode[]>([]);
  nodesRef.current = nodes;
  /**
   * 右键手势：contextmenu 在不同平台可能由 mousedown 或 mouseup 触发，
   * 所以不能只看事件当刻有没有移动，而要等整个「按下→抬起」手势结束再决定弹不弹菜单。
   * - 右键单击 / 轻点 → 弹功能菜单
   * - 右键长按并拖动 → 只平移画布，不弹菜单
   */
  const rightDown = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const lastGesture = useRef<{ moved: boolean; t: number }>({ moved: false, t: 0 });
  const pending = useRef<{ x: number; y: number; nodeId: string | null } | null>(null);
  const entriesRef = useRef<(nodeId: string | null) => MenuEntry[]>(() => []);
  entriesRef.current = (id) => (id ? nodeEntries(id) : paneEntries());

  const openAt = (p: { x: number; y: number; nodeId: string | null }) => {
    setMenu({ x: p.x, y: p.y, entries: entriesRef.current(p.nodeId) });
  };

  // 用 pointer 事件跟踪：d3-zoom 会在 window 捕获阶段拦截 mousemove
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (e.button !== 2) return;
      rightDown.current = { x: e.clientX, y: e.clientY, moved: false };
      pending.current = null;
    };
    const onMove = (e: PointerEvent) => {
      const r = rightDown.current;
      if (r && !r.moved && Math.hypot(e.clientX - r.x, e.clientY - r.y) > 5) r.moved = true;
    };
    const onUp = (e: PointerEvent) => {
      if (e.button !== 2) return;
      const moved = !!rightDown.current?.moved;
      lastGesture.current = { moved, t: Date.now() };
      const p = pending.current;
      rightDown.current = null;
      pending.current = null;
      if (p && !moved) openAt(p);
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 固化新节点位置：独立 effect，只依赖 tasks（不依赖 positions，避免无限循环）
  useEffect(() => {
    if (!lockPositions) return;
    const layout = treeLayout(tasks, collapsed);
    const fresh: Record<string, { x: number; y: number }> = {};
    const current = useTaskStore.getState().positions; // 读最新值，不进闭包
    let changed = false;
    for (const t of tasks) {
      if (current[t.id]) continue;
      const p = layout.get(t.id);
      if (!p) continue;
      fresh[t.id] = p;
      changed = true;
    }
    if (changed) {
      // 直接写 store（不走撤销栈）：这只是"记录初始位置"，不是用户操作
      useTaskStore.setState((s) => ({ positions: { ...s.positions, ...fresh } }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, lockPositions]);

  useEffect(() => {
    const layout = treeLayout(tasks, collapsed);
    const vis = visibleIds(tasks, collapsed);
    const selSet = new Set(selectedIds);

    // 已有位置一律沿用；没有位置的用自动布局兜底（但不写入 store，上面那个 effect 负责）
    const next: TaskFlowNode[] = tasks
      .filter((t) => vis.has(t.id))
      .map((t) => ({
        id: t.id,
        type: 'task' as const,
        position: positions[t.id] ?? layout.get(t.id) ?? { x: 0, y: 0 },
        selected: selSet.has(t.id),
        data: {
          task: t,
          derived: derived[t.id],
          collapsed: !!collapsed[t.id],
          hiddenCount: tasks.filter((c) => c.parentId === t.id).length,
          multi: selSet.size > 1 && selSet.has(t.id),
          rename: renamingId === t.id,
          onRenameDone: () => setRenamingId(null),
        },
      }));
    setNodes(next);

    const nextEdges: Edge[] = [];
    for (const t of tasks) {
      if (t.parentId && vis.has(t.id) && vis.has(t.parentId)) {
        nextEdges.push({
          id: `tree-${t.id}`,
          source: t.parentId,
          target: t.id,
          sourceHandle: 's',
          targetHandle: 't',
          type: 'smoothstep',
          style: { stroke: '#3a4a6b', strokeWidth: 1.6 },
        });
      }
    }
    const seen = new Set<string>();
    for (const t of tasks) {
      for (const dep of t.dependsOn) {
        const from = nearestVisible(dep, tasks, vis);
        const to = nearestVisible(t.id, tasks, vis);
        if (!from || !to || from === to) continue;
        const key = `${from}->${to}`;
        if (seen.has(key) || key === `${to}->${from}`) continue;
        seen.add(key);
        const isCrit = derived[dep]?.critical && derived[t.id]?.critical;
        nextEdges.push({
          id: `dep-${key}`,
          source: from,
          target: to,
          sourceHandle: 's',
          targetHandle: 't',
          type: 'smoothstep',
          animated: true,
          style: { stroke: isCrit ? '#f97316' : '#8b7cf6', strokeWidth: isCrit ? 2.4 : 1.6, strokeDasharray: '5 4' },
          markerEnd: { type: MarkerType.ArrowClosed, color: isCrit ? '#f97316' : '#8b7cf6', width: 14, height: 14 },
          label: isCrit ? '关键路径' : undefined,
          labelStyle: { fill: '#f97316', fontSize: 10 },
        });
      }
    }
    setEdges(nextEdges);
  }, [tasks, collapsed, selectedIds, derived, renamingId, positions, lockPositions, setNodes, setEdges]);

  useEffect(() => {
    const t = setTimeout(() => fitView({ padding: 0.18, duration: 250 }), 80);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onNodeDragStop: OnNodeDrag<TaskFlowNode> = useCallback(
    (_e, node) => {
      // 落点立即持久化，拖到哪就停哪，不被自动布局覆盖
      setPositions({ [node.id]: node.position }, { source: 'mind', action: '拖动节点位置', detail: titleOf(node.id) });
      // 设置项：默认关闭 —— 拖动只是摆放位置，不代表要建立父子层级
      if (!useTaskStore.getState().settings.dragToReparent) return;
      const cx = node.position.x + NODE_W / 2;
      const cy = node.position.y + NODE_H / 2;
      let best: { id: string; d: number } | null = null;
      for (const n of nodesRef.current) {
        if (n.id === node.id) continue;
        const nx = n.position.x;
        const ny = n.position.y;
        const inside = cx > nx && cx < nx + NODE_W && cy > ny && cy < ny + NODE_H;
        if (inside) { best = { id: n.id, d: -1 }; break; }
        const d = Math.hypot(cx - (nx + NODE_W / 2), cy - (ny + NODE_H / 2));
        if (!best || d < best.d) best = { id: n.id, d };
      }
      if (best && best.d < 150) {
        const cur = tasks.find((t) => t.id === node.id);
        if (cur && cur.parentId !== best.id) {
          const target = tasks.find((t) => t.id === best.id);
          setParent(node.id, best.id, { source: 'mind', action: '拖拽调整层级', detail: `「${cur.title}」→ 挂在「${target?.title}」下` });
        }
      }
    },
    [tasks, setParent, setPositions],
  );

  const onConnect = useCallback(
    (c: { source: string | null; target: string | null }) => {
      if (!c.source || !c.target) return;
      const from = tasks.find((t) => t.id === c.source);
      const to = tasks.find((t) => t.id === c.target);
      const ok = addDependency(c.target, c.source, {
        source: 'mind',
        action: '建立依赖',
        detail: `「${from?.title}」完成后才能开始「${to?.title}」`,
      });
      if (!ok) alert('该依赖会形成循环，已忽略');
    },
    [tasks, addDependency],
  );

  const titleOf = (id: string) => tasks.find((t) => t.id === id)?.title ?? id;

  /* ---------------- 右键菜单 ---------------- */

  const goto = (v: ViewId, id?: string) => {
    if (id) select(id);
    setView(v);
  };

  const multiEntries = (ids: string[]): MenuEntry[] => {
    const n = ids.length;
    const allDone = ids.every((id) => (tasks.find((t) => t.id === id)?.progress ?? 0) >= 100);
    return [
      { kind: 'title', label: `已框选 ${n} 项` },
      {
        kind: 'item',
        label: allDone ? '取消全部完成' : '全部标记完成',
        hint: '三视图同步',
        onClick: () => bulkProgress(ids, allDone ? 0 : 100, { source: 'mind', action: allDone ? '批量取消完成' : '批量完成', detail: `${n} 项` }),
      },
      { kind: 'item', label: '进度统一设为 50%', onClick: () => bulkProgress(ids, 50, { source: 'mind', action: '批量改进度', detail: `${n} 项 → 50%` }) },
      { kind: 'sep' },
      { kind: 'item', label: '整体后移 1 天', onClick: () => bulkShift(ids, 1, { source: 'mind', action: '批量改期', detail: `${n} 项 +1 天` }) },
      { kind: 'item', label: '整体后移 7 天', onClick: () => bulkShift(ids, 7, { source: 'mind', action: '批量改期', detail: `${n} 项 +7 天` }) },
      { kind: 'item', label: '整体提前 1 天', onClick: () => bulkShift(ids, -1, { source: 'mind', action: '批量改期', detail: `${n} 项 -1 天` }) },
      { kind: 'sep' },
      {
        kind: 'item',
        label: '按顺序串联依赖',
        hint: '前一个完成 → 后一个开始',
        onClick: () => chainDependencies(ids, { source: 'mind', action: '批量建立依赖', detail: `串联 ${n} 项` }),
      },
      { kind: 'item', label: '状态改为「进行中」', onClick: () => bulkStatus(ids, 'doing', { source: 'mind', action: '批量改状态', detail: `${n} 项 → 进行中` }) },
      { kind: 'item', label: '状态改为「阻塞」', onClick: () => bulkStatus(ids, 'blocked', { source: 'mind', action: '批量改状态', detail: `${n} 项 → 阻塞` }) },
      { kind: 'item', label: '解除状态锁定（自动判定）', onClick: () => bulkStatus(ids, null, { source: 'mind', action: '批量解锁状态', detail: `${n} 项` }) },
      { kind: 'sep' },
      { kind: 'item', label: '全部设为「任务」类型', hint: '纳入排期与日历', onClick: () => bulkKind(ids, 'task', { source: 'mind', action: '批量设类型', detail: `${n} 项 → 任务` }) },
      { kind: 'item', label: '全部设为「计划」类型', hint: '构思中，默认不进日历', onClick: () => bulkKind(ids, 'plan', { source: 'mind', action: '批量设类型', detail: `${n} 项 → 计划` }) },
      { kind: 'item', label: '全部加入日历', onClick: () => bulkCalendar(ids, true, { source: 'mind', action: '批量加日历', detail: `${n} 项` }) },
      { kind: 'item', label: '全部移出日历', onClick: () => bulkCalendar(ids, false, { source: 'mind', action: '批量移出日历', detail: `${n} 项` }) },
      { kind: 'sep' },
      {
        kind: 'item',
        label: '折叠这些节点',
        hint: '仅对含子任务的节点生效',
        onClick: () => bulkCollapse(ids, true),
      },
      { kind: 'item', label: '展开这些节点', onClick: () => bulkCollapse(ids, false) },
      { kind: 'sep' },
      { kind: 'item', label: `删除这 ${n} 项（含子任务）`, danger: true, onClick: () => { if (confirm(`删除选中的 ${n} 个任务？三视图将同步移除。`)) bulkRemove(ids, { source: 'mind', action: '批量删除', detail: `${n} 项` }); } },
      { kind: 'item', label: '取消选择', onClick: () => setSelection([]) },
    ];
  };

  const nodeEntries = (id: string): MenuEntry[] => {
    const t = tasks.find((x) => x.id === id);
    if (!t) return [];
    const d = derived[id];
    const done = t.progress >= 100;
    const hasKids = !!d?.hasChildren;
    const sel = selectedIds.includes(id) ? selectedIds : [id];
    if (sel.length > 1) return multiEntries(sel);
    return [
      { kind: 'title', label: t.title },
      { kind: 'item', label: '新增子任务', hint: '挂在此节点下', onClick: () => addChild(id, { source: 'mind', action: '新增子任务', detail: t.title }) },
      { kind: 'item', label: '新增子计划', hint: '默认不进日历', onClick: () => addChild(id, { source: 'mind', action: '新增子计划', detail: t.title }, 'plan') },
      { kind: 'item', label: '重命名', hint: '双击标题也可', onClick: () => { select(id); setRenamingId(id); } },
      { kind: 'sep' },
      { kind: 'item', label: done ? '取消完成' : '标记完成', hint: done ? '进度归零' : '进度 100%', onClick: () => bulkProgress([id], done ? 0 : 100, { source: 'mind', action: done ? '取消完成' : '标记完成', detail: t.title }) },
      { kind: 'item', label: '进度设为 50%', onClick: () => bulkProgress([id], 50, { source: 'mind', action: '改进度', detail: `${t.title} → 50%` }) },
      { kind: 'sep' },
      { kind: 'item', label: '顺延 1 天', onClick: () => bulkShift([id], 1, { source: 'mind', action: '改期', detail: `${t.title} +1 天` }) },
      { kind: 'item', label: '顺延 7 天', onClick: () => bulkShift([id], 7, { source: 'mind', action: '改期', detail: `${t.title} +7 天` }) },
      { kind: 'item', label: '提前 1 天', onClick: () => bulkShift([id], -1, { source: 'mind', action: '改期', detail: `${t.title} -1 天` }) },
      { kind: 'sep' },
      { kind: 'item', label: '锁定状态：进行中', onClick: () => setStatusLock(id, 'doing', { source: 'mind', action: '锁定状态', detail: `${t.title} → 进行中` }) },
      { kind: 'item', label: '锁定状态：阻塞', onClick: () => setStatusLock(id, 'blocked', { source: 'mind', action: '锁定状态', detail: `${t.title} → 阻塞` }) },
      { kind: 'item', label: '解除状态锁定', disabled: !t.statusLocked, onClick: () => setStatusLock(id, null, { source: 'mind', action: '解除锁定', detail: t.title }) },
      { kind: 'sep' },
      { kind: 'item', label: t.kind === 'plan' ? '切换为「任务」（纳入排期与日历）' : '切换为「计划」（构思中，默认不进日历）', hint: `当前：${t.kind === 'plan' ? '计划' : '任务'}`, onClick: () => setKind(id, t.kind === 'plan' ? 'task' : 'plan', { source: 'mind', action: '切换类型', detail: `${t.title} → ${t.kind === 'plan' ? '任务' : '计划'}` }) },
      { kind: 'item', label: t.showInCalendar ? '移出日历' : '加入日历', hint: '也可在详情面板设置', onClick: () => toggleCalendar(id, { source: 'mind', action: t.showInCalendar ? '移出日历' : '加入日历', detail: t.title }) },
      { kind: 'sep' },
      ...(hasKids
        ? [{ kind: 'item' as const, label: collapsed[id] ? '展开子任务' : '折叠子任务', onClick: () => useTaskStore.getState().toggleCollapse(id) }]
        : []),
      { kind: 'item', label: '在甘特图中定位', onClick: () => goto('gantt', id) },
      { kind: 'item', label: '在日历中定位', onClick: () => goto('calendar', id) },
      { kind: 'sep' },
      { kind: 'item', label: '删除（含子任务）', danger: true, onClick: () => { if (confirm(`删除「${t.title}」？三视图将同步移除。`)) removeTask(id, { source: 'mind', action: '删除节点', detail: t.title }); } },
    ];
  };

  const paneEntries = (): MenuEntry[] => {
    const vis = [...visibleIds(tasks, collapsed)];
    return [
      { kind: 'title', label: '画布' },
      { kind: 'item', label: '新建课题', onClick: () => addChild(null, { source: 'mind', action: '新建顶层课题', detail: '新课题' }) },
      { kind: 'item', label: `全选可见节点（${vis.length}）`, disabled: !vis.length, onClick: () => setSelection(vis) },
      { kind: 'item', label: '适应画布', onClick: () => fitView({ padding: 0.18, duration: 300 }) },
      { kind: 'item', label: '撤销 (Ctrl/⌘+Z)', disabled: !canUndo, onClick: () => undo() },
      { kind: 'item', label: '重做 (Ctrl/⌘+Shift+Z)', disabled: !canRedo, onClick: () => redo() },
      { kind: 'sep' },
      { kind: 'item', label: '全部折叠', hint: '收起所有子任务', disabled: !tasks.length, onClick: () => collapseAll() },
      { kind: 'item', label: '全部展开', disabled: !tasks.length, onClick: () => expandAll() },
      { kind: 'sep' },
      { kind: 'title', label: '视图' },
      { kind: 'item', label: '切到总览（三视图同屏）', onClick: () => goto('all') },
      { kind: 'item', label: '切到甘特图', onClick: () => goto('gantt') },
      { kind: 'item', label: '切到日历', onClick: () => goto('calendar') },
      ...(tasks.length
        ? []
        : [
            { kind: 'sep' as const },
            { kind: 'item' as const, label: '载入示例课题', onClick: () => { if (confirm('载入示例会覆盖当前数据，继续？')) resetSample(); } },
          ]),
    ];
  };

  return (
    <div
      className="mind"
      onContextMenu={(e) => {
        e.preventDefault(); // 屏蔽浏览器自带菜单
        const nodeEl = (e.target as HTMLElement).closest('.react-flow__node');
        const id = nodeEl?.getAttribute('data-id') ?? null;
        const p = { x: e.clientX, y: e.clientY, nodeId: id };
        if (rightDown.current) {
          pending.current = p; // 等抬手时再决定
        } else if (!lastGesture.current.moved && Date.now() - lastGesture.current.t < 300) {
          openAt(p); // 某些平台是抬手后才发 contextmenu
        }
      }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStop={onNodeDragStop}
        onNodeClick={(_e, n) => select(n.id)}
        onConnect={onConnect}
        onNodesDelete={(ns) => ns.forEach((n) => removeTask(n.id, { source: 'mind', action: '删除节点', detail: titleOf(n.id) }))}
        onEdgesDelete={(es) =>
          es.forEach((e) => {
            if (!e.id.startsWith('dep-')) return;
            const [from, to] = e.id.replace('dep-', '').split('->');
            removeDependency(to, from, { source: 'mind', action: '移除依赖', detail: `${titleOf(from)} ⇢ ${titleOf(to)}` });
          })
        }
        onPaneClick={() => {
          setMenu(null);
          // 设置项：框选后点击空白处是否取消选择。关闭时保留框选。
          if (useTaskStore.getState().settings.clearSelOnOutsideClick) select(null);
        }}
        onSelectionChange={({ nodes: ns }) => {
          const ids = ns.map((n) => n.id);
          if (ids.length) setSelection(ids); // 框选/点选 → 同步
          // 空白点击清空节点选择时，遵循「点击空白处取消选择」开关
          else if (useTaskStore.getState().settings.clearSelOnOutsideClick) setSelection([]);
        }}
        onSelectionDragStop={(_e, ns) => setSelection(ns.map((n) => n.id))}
        selectionOnDrag
        panOnDrag={[1, 2]}
        panOnScroll={false}
        zoomOnDoubleClick={false}
        minZoom={0.2}
        maxZoom={1.8}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#22304d" />
        {!compact && <Controls showInteractive={false} />}
        {!compact && (
          <MiniMap pannable zoomable nodeColor={(n) => STATUS_COLOR[(n.data as TaskNodeData).derived?.status ?? 'todo']} maskColor="rgba(10,14,24,0.75)" />
        )}
      </ReactFlow>

      {!tasks.length && (
        <div className="mind-empty">
          <b>空白画布</b>
          <span>右键单击空白处 → 「新建课题」开始拆解</span>
        </div>
      )}

      {!compact && (
        <div className="mind-toolbar">
          <button onClick={() => addChild(null, { source: 'mind', action: '新建顶层课题', detail: '新课题' })}>+ 新建课题</button>
          <button
            disabled={!selectedIds.length}
            onClick={() => selectedIds[0] && addChild(selectedIds[0], { source: 'mind', action: '新增子任务', detail: titleOf(selectedIds[0]) })}
          >
            + 子任务
          </button>
          <button onClick={() => setSelection([...visibleIds(tasks, collapsed)])}>全选</button>
          <button onClick={collapseAll} title="折叠所有含子任务的节点">全部折叠</button>
          <button onClick={expandAll} title="展开所有节点">全部展开</button>
          <button
            disabled={!selectedIds.length}
            onClick={() => bulkCollapse(selectedIds, true)}
            title="折叠框选中的节点（仅对含子任务的节点生效）"
          >
            折叠所选
          </button>
          <button
            disabled={!selectedIds.length}
            onClick={() => bulkCollapse(selectedIds, false)}
            title="展开框选中的节点"
          >
            展开所选
          </button>
          <button onClick={() => fitView({ padding: 0.18, duration: 300 })}>适应画布</button>
        </div>
      )}

      {selectedIds.length > 1 && (
        <div className="mind-selbar">
          已框选 <b>{selectedIds.length}</b> 项 · 右键单击可批量操作
          <button onClick={() => bulkProgress(selectedIds, 100, { source: 'mind', action: '批量完成', detail: `${selectedIds.length} 项` })}>全部完成</button>
          <button onClick={() => bulkCollapse(selectedIds, true)}>折叠</button>
          <button onClick={() => bulkCollapse(selectedIds, false)}>展开</button>
          <button onClick={() => chainDependencies(selectedIds, { source: 'mind', action: '批量建立依赖', detail: `串联 ${selectedIds.length} 项` })}>串联依赖</button>
          <button onClick={() => bulkShift(selectedIds, 1, { source: 'mind', action: '批量改期', detail: `${selectedIds.length} 项 +1 天` })}>后移 1 天</button>
          <button
            className="danger"
            onClick={() => {
              if (confirm(`删除选中的 ${selectedIds.length} 个任务？三视图将同步移除。`))
                bulkRemove(selectedIds, { source: 'mind', action: '批量删除', detail: `${selectedIds.length} 项` });
            }}
          >
            删除
          </button>
          <button onClick={() => setSelection([])}>取消</button>
        </div>
      )}

      {!compact && (
        <>
          <div className="mind-legend">
            <span style={{ color: STATUS_COLOR.done }}>● 完成</span>
            <span style={{ color: STATUS_COLOR.doing }}>● 进行中</span>
            <span style={{ color: STATUS_COLOR.delayed }}>● 延期</span>
            <span style={{ color: STATUS_COLOR.blocked }}>● 阻塞</span>
            <span style={{ color: '#8b7cf6' }}>┄ 依赖</span>
            <span style={{ color: '#f97316' }}>┄ 关键路径</span>
          </div>
          <div className="mind-hint">
            左键单击=选中 · <b>左键拖出方框=框选</b> · <b>右键长按拖动=移动画布</b> · <b>右键单击=功能菜单</b> ·{' '}
            {useTaskStore.getState().settings.dragToReparent
              ? '拖节点到别的节点上=改层级 · '
              : '拖节点只改位置不改层级（可在⚙设置开启） · '}
            点节点 ⇢ = 创建新节点 / 链接已有节点
          </div>
        </>
      )}

      {menu && <ContextMenu x={menu.x} y={menu.y} entries={menu.entries} onClose={() => setMenu(null)} />}
    </div>
  );
}

export default function MindMapView(props: { derived: Record<string, Derived>; compact?: boolean }) {
  return (
    <ReactFlowProvider>
      <MindMapInner {...props} />
    </ReactFlowProvider>
  );
}
