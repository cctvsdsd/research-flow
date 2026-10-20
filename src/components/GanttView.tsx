import { useEffect, useMemo, useRef } from 'react';
import { Derived } from '../types';
import { STATUS_COLOR } from '../types';
import { useTaskStore } from '../store/useTaskStore';
import { useCanvasTasks } from '../store/useTaskStore';
import { addDays, diffDays, isWeekend, maxDate, minDate, parseDate, today } from '../lib/date';
import { flattenTree } from '../lib/schedule';
import { durationOf } from '../lib/schedule';

const ROW_H = 32;

type DragMode = 'move' | 'l' | 'r' | 'progress';

export default function GanttView({ derived, compact }: { derived: Record<string, Derived>; compact?: boolean }) {
  const LEFT_W = compact ? 148 : 268;

  const tasks = useCanvasTasks();
  const collapsed = useTaskStore((s) => s.collapsed);
  const dayWidth = useTaskStore((s) => s.dayWidth);
  const selectedId = useTaskStore((s) => s.selectedId);
  const hideDone = useTaskStore((s) => s.hideDone);
  const select = useTaskStore((s) => s.select);
  const toggleCollapse = useTaskStore((s) => s.toggleCollapse);
  const setDayWidth = useTaskStore((s) => s.setDayWidth);

  const scrollRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; mode: DragMode; startX: number; base: { start: string; due: string }; barLeft: number; barWidth: number; applied: number; isSummary: boolean } | null>(null);

  const rows = useMemo(() => {
    const list = flattenTree(tasks, collapsed);
    return hideDone ? list.filter((t) => derived[t.id]?.status !== 'done') : list;
  }, [tasks, collapsed, hideDone, derived]);

  const { rangeStart, days } = useMemo(() => {
    if (!tasks.length) return { rangeStart: today(), days: [today()] };
    let min = tasks[0].startDate;
    let max = tasks[0].dueDate;
    for (const t of tasks) {
      min = minDate(min, t.startDate);
      max = maxDate(max, t.dueDate);
    }
    const start = addDays(min, -7);
    const end = addDays(max, 14);
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
          st.setDates(d.id, addDays(d.base.start, deltaDays), addDays(d.base.due, deltaDays), {
            source: 'gantt',
            action: '拖动调整排期',
            detail: `${st.tasks.find((x) => x.id === d.id)?.title ?? ''} ${deltaDays >= 0 ? '+' : ''}${deltaDays} 天`,
          });
        }
      } else if (d.mode === 'r') {
        st.setDates(d.id, d.base.start, maxDate(d.base.start, addDays(d.base.due, deltaDays)), { source: 'gantt', action: '调整截止日', detail: st.tasks.find((x) => x.id === d.id)?.title ?? '' });
      } else if (d.mode === 'l') {
        st.setDates(d.id, minDate(d.base.due, addDays(d.base.start, deltaDays)), d.base.due, { source: 'gantt', action: '调整开始日', detail: st.tasks.find((x) => x.id === d.id)?.title ?? '' });
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
        if (f === undefined) continue;
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
        {!compact && <span style={{ color: 'var(--muted)' }}>拖动条=改期 · 拖两端=改工期 · 拖条内白色手柄=改进度</span>}
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

          <div className="gantt-body" style={{ height: rows.length * ROW_H }}>
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
              const left = xOf(t.startDate);
              const width = Math.max(dayWidth * 0.6, durationOf(t) * dayWidth);
              const isSummary = !!d?.hasChildren;
              return (
                <div
                  key={t.id}
                  className={`gantt-row${selectedId === t.id ? ' selected' : ''}`}
                  style={{ height: ROW_H, width: totalW }}
                >
                  <div className="gantt-left" style={{ width: LEFT_W }}>
                    <span style={{ paddingLeft: (d?.depth ?? 0) * 12 }} />
                    <button
                      className="icon ghost"
                      style={{ border: 'none', padding: 0, width: 14, color: 'var(--muted)' }}
                      onClick={() => toggleCollapse(t.id)}
                      title="折叠/展开子任务"
                    >
                      {d?.hasChildren ? (collapsed[t.id] ? '▸' : '▾') : ''}
                    </button>
                    <div
                      className={`gantt-label${d?.isDone ? ' done' : ''}`}
                      onClick={() => select(t.id)}
                      title={t.title}
                      style={{ paddingLeft: 2 }}
                    >
                      {t.title}
                    </div>
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
                        <div
                          className="gantt-prog-handle"
                          style={{ left: `calc(${t.progress}% - 4px)` }}
                          onPointerDown={(e) => beginDrag(e, t.id, 'progress', left, width)}
                          title="拖动改进度"
                        />
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
    </>
  );
}

export function monthLabel(d: string) {
  return `${parseDate(d).getUTCFullYear()}-${Number(d.slice(5, 7))}`;
}
