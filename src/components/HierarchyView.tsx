import { useEffect, useMemo, useRef, useState } from 'react';
import { Derived, STATUS_COLOR, STATUS_LABEL } from '../types';
import { useTaskStore } from '../store/useTaskStore';
import { useCanvasTasks } from '../store/useTaskStore';
import { flattenTree } from '../lib/schedule';
import { formatCN } from '../lib/date';
import ContextMenu, { MenuEntry } from './ContextMenu';

const STATUS_BAR: Record<string, string> = {
  todo: '#94a3b8',
  doing: '#2563eb',
  done: '#16a34a',
  delayed: '#ef4444',
  blocked: '#64748b',
};

export default function HierarchyView({ derived, compact }: { derived: Record<string, Derived>; compact?: boolean }) {
  const tasks = useCanvasTasks();
  const collapsed = useTaskStore((s) => s.collapsed);
  const selectedIds = useTaskStore((s) => s.selectedIds);
  const setSelection = useTaskStore((s) => s.setSelection);
  const select = useTaskStore((s) => s.select);
  const setView = useTaskStore((s) => s.setView);
  const setParent = useTaskStore((s) => s.setParent);
  const removeTask = useTaskStore((s) => s.removeTask);
  const addChild = useTaskStore((s) => s.addChild);
  const toggleCollapse = useTaskStore((s) => s.toggleCollapse);
  const updateTask = useTaskStore((s) => s.updateTask);
  const setStatusLock = useTaskStore((s) => s.setStatusLock);
  const bulkProgress = useTaskStore((s) => s.bulkProgress);
  const bulkShift = useTaskStore((s) => s.bulkShift);
  const bulkStatus = useTaskStore((s) => s.bulkStatus);
  const bulkRemove = useTaskStore((s) => s.bulkRemove);
  const chainDependencies = useTaskStore((s) => s.chainDependencies);
  const resetSample = useTaskStore((s) => s.resetSample);
  const toggleCalendar = useTaskStore((s) => s.toggleCalendar);
  const bulkCalendar = useTaskStore((s) => s.bulkCalendar);
  const setKind = useTaskStore((s) => s.setKind);
  const bulkKind = useTaskStore((s) => s.bulkKind);
  const undo = useTaskStore((s) => s.undo);
  const redo = useTaskStore((s) => s.redo);

  const rows = useMemo(() => flattenTree(tasks, collapsed), [tasks, collapsed]);
  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const selSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [menu, setMenu] = useState<{ x: number; y: number; entries: MenuEntry[] } | null>(null);
  /** HTML5 拖手柄改层级：被拖行的 id 与命中的目标行 id */
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  /** 框选矩形：null 表示未在框选 */
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  /** 区分「左键单击」与「左键拖动框选」，同步 ref 避免重渲染 */
  const dragSel = useRef<{ startX: number; startY: number; moved: boolean } | null>(null);

  const taskCount = tasks.length;
  const projectCount = tasks.filter((t) => !t.parentId).length;
  const taskOf = (id: string) => byId.get(id)!;

  /* ---------------- 框选（容器空白处按下左键） ---------------- */
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragSel.current || dragSel.current.moved) return;
      if (Math.hypot(e.clientX - dragSel.current.startX, e.clientY - dragSel.current.startY) > 5) {
        dragSel.current.moved = true;
        setBox({ x: dragSel.current.startX, y: dragSel.current.startY, w: 0, h: 0 });
      }
    };
    const onUp = (e: MouseEvent) => {
      if (!dragSel.current || !dragSel.current.moved || !box) {
        dragSel.current = null;
        return;
      }
      const el = containerRef.current;
      if (el) {
        // 用视口坐标做命中测试，避免滚动/偏移换算出错
        const L = Math.min(dragSel.current.startX, e.clientX);
        const R = Math.max(dragSel.current.startX, e.clientX);
        const T = Math.min(dragSel.current.startY, e.clientY);
        const B = Math.max(dragSel.current.startY, e.clientY);
        const hits: string[] = [];
        // 相交即选中：滑动经过就框住，符合"划一下选中一片"的直觉
        el.querySelectorAll<HTMLElement>('.hier-row').forEach((row) => {
          const r = row.getBoundingClientRect();
          if (r.right >= L && r.left <= R && r.bottom >= T && r.top <= B) {
            const id = row.dataset.id;
            if (id) hits.push(id);
          }
        });
        if (hits.length) setSelection(hits);
        else setSelection([]);
      }
      setBox(null);
      dragSel.current = null;
    };
    const onUpdate = (e: MouseEvent) => {
      if (!dragSel.current?.moved) return;
      setBox((b) => (b ? { ...b, w: e.clientX - b.x, h: e.clientY - b.y } : b));
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mousemove', onUpdate);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mousemove', onUpdate);
      window.removeEventListener('mouseup', onUp);
    };
  }, [box, setSelection]);

  const onContainerMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    // 按钮 / 输入框 / 六点手柄 不参与框选，交给它们自己的交互
    if (target.closest('button') || target.closest('input') || target.closest('.hier-handle')) return;
    // 行上也能起框选：移动超过 5px 才算框选，否则仍按单击选中处理
    dragSel.current = { startX: e.clientX, startY: e.clientY, moved: false };
  };

  /* ---------------- 行点击：单选 / 多选 ---------------- */
  const onRowClick = (id: string, e: React.MouseEvent) => {
    if (dragSel.current?.moved) return; // 正在框选，吃掉 click
    if (e.ctrlKey || e.metaKey) {
      // toggle
      const next = selSet.has(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id];
      setSelection(next);
    } else if (e.shiftKey && selectedIds.length) {
      // 范围选择：在当前行序中从最后一个选中到当前
      const last = selectedIds[selectedIds.length - 1];
      const a = rows.findIndex((r) => r.id === last);
      const b = rows.findIndex((r) => r.id === id);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        const range = rows.slice(lo, hi + 1).map((r) => r.id);
        setSelection([...new Set([...selectedIds, ...range])]);
      }
    } else {
      select(id);
    }
  };

  const onRowDouble = (id: string) => {
    setEditing(id);
    setDraft(taskOf(id).title);
  };
  const commitTitle = (id: string) => {
    setEditing(null);
    const v = draft.trim();
    if (v && v !== taskOf(id).title) updateTask(id, { title: v }, { source: 'hierarchy', action: '重命名', detail: v });
  };

  /* ---------------- 右键菜单 ---------------- */
  const titleOf = (id: string) => byId.get(id)?.title ?? id;

  const multiEntries = (ids: string[]): MenuEntry[] => {
    const n = ids.length;
    const allDone = ids.every((id) => (byId.get(id)?.progress ?? 0) >= 100);
    return [
      { kind: 'title', label: `已选中 ${n} 项` },
      {
        kind: 'item',
        label: allDone ? '取消全部完成' : '全部标记完成',
        onClick: () => bulkProgress(ids, allDone ? 0 : 100, { source: 'hierarchy', action: allDone ? '批量取消完成' : '批量完成', detail: `${n} 项` }),
      },
      { kind: 'item', label: '进度统一设为 50%', onClick: () => bulkProgress(ids, 50, { source: 'hierarchy', action: '批量改进度', detail: `${n} 项 → 50%` }) },
      { kind: 'sep' },
      { kind: 'item', label: '整体后移 1 天', onClick: () => bulkShift(ids, 1, { source: 'hierarchy', action: '批量改期', detail: `${n} 项 +1` }) },
      { kind: 'item', label: '整体后移 7 天', onClick: () => bulkShift(ids, 7, { source: 'hierarchy', action: '批量改期', detail: `${n} 项 +7` }) },
      { kind: 'item', label: '整体提前 1 天', onClick: () => bulkShift(ids, -1, { source: 'hierarchy', action: '批量改期', detail: `${n} 项 -1` }) },
      { kind: 'sep' },
      { kind: 'item', label: '按顺序串联依赖', hint: '前一个完成 → 后一个开始', onClick: () => chainDependencies(ids, { source: 'hierarchy', action: '批量建立依赖', detail: `串联 ${n} 项` }) },
      { kind: 'item', label: '状态改为「进行中」', onClick: () => bulkStatus(ids, 'doing', { source: 'hierarchy', action: '批量改状态', detail: `${n} 项 → 进行中` }) },
      { kind: 'item', label: '状态改为「阻塞」', onClick: () => bulkStatus(ids, 'blocked', { source: 'hierarchy', action: '批量改状态', detail: `${n} 项 → 阻塞` }) },
      { kind: 'item', label: '解除状态锁定', onClick: () => bulkStatus(ids, null, { source: 'hierarchy', action: '批量解锁', detail: `${n} 项` }) },
      { kind: 'sep' },
      { kind: 'item', label: '全部设为「任务」类型', onClick: () => bulkKind(ids, 'task', { source: 'hierarchy', action: '批量设类型', detail: `${n} 项 → 任务` }) },
      { kind: 'item', label: '全部设为「计划」类型', onClick: () => bulkKind(ids, 'plan', { source: 'hierarchy', action: '批量设类型', detail: `${n} 项 → 计划` }) },
      { kind: 'item', label: '全部加入日历', onClick: () => bulkCalendar(ids, true, { source: 'hierarchy', action: '批量加日历', detail: `${n} 项` }) },
      { kind: 'item', label: '全部移出日历', onClick: () => bulkCalendar(ids, false, { source: 'hierarchy', action: '批量移出日历', detail: `${n} 项` }) },
      { kind: 'sep' },
      { kind: 'item', label: `删除这 ${n} 项（含子任务）`, danger: true, onClick: () => { if (confirm(`删除选中的 ${n} 个任务？三视图将同步移除。`)) bulkRemove(ids, { source: 'hierarchy', action: '批量删除', detail: `${n} 项` }); } },
      { kind: 'item', label: '取消选择', onClick: () => setSelection([]) },
    ];
  };

  const nodeEntries = (id: string): MenuEntry[] => {
    const t = taskOf(id);
    if (!t) return [];
    const d = derived[id];
    const done = t.progress >= 100;
    const hasKids = !!d?.hasChildren;
    const sel = selSet.has(id) ? selectedIds : [id];
    if (sel.length > 1) return multiEntries(sel);
    return [
      { kind: 'title', label: t.title },
      { kind: 'item', label: '新增子任务', onClick: () => addChild(id, { source: 'hierarchy', action: '新增子任务', detail: t.title }) },
      { kind: 'item', label: '重命名', hint: '双击也可', onClick: () => { select(id); setEditing(id); setDraft(t.title); } },
      { kind: 'sep' },
      { kind: 'item', label: done ? '取消完成' : '标记完成', onClick: () => bulkProgress([id], done ? 0 : 100, { source: 'hierarchy', action: done ? '取消完成' : '标记完成', detail: t.title }) },
      { kind: 'item', label: '进度设为 50%', onClick: () => bulkProgress([id], 50, { source: 'hierarchy', action: '改进度', detail: `${t.title} → 50%` }) },
      { kind: 'sep' },
      { kind: 'item', label: '顺延 1 天', onClick: () => bulkShift([id], 1, { source: 'hierarchy', action: '改期', detail: `${t.title} +1` }) },
      { kind: 'item', label: '顺延 7 天', onClick: () => bulkShift([id], 7, { source: 'hierarchy', action: '改期', detail: `${t.title} +7` }) },
      { kind: 'item', label: '提前 1 天', onClick: () => bulkShift([id], -1, { source: 'hierarchy', action: '改期', detail: `${t.title} -1` }) },
      { kind: 'sep' },
      { kind: 'item', label: '锁定状态：进行中', onClick: () => setStatusLock(id, 'doing', { source: 'hierarchy', action: '锁定状态', detail: `${t.title} → 进行中` }) },
      { kind: 'item', label: '锁定状态：阻塞', onClick: () => setStatusLock(id, 'blocked', { source: 'hierarchy', action: '锁定状态', detail: `${t.title} → 阻塞` }) },
      { kind: 'item', label: '解除状态锁定', disabled: !t.statusLocked, onClick: () => setStatusLock(id, null, { source: 'hierarchy', action: '解除锁定', detail: t.title }) },
      { kind: 'sep' },
      { kind: 'item', label: t.kind === 'plan' ? '切换为「任务」（纳入排期与日历）' : '切换为「计划」（构思中，默认不进日历）', hint: `当前：${t.kind === 'plan' ? '计划' : '任务'}`, onClick: () => setKind(id, t.kind === 'plan' ? 'task' : 'plan', { source: 'hierarchy', action: '切换类型', detail: `${t.title} → ${t.kind === 'plan' ? '任务' : '计划'}` }) },
      { kind: 'item', label: t.showInCalendar ? '移出日历' : '加入日历', hint: '也可在右侧详情面板设置', onClick: () => toggleCalendar(id, { source: 'hierarchy', action: t.showInCalendar ? '移出日历' : '加入日历', detail: t.title }) },
      { kind: 'sep' },
      ...(hasKids ? [{ kind: 'item' as const, label: collapsed[id] ? '展开子任务' : '折叠子任务', onClick: () => toggleCollapse(id) }] : []),
      { kind: 'item', label: '在思维导图中定位', onClick: () => { select(id); setView('mind'); } },
      { kind: 'item', label: '在甘特图中定位', onClick: () => { select(id); setView('gantt'); } },
      { kind: 'item', label: '在日历中定位', onClick: () => { select(id); setView('calendar'); } },
      { kind: 'sep' },
      { kind: 'item', label: '删除（含子任务）', danger: true, onClick: () => { if (confirm(`删除「${t.title}」？三视图将同步移除。`)) removeTask(id, { source: 'hierarchy', action: '删除', detail: t.title }); } },
    ];
  };

  const paneEntries = (): MenuEntry[] => [
    { kind: 'title', label: '画布' },
    { kind: 'item', label: '新建课题', onClick: () => addChild(null, { source: 'hierarchy', action: '新建课题', detail: '新课题' }) },
    { kind: 'item', label: '全选', disabled: !rows.length, onClick: () => setSelection(rows.map((r) => r.id)) },
    { kind: 'item', label: '撤销 (Ctrl/⌘+Z)', onClick: () => undo() },
    { kind: 'item', label: '重做 (Ctrl/⌘+Shift+Z)', onClick: () => redo() },
    { kind: 'sep' },
    { kind: 'title', label: '视图' },
    { kind: 'item', label: '切到总览', onClick: () => setView('all') },
    { kind: 'item', label: '切到思维导图（画布）', onClick: () => setView('mind') },
    { kind: 'item', label: '切到甘特图', onClick: () => setView('gantt') },
    { kind: 'item', label: '切到日历', onClick: () => setView('calendar') },
    ...(tasks.length
      ? []
      : [
          { kind: 'sep' as const },
          { kind: 'item' as const, label: '载入示例', onClick: () => { if (confirm('载入示例会覆盖当前数据，继续？')) resetSample(); } },
        ]),
  ];

  const openMenu = (e: React.MouseEvent, entries: MenuEntry[]) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, entries });
  };

  /* ---------------- HTML5 拖手柄改层级 ---------------- */
  const dragIdRef = useRef<string | null>(null);

  const onDragStart = (e: React.DragEvent, id: string) => {
    dragIdRef.current = id;
    e.dataTransfer.setData('text/plain', id);
    e.dataTransfer.effectAllowed = 'move';
  };
  const onDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault();
    if (dragIdRef.current && dragIdRef.current !== id) setDropTarget(id);
  };
  const onDragLeave = (id: string) => {
    if (dropTarget === id) setDropTarget(null);
  };
  const onDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    setDropTarget(null);
    const id = dragIdRef.current;
    dragIdRef.current = null;
    if (!id || id === targetId) return;
    // 拖到自己的后代 = 跳过
    const t = byId.get(id);
    if (!t) return;
    setParent(id, targetId, { source: 'hierarchy', action: '拖拽改层级', detail: `「${t.title}」→ 挂在「${titleOf(targetId)}」下` });
  };

  const onAddRow = (parentId: string | null) => {
    addChild(parentId, { source: 'hierarchy', action: parentId ? '新增子任务' : '新建课题', detail: parentId ? titleOf(parentId) : '新课题' });
  };

  if (!tasks.length) {
    return (
      <div className="hier-wrap hier-empty" onContextMenu={(e) => openMenu(e, paneEntries())}>
        <div className="hier-head">
          <div className="hier-head-left">
            <div className="hier-eyebrow">HIERARCHY / 01</div>
            <h2>研究结构</h2>
            <div className="hier-sub">右键空白处 → 「新建课题」开始</div>
          </div>
        </div>
        {menu && <ContextMenu x={menu.x} y={menu.y} entries={menu.entries} onClose={() => setMenu(null)} />}
      </div>
    );
  }

  return (
    <div
      className="hier-wrap"
      ref={containerRef}
      onMouseDown={onContainerMouseDown}
      onContextMenu={(e) => openMenu(e, paneEntries())}
    >
      {!compact && (
        <div className="hier-head">
          <div className="hier-head-left">
            <div className="hier-eyebrow">HIERARCHY / 01</div>
            <h2>研究结构</h2>
            <div className="hier-sub">把课题拆成可执行的实验链 · 拖动六点手柄调整层级</div>
          </div>
          <div className="hier-head-right">
            <div className="hier-counts">{projectCount} 个课题 · {taskCount} 个任务</div>
            <button className="hier-primary" onClick={() => onAddRow(null)}>+ 新建课题</button>
          </div>
        </div>
      )}

      {!compact && (
        <div className="hier-legend">
          <span><i style={{ background: STATUS_BAR.done }} /> 已完成</span>
          <span><i style={{ background: STATUS_BAR.doing }} /> 进行中</span>
          <span><i style={{ background: STATUS_BAR.delayed }} /> 延期</span>
          <span><i style={{ background: STATUS_BAR.blocked }} /> 阻塞</span>
          <span className="hier-hint">单击=选中 · Ctrl/⌘点击=加选 · Shift 点击=范围选 · 左键拖空白=框选 · 右键单击=菜单</span>
        </div>
      )}

      <div className="hier-rows">
        {rows.map((t) => {
          const d = derived[t.id];
          const color = STATUS_BAR[d?.status ?? 'todo'];
          const selected = selSet.has(t.id);
          const multi = selSet.size > 1 && selected;
          const isEditing = editing === t.id;
          const isDrop = dropTarget === t.id;
          return (
            <div
              key={t.id}
              data-id={t.id}
              className={`hier-row${selected ? ' selected' : ''}${multi ? ' multi' : ''}${isDrop ? ' drop' : ''}${d?.critical ? ' critical' : ''}`}
              style={{ paddingLeft: 12 + (d?.depth ?? 0) * 22 }}
              onClick={(e) => onRowClick(t.id, e)}
              onDoubleClick={() => onRowDouble(t.id)}
              onContextMenu={(e) => { e.stopPropagation(); openMenu(e, nodeEntries(t.id)); }}
              onDragOver={(e) => onDragOver(e, t.id)}
              onDragLeave={() => onDragLeave(t.id)}
              onDrop={(e) => onDrop(e, t.id)}
            >
              <span
                className="hier-handle"
                title="拖动调整层级"
                draggable={!isEditing}
                onDragStart={(e) => onDragStart(e, t.id)}
              >
                <i /><i /><i /><i /><i /><i />
              </span>

              {d?.hasChildren ? (
                <button
                  className="hier-caret"
                  onClick={(e) => { e.stopPropagation(); toggleCollapse(t.id); }}
                  title="折叠/展开子任务"
                >
                  {collapsed[t.id] ? '▸' : '▾'}
                </button>
              ) : (
                <span className="hier-caret-spacer" />
              )}

              <span className="hier-bar" style={{ background: color }} />

              {isEditing ? (
                <input
                  className="hier-input"
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => commitTitle(t.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitTitle(t.id);
                    if (e.key === 'Escape') { setDraft(t.title); setEditing(null); }
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span className="hier-title">{t.title}</span>
              )}

              <span className="hier-pill" style={{ color: STATUS_COLOR[d?.status ?? 'todo'] }}>
                <i style={{ background: STATUS_COLOR[d?.status ?? 'todo'] }} />
                {STATUS_LABEL[d?.status ?? 'todo']}
                {t.statusLocked && <em>🔒</em>}
              </span>

              {t.kind === 'plan' && <span className="hier-kind-plan">计划</span>}

              <span className="hier-date">{formatCN(t.startDate)} – {formatCN(t.dueDate)}</span>

              <span className="hier-row-actions" onClick={(e) => e.stopPropagation()}>
                <button title="新增子任务" onClick={() => onAddRow(t.id)}>+</button>
                <button
                  title="更多"
                  onClick={(e) => {
                    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    setMenu({ x: r.right - 220, y: r.bottom + 2, entries: nodeEntries(t.id) });
                  }}
                >
                  ⋯
                </button>
                <button
                  title="删除"
                  className="danger"
                  onClick={() => {
                    if (confirm(`删除「${t.title}」？三视图将同步移除。`))
                      removeTask(t.id, { source: 'hierarchy', action: '删除', detail: t.title });
                  }}
                >
                  🗑
                </button>
              </span>
            </div>
          );
        })}

        <div className="hier-add-row" onDoubleClick={() => onAddRow(null)}>
          <span>＋ 在末尾添加新课题（双击）</span>
        </div>
      </div>

      {selectedIds.length > 1 && !compact && (
        <div className="hier-selbar">
          已选中 <b>{selectedIds.length}</b> 项
          <button onClick={() => bulkProgress(selectedIds, 100, { source: 'hierarchy', action: '批量完成', detail: `${selectedIds.length} 项` })}>全部完成</button>
          <button onClick={() => chainDependencies(selectedIds, { source: 'hierarchy', action: '批量建立依赖', detail: `串联 ${selectedIds.length} 项` })}>串联依赖</button>
          <button onClick={() => bulkShift(selectedIds, 1, { source: 'hierarchy', action: '批量改期', detail: `${selectedIds.length} 项 +1` })}>后移 1 天</button>
          <button
            className="danger"
            onClick={() => {
              if (confirm(`删除选中的 ${selectedIds.length} 个任务？三视图将同步移除。`))
                bulkRemove(selectedIds, { source: 'hierarchy', action: '批量删除', detail: `${selectedIds.length} 项` });
            }}
          >
            删除
          </button>
          <button onClick={() => setSelection([])}>取消</button>
        </div>
      )}

      {box && (
        <div
          className="hier-box"
          style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
        />
      )}

      {menu && <ContextMenu x={menu.x} y={menu.y} entries={menu.entries} onClose={() => setMenu(null)} />}
    </div>
  );
}
