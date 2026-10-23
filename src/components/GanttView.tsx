import { useEffect, useMemo, useRef, useState } from 'react';
import { Derived } from '../types';
import { STATUS_COLOR } from '../types';
import { useTaskStore } from '../store/useTaskStore';
import { useCanvasTasks } from '../store/useTaskStore';
import { addDays, addDaysSafe, diffDays, isWeekend, maxDateSafe, minDateSafe, parseDate, today } from '../lib/date';
import { flattenTree } from '../lib/schedule';
import { durationOf, childrenOf } from '../lib/schedule';

const ROW_H = 32;

type DragMode = 'move' | 'l' | 'r' | 'progress';

export default function GanttView({ derived, compact }: { derived: Record<string, Derived>; compact?: boolean }) {
  const LEFT_W = compact ? 148 : 268;

  const tasks = useCanvasTasks();
  const collapsed = useTaskStore((s) => s.collapsed);
  const dayWidth = useTaskStore((s) => s.dayWidth);
  const selectedId = useTaskStore((s) => s.selectedId);
  const selectedIds = useTaskStore((s) => s.selectedIds);
  const setSelection = useTaskStore((s) => s.setSelection);
  const hideDone = useTaskStore((s) => s.hideDone);
  const select = useTaskStore((s) => s.select);
  const toggleCollapse = useTaskStore((s) => s.toggleCollapse);
  const bulkCollapse = useTaskStore((s) => s.bulkCollapse);
  const collapseAll = useTaskStore((s) => s.collapseAll);
  const expandAll = useTaskStore((s) => s.expandAll);
  const setDayWidth = useTaskStore((s) => s.setDayWidth);
  const setDates = useTaskStore((s) => s.setDates);
  const clearSelOnOutsideClick = useTaskStore((s) => s.settings.clearSelOnOutsideClick);
  const ganttCollapseTasks = useTaskStore((s) => s.settings.ganttCollapseTasks);
  const showPlanBadge = useTaskStore((s) => s.settings.showPlanBadge);
  const hideNotInCal = useTaskStore((s) => s.hideNotInCal);
  const setHideNotInCal = useTaskStore((s) => s.setHideNotInCal);

  const scrollRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; mode: DragMode; startX: number; base: { start: string | null; due: string | null }; barLeft: number; barWidth: number; applied: number; isSummary: boolean } | null>(null);
  /** 行内日期编辑：正在改哪一行的哪个端点 */
  const [dateEdit, setDateEdit] = useState<{ id: string; edge: 'start' | 'due' } | null>(null);
  /** 框选矩形（视口坐标） */
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const dragSel = useRef<{ startX: number; startY: number; moved: boolean } | null>(null);
  const rowsRef = useRef<HTMLDivElement>(null);
  const selSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  // 甘特默认折叠：当 ganttCollapseTasks 开启时，仅任务型节点默认收起子级，计划型节点默认展开
  const effCollapsed = useMemo(() => {
    const c: Record<string, boolean> = { ...collapsed };
    if (ganttCollapseTasks) {
      for (const t of tasks) {
        if (t.kind === 'task' && childrenOf(tasks, t.id).length > 0) c[t.id] = true;
      }
    }
    return c;
  }, [collapsed, ganttCollapseTasks, tasks]);

  const rows = useMemo(() => {
    let list = flattenTree(tasks, effCollapsed);
    if (hideDone) list = list.filter((t) => derived[t.id]?.status !== 'done');
    if (hideNotInCal) list = list.filter((t) => t.showInCalendar);
    return list;
  }, [tasks, effCollapsed, hideDone, hideNotInCal, derived]);

  // 父计划标题表：用于行内「所属计划」徽标
  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const parentPlanOf = (id: string): string | null => {
    let cur = byId.get(id)?.parentId ?? null;
    while (cur) {
      const p = byId.get(cur);
      if (!p) break;
      if (p.kind === 'plan') return p.title;
      cur = p.parentId;
    }
    return null;
  };

  const { rangeStart, days } = useMemo(() => {
    let min: string | null = null;
    let max: string | null = null;
    for (const t of tasks) {
      min = minDateSafe(min, t.startDate);
      max = maxDateSafe(max, t.dueDate);
    }
    // 没有任何带日期的任务时，默认展示以今天为中心的区间
    const start = min ? addDays(min, -7) : addDays(today(), -7);
    const end = max ? addDays(max, 14) : addDays(today(), 30);
    const arr: string[] = [];
    for (let d = start; diffDays(d, end) >= 0; d = addDays(d, 1)) arr.push(d);
    return { rangeStart: start, days: arr };
  }, [tasks]);

  const xOf = (date: string) => LEFT_W + diffDays(rangeStart, date) * dayWidth;
  const totalW = LEFT_W + days.length * dayWidth;

  // 月份分组表头
  const months = useMemo(() => {
    const out: { label: string; count: number }[] = [];
    for (const d of days) {
      const label = `${Number(d.slice(5, 7))}月`;
      const last = out[out.length - 1];
      if (last && last.label === label) last.count += 1;
      else out.push({ label, count: 1 });
    }
    return out;
  }, [days]);

  const tRef = today();

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const x = xOf(tRef) - 240;
    el.scrollLeft = Math.max(0, x);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rowIndex = useMemo(() => {
    const m = new Map<string, number>();
    rows.forEach((t, i) => m.set(t.id, i));
    return m;
  }, [rows]);

  /* ---------------- 框选：在行区域空白处按下左键拖动 ---------------- */
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = dragSel.current;
      if (!d || d.moved) return;
      if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > 5) {
        d.moved = true;
        setBox({ x: d.startX, y: d.startY, w: 0, h: 0 });
      }
    };
    const onUpdate = (e: MouseEvent) => {
      if (!dragSel.current?.moved) return;
      setBox((b) => (b ? { ...b, w: e.clientX - b.x, h: e.clientY - b.y } : b));
    };
    const onUp = (e: MouseEvent) => {
      const d = dragSel.current;
      dragSel.current = null;
      if (!d || !d.moved) { setBox(null); return; }
      const el = rowsRef.current;
      if (el) {
        const L = Math.min(d.startX, e.clientX);
        const R = Math.max(d.startX, e.clientX);
        const T = Math.min(d.startY, e.clientY);
        const B = Math.max(d.startY, e.clientY);
        const hits: string[] = [];
        el.querySelectorAll<HTMLElement>('.gantt-row').forEach((row) => {
          const r = row.getBoundingClientRect();
          if (r.right >= L && r.left <= R && r.bottom >= T && r.top <= B) {
            const id = row.dataset.id;
            if (id) hits.push(id);
          }
        });
        if (hits.length) setSelection(hits);
        else if (clearSelOnOutsideClick) setSelection([]);
      }
      setBox(null);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mousemove', onUpdate);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mousemove', onUpdate);
      window.removeEventListener('mouseup', onUp);
    };
  }, [setSelection, clearSelOnOutsideClick]);

  /** 行区域按下：可能是框选，也可能是拖条改期 —— 交给各自处理，这里只标记起点 */
  const onRowsMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    // 进度手柄 / 两端手柄 / 条本身 / 按钮：不参与框选
    if (target.closest('.gantt-bar') || target.closest('button') || target.closest('input') || target.closest('select')) return;
    dragSel.current = { startX: e.clientX, startY: e.clientY, moved: false };
  };

  /** 行点击：单击选中（若刚刚是在框选则忽略） */
  const onRowClick = (id: string) => {
    if (dragSel.current?.moved) return;
    select(id);
  };

  const beginDrag = (e: React.PointerEvent, id: string, mode: DragMode, barLeft: number, barWidth: number) => {
    e.preventDefault();
    e.stopPropagation();
    const t = useTaskStore.getState().tasks.find((x) => x.id === id);
    if (!t) return;
    select(id);
    drag.current = { id, mode, startX: e.clientX, base: { start: t.startDate, due: t.dueDate }, barLeft, barWidth, applied: 0, isSummary: !!derived[id]?.hasChildren };
    const move = (ev: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const st = useTaskStore.getState();
      const deltaDays = Math.round((ev.clientX - d.startX) / st.dayWidth);
      if (d.mode === 'move') {
        if (d.isSummary) {
          // 汇总行：整棵子树一起平移（否则会被父节点自动汇总回原位）
          const step = deltaDays - d.applied;
          if (step !== 0) {
            d.applied = deltaDays;
            st.shiftDates(d.id, step, { source: 'gantt', action: '拖动调整排期', detail: `${st.tasks.find((x) => x.id === d.id)?.title ?? ''} ${deltaDays >= 0 ? '+' : ''}${deltaDays} 天` });
          }
        } else {
          st.setDates(d.id, addDaysSafe(d.base.start, deltaDays), addDaysSafe(d.base.due, deltaDays), {
            source: 'gantt',
            action: '拖动调整排期',
            detail: `${st.tasks.find((x) => x.id === d.id)?.title ?? ''} ${deltaDays >= 0 ? '+' : ''}${deltaDays} 天`,
          });
        }
      } else if (d.mode === 'r') {
        st.setDates(d.id, d.base.start, maxDateSafe(d.base.start, addDaysSafe(d.base.due, deltaDays)), { source: 'gantt', action: '调整截止日', detail: st.tasks.find((x) => x.id === d.id)?.title ?? '' });
      } else if (d.mode === 'l') {
        st.setDates(d.id, minDateSafe(d.base.due, addDaysSafe(d.base.start, deltaDays)), d.base.due, { source: 'gantt', action: '调整开始日', detail: st.tasks.find((x) => x.id === d.id)?.title ?? '' });
      } else {
        const pct = Math.round(((ev.clientX - d.barLeft) / d.barWidth) * 100);
        st.setProgress(d.id, pct, { source: 'gantt', action: '拖动改进度', detail: `${st.tasks.find((x) => x.id === d.id)?.title ?? ''} → ${Math.min(100, Math.max(0, pct))}%` });
      }
    };
    const up = () => {
      drag.current = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // 依赖箭头：隐藏行的依赖上浮到最近可见祖先
  const depArrows = useMemo(() => {
    const vis = new Set(rows.map((t) => t.id));
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const lift = (id: string): string | null => {
      let cur: string | null = id;
      let guard = 0;
      while (cur && guard++ < 50) {
        if (vis.has(cur)) return cur;
        cur = byId.get(cur)?.parentId ?? null;
      }
      return null;
    };
    const out: { key: string; x1: number; y1: number; x2: number; y2: number; crit: boolean }[] = [];
    const seen = new Set<string>();
    for (const t of rows) {
      for (const depId of t.dependsOn) {
        const from = lift(depId);
        const to = lift(t.id);
        if (!from || !to || from === to) continue;
        const key = `${from}->${to}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const ft = byId.get(from)!;
        const f = rowIndex.get(from);
        const g = rowIndex.get(to)!;
        if (f === undefined || !ft.dueDate || !t.startDate) continue;
        out.push({
          key,
          x1: xOf(ft.dueDate) + dayWidth,
          y1: f * ROW_H + ROW_H / 2,
          x2: xOf(t.startDate),
          y2: g * ROW_H + ROW_H / 2,
          crit: !!derived[depId]?.critical && !!derived[t.id]?.critical,
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return out;
  }, [rows, tasks, derived, dayWidth, rangeStart, rowIndex]);

  if (!tasks.length) {
    return (
      <div className="empty-state">
        <h2>还没有任务</h2>
        <div>点击顶部「新建课题」开始，或右键画布空白处新建。</div>
      </div>
    );
  }

  return (
    <>
      <div className="gantt-tools">
        <button onClick={() => setDayWidth(dayWidth - 4)}>−</button>
        <span style={{ color: 'var(--muted)', minWidth: 78 }}>{dayWidth}px / 天</span>
        <button onClick={() => setDayWidth(dayWidth + 4)}>+</button>
        <button
          onClick={() => {
            const el = scrollRef.current;
            if (el) el.scrollLeft = Math.max(0, xOf(tRef) - 240);
          }}
        >
          回到今天
        </button>
        {!compact && (
          <button className={hideDone ? 'active' : ''} onClick={() => useTaskStore.getState().setHideDone(!hideDone)}>
            隐藏已完成
          </button>
        )}
        {!compact && (
          <button className={hideNotInCal ? 'active' : ''} onClick={() => setHideNotInCal(!hideNotInCal)} title="仅显示已加入日历的任务">
            仅看日历内
          </button>
        )}
        <button onClick={collapseAll} title="折叠所有含子任务的行">全部折叠</button>
        <button onClick={expandAll} title="展开所有行">全部展开</button>
        {!compact && <span style={{ color: 'var(--muted)' }}>拖动条=改期 · 拖两端=改工期 · 拖条内白色手柄=改进度 · 左键拖空白=框选 · 点日期可直接改</span>}
        <span className="pill s-delayed" style={{ marginLeft: 'auto' }}>
          <i className="dot" style={{ background: STATUS_COLOR.delayed }} />
          关键路径 {rows.filter((t) => derived[t.id]?.critical).length} 项
        </span>
      </div>

      <div className="gantt-scroll" ref={scrollRef}>
        <div className="gantt-inner" style={{ width: totalW }}>
          <div className="gantt-head">
            <div style={{ display: 'flex' }}>
              <div
                style={{
                  width: LEFT_W,
                  flex: '0 0 auto',
                  position: 'sticky',
                  left: 0,
                  zIndex: 6,
                  background: 'var(--bg-soft)',
                  borderRight: '1px solid var(--border)',
                  padding: '3px 8px',
                  fontSize: 11,
                  color: 'var(--muted)',
                }}
              >
                任务 · 共 {tasks.length} 项
              </div>
              <div style={{ display: 'flex' }}>
                {months.map((m, i) => (
                  <div key={i} style={{ width: m.count * dayWidth, flex: '0 0 auto', borderRight: '1px solid var(--border)', padding: '3px 6px', fontSize: 11, color: 'var(--muted)' }}>
                    {m.label}
                  </div>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex' }}>
              <div
                style={{
                  width: LEFT_W,
                  flex: '0 0 auto',
                  position: 'sticky',
                  left: 0,
                  zIndex: 6,
                  background: 'var(--bg-soft)',
                  borderRight: '1px solid var(--border)',
                  padding: '2px 8px',
                  fontSize: 10,
                  color: 'var(--muted-2)',
                }}
              >
                开始 / 截止
              </div>
              <div style={{ display: 'flex' }}>
                {days.map((d) => (
                  <div
                    key={d}
                    className={`gantt-day${isWeekend(d) ? ' weekend' : ''}${d === tRef ? ' today' : ''}`}
                    style={{ width: dayWidth }}
                    title={d}
                  >
                    {dayWidth >= 16 ? Number(d.slice(8, 10)) : ''}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="gantt-body" style={{ height: rows.length * ROW_H }} ref={rowsRef} onMouseDown={onRowsMouseDown}>
            <div className="gantt-grid" style={{ left: LEFT_W, width: days.length * dayWidth }}>
              {days.map((d) => (
                <div
                  key={d}
                  className={`gantt-col${isWeekend(d) ? ' weekend' : ''}${d.slice(8, 10) === '01' ? ' month-start' : ''}`}
                  style={{ width: dayWidth }}
                />
              ))}
            </div>
            {diffDays(rangeStart, tRef) >= 0 && days.includes(tRef) && (
              <div className="gantt-todayline" style={{ left: xOf(tRef) }} />
            )}

            {rows.map((t) => {
              const d = derived[t.id];
              const color = STATUS_COLOR[d?.status ?? 'todo'];
              const left = t.startDate ? xOf(t.startDate) : LEFT_W;
              const width = t.startDate && t.dueDate ? Math.max(dayWidth * 0.6, durationOf(t) * dayWidth) : 0;
              const isSummary = !!d?.hasChildren;
              const isSel = selSet.has(t.id);
              return (
                <div
                  key={t.id}
                  data-id={t.id}
                  className={`gantt-row${selectedId === t.id ? ' selected' : ''}${isSel ? ' rowsel' : ''}`}
                  style={{ height: ROW_H, width: totalW }}
                  onClick={() => onRowClick(t.id)}
                >
                  <div className="gantt-left" style={{ width: LEFT_W }}>
                    <span style={{ paddingLeft: (d?.depth ?? 0) * 12 }} />
                    <button
                      className="icon ghost"
                      style={{ border: 'none', padding: 0, width: 14, color: 'var(--muted)' }}
                      onClick={(e) => { e.stopPropagation(); toggleCollapse(t.id); }}
                      title="折叠/展开子任务"
                    >
                      {d?.hasChildren ? (effCollapsed[t.id] ? '▸' : '▾') : ''}
                    </button>
                    <div
                      className={`gantt-label${d?.isDone ? ' done' : ''}`}
                      title={t.title}
                      style={{ paddingLeft: 2 }}
                    >
                      {t.title}
                    </div>
                    {showPlanBadge && parentPlanOf(t.id) && (
                      <span className="plan-badge" title={`所属计划：${parentPlanOf(t.id)}`}>
                        {parentPlanOf(t.id)}
                      </span>
                    )}
                    {/* 日期：点一下就能直接改 */}
                    <span className="gantt-dates" onClick={(e) => e.stopPropagation()}>
                      {dateEdit?.id === t.id && dateEdit.edge === 'start' ? (
                        <input
                          type="date"
                          autoFocus
                          className="gantt-date-input"
                          value={t.startDate ?? ''}
                          onChange={(e) => setDates(t.id, e.target.value || null, t.dueDate, { source: 'gantt', action: '修改开始日', detail: `${t.title} → ${e.target.value}` })}
                          onBlur={() => setDateEdit(null)}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') setDateEdit(null); }}
                        />
                      ) : (
                        <span
                          className="gantt-date-cell"
                          title="点击修改开始日期"
                          onClick={(e) => { e.stopPropagation(); setDateEdit({ id: t.id, edge: 'start' }); }}
                        >
                          {t.startDate ? t.startDate.slice(5) : '无'}
                        </span>
                      )}
                      <em>→</em>
                      {dateEdit?.id === t.id && dateEdit.edge === 'due' ? (
                        <input
                          type="date"
                          autoFocus
                          className="gantt-date-input"
                          value={t.dueDate ?? ''}
                          onChange={(e) => setDates(t.id, t.startDate, e.target.value || null, { source: 'gantt', action: '修改截止日', detail: `${t.title} → ${e.target.value}` })}
                          onBlur={() => setDateEdit(null)}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') setDateEdit(null); }}
                        />
                      ) : (
                        <span
                          className="gantt-date-cell"
                          title="点击修改截止日期"
                          onClick={(e) => { e.stopPropagation(); setDateEdit({ id: t.id, edge: 'due' }); }}
                        >
                          {t.dueDate ? t.dueDate.slice(5) : '无'}
                        </span>
                      )}
                    </span>
                    <span style={{ fontSize: 10, color: 'var(--muted)' }}>{t.progress}%</span>
                    <i className="dot" style={{ width: 7, height: 7, borderRadius: '50%', background: color }} />
                  </div>

                  <div
                    className={`gantt-bar${isSummary ? ' summary' : ''}${d?.critical ? ' critical' : ''}${d?.isBlocked ? ' blocked' : ''}${t.kind === 'plan' ? ' plan' : ''}`}
                    style={{ left, width, background: isSummary ? undefined : `${color}33`, border: `1px solid ${color}` }}
                    onPointerDown={(e) => beginDrag(e, t.id, isSummary ? 'move' : 'move', left, width)}
                    onClick={() => select(t.id)}
                    title={`${t.title}\n${t.startDate} → ${t.dueDate}（${durationOf(t)} 天）\n进度 ${t.progress}%${t.kind === 'plan' ? '\n类型：计划（不计入日历）' : ''}${d?.isBlocked ? '\n阻塞：' + d.blockedBy.map((b) => tasks.find((x) => x.id === b)?.title).join('、') : ''}`}
                  >
                    <div className="gantt-bar-fill" style={{ width: `${t.progress}%`, background: color }} />
                    <div className="gantt-bar-text">{isSummary ? '' : t.kind === 'plan' ? '计划' : `${t.progress}%`}</div>
                    {!isSummary && (
                      <>
                        <div className="gantt-bar-handle l" onPointerDown={(e) => beginDrag(e, t.id, 'l', left, width)} />
                        <div className="gantt-bar-handle r" onPointerDown={(e) => beginDrag(e, t.id, 'r', left, width)} />
                        {((t.progressMode ?? 'auto') === 'manual' || !d?.hasChildren) && (
                          <div
                            className="gantt-prog-handle"
                            style={{ left: `calc(${t.progress}% - 4px)` }}
                            onPointerDown={(e) => beginDrag(e, t.id, 'progress', left, width)}
                            title="拖动改进度"
                          />
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}

            <svg className="gantt-dep" width={totalW} height={rows.length * ROW_H}>
              <defs>
                <marker id="ah" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                  <path d="M0,0 L8,4 L0,8 z" fill="#8b7cf6" />
                </marker>
                <marker id="ahc" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                  <path d="M0,0 L8,4 L0,8 z" fill="#f97316" />
                </marker>
              </defs>
              {depArrows.map((a) => {
                const right = a.x2 - 10;
                const path =
                  right > a.x1 + 6
                    ? `M ${a.x1} ${a.y1} H ${right} V ${a.y2} H ${a.x2}`
                    : `M ${a.x1} ${a.y1} H ${a.x1 + 10} V ${a.y2 - ROW_H / 2 - 4} H ${a.x2 - 10} V ${a.y2} H ${a.x2}`;
                return (
                  <path
                    key={a.key}
                    d={path}
                    fill="none"
                    stroke={a.crit ? '#f97316' : '#8b7cf6'}
                    strokeWidth={a.crit ? 2 : 1.3}
                    strokeDasharray={a.crit ? undefined : '4 3'}
                    markerEnd={a.crit ? 'url(#ahc)' : 'url(#ah)'}
                  />
                );
              })}
            </svg>
          </div>
        </div>
      </div>

      {box && <div className="gantt-box" style={{ left: box.x, top: box.y, width: box.w, height: box.h }} />}

      {selectedIds.length > 1 && !compact && (
        <div className="gantt-selbar">
          已框选 <b>{selectedIds.length}</b> 项
          <button onClick={() => bulkCollapse(selectedIds, true)} title="折叠所选（含子任务的节点）">折叠所选</button>
          <button onClick={() => bulkCollapse(selectedIds, false)}>展开所选</button>
          <button onClick={() => setSelection([])}>取消</button>
        </div>
      )}
    </>
  );
}

export function monthLabel(d: string) {
  return `${parseDate(d).getUTCFullYear()}-${Number(d.slice(5, 7))}`;
}
