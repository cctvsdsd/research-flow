import { useMemo, useRef, useState, PointerEvent as RPointerEvent } from 'react';
import { Derived, STATUS_COLOR, Task } from '../types';
import { useTaskStore, useCanvasTasks } from '../store/useTaskStore';
import { addDays, diffDays, formatCN, isWeekend, startOfMonth, startOfWeek, today, weekdayCN } from '../lib/date';
import { durationOf } from '../lib/schedule';

const WEEK_HEAD = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

export default function CalendarView({ derived, compact }: { derived: Record<string, Derived>; compact?: boolean }) {
  const tasks = useCanvasTasks();
  const selectedId = useTaskStore((s) => s.selectedId);
  const hideDone = useTaskStore((s) => s.hideDone);
  const select = useTaskStore((s) => s.select);
  const toggleDone = useTaskStore((s) => s.toggleDone);
  const setDates = useTaskStore((s) => s.setDates);
  const addTask = useTaskStore((s) => s.addTask);
  const draggingIdRef = useRef<string | null>(null);

  const [mode, setMode] = useState<'month' | 'week'>(compact ? 'week' : 'month');
  const [basis, setBasis] = useState<'due' | 'span'>('due');
  const [anchor, setAnchor] = useState(today());
  const [dragOver, setDragOver] = useState<string | null>(null);
  const tRef = today();

  // 类型守卫：带日期的任务（日历只排有日期的项）
  const hasDates = (t: Task): t is Task & { startDate: string; dueDate: string } => !!t.startDate && !!t.dueDate;
  // 显式类型谓词，确保 .filter 收窄类型（calendar 只排有日期且用户选择显示的项）
  const isCal = (t: Task): t is Task & { startDate: string; dueDate: string } => t.showInCalendar && hasDates(t);

  // 日历只呈现「用户选择显示」且「有日期」的任务：由每项的 showInCalendar 决定
  const calTasks = useMemo(() => tasks.filter(isCal), [tasks]);
  const visible = useMemo(
    () => (hideDone ? calTasks.filter((t) => derived[t.id]?.status !== 'done') : calTasks),
    [calTasks, derived, hideDone],
  );
  const hiddenCount = tasks.filter((t) => hasDates(t) && !t.showInCalendar).length;
  // 未排期：没有任何日期的任务，集中放在底部桶，可拖入某日赋予日期
  const unscheduled = useMemo(() => tasks.filter((t) => !hasDates(t)), [tasks]);

  const days: string[] = useMemo(() => {
    if (mode === 'month') {
      const s = startOfWeek(startOfMonth(anchor));
      return Array.from({ length: 42 }, (_, i) => addDays(s, i));
    }
    const s = startOfWeek(anchor);
    return Array.from({ length: 7 }, (_, i) => addDays(s, i));
  }, [mode, anchor]);

  const byDay = useMemo(() => {
    const m = new Map<string, typeof visible>();
    for (const d of days) {
      m.set(
        d,
        visible
          .filter((t) => (basis === 'due' ? t.dueDate === d : t.startDate <= d && d <= t.dueDate))
          .sort((a, b) => {
            const sa = derived[a.id]?.status ?? 'todo';
            const sb = derived[b.id]?.status ?? 'todo';
            const rank = (s: string) => (s === 'delayed' ? 0 : s === 'blocked' ? 1 : s === 'doing' ? 2 : s === 'todo' ? 3 : 4);
            return rank(sa) - rank(sb);
          }),
      );
    }
    return m;
  }, [days, visible, basis, derived]);

  const stats = useMemo(() => {
    const leaf = calTasks.filter((t) => !derived[t.id]?.hasChildren);
    const done = leaf.filter((t) => derived[t.id]?.isDone).length;
    const overdue = leaf.filter((t) => !derived[t.id]?.isDone && diffDays(t.dueDate, tRef) > 0);
    const dueToday = leaf.filter((t) => !derived[t.id]?.isDone && t.dueDate === tRef);
    const wkStart = startOfWeek(tRef);
    const thisWeek = leaf.filter((t) => {
      const d = derived[t.id];
      if (d?.isDone) return false;
      return t.dueDate >= wkStart && diffDays(wkStart, t.dueDate) < 7;
    });
    return { total: leaf.length, done, rate: leaf.length ? Math.round((done / leaf.length) * 100) : 0, overdue, dueToday, thisWeek };
  }, [calTasks, derived, tRef]);

  const focus = useMemo(() => {
    const list = calTasks.filter((t) => {
      const d = derived[t.id];
      if (d?.isDone) return false;
      const overdue = diffDays(t.dueDate, tRef) > 0;
      const running = t.startDate <= tRef && tRef <= t.dueDate;
      const dueToday = t.dueDate === tRef;
      return overdue || running || dueToday;
    });
    return list.sort((a, b) => (diffDays(tRef, a.dueDate) - diffDays(tRef, b.dueDate)));
  }, [calTasks, derived, tRef]);

  const onDrop = (day: string) => {
    setDragOver(null);
    const id = draggingIdRef.current;
    draggingIdRef.current = null;
    if (!id) return;
    const t = tasks.find((x) => x.id === id);
    if (!t) return;
    // 从「未排期」桶拖来的无日期任务：落在某日即赋予单日日期
    if (!t.startDate || !t.dueDate) {
      setDates(id, day, day, { source: 'calendar', action: '从未排期放入日历', detail: `「${t.title}」→ ${formatCN(day)}` });
      return;
    }
    const dur = durationOf(t);
    const due = day;
    const start = addDays(due, -(dur - 1));
    if (start === t.startDate && due === t.dueDate) return;
    setDates(id, start, due, { source: 'calendar', action: '拖拽改期', detail: `「${t.title}」→ ${formatCN(due)} 截止` });
  };

  // 边缘拉伸手柄：拖动改变 start / due（Google 日历风格）
  const resizeRef = useRef<{ id: string; mode: 'l' | 'r'; startX: number; cellW: number; start: string; due: string; applied: number } | null>(null);
  const beginResize = (e: RPointerEvent, t: Task & { startDate: string; dueDate: string }, mode: 'l' | 'r') => {
    e.stopPropagation();
    e.preventDefault();
    const cell = (e.currentTarget as HTMLElement).closest('.cal-cell, .cal-day-col') as HTMLElement | null;
    const cellW = cell ? cell.getBoundingClientRect().width : 80;
    resizeRef.current = { id: t.id, mode, startX: e.clientX, cellW, start: t.startDate, due: t.dueDate, applied: 0 };
    const move = (ev: PointerEvent) => {
      const d = resizeRef.current;
      if (!d) return;
      const delta = Math.round((ev.clientX - d.startX) / d.cellW);
      if (delta === d.applied) return;
      d.applied = delta;
      let ns = d.start;
      let nd = d.due;
      if (d.mode === 'l') {
        ns = addDays(d.start, delta);
        if (ns > nd) ns = nd;
      } else {
        nd = addDays(d.due, delta);
        if (nd < ns) nd = ns;
      }
      useTaskStore.getState().setDates(d.id, ns, nd, { source: 'calendar', action: mode === 'l' ? '调整开始日' : '调整截止日', detail: t.title });
    };
    const up = () => {
      resizeRef.current = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const newTaskOn = (day: string) => {
    const sel = tasks.find((t) => t.id === selectedId);
    const rootId = tasks.find((t) => !t.parentId)?.id ?? null;
    addTask({ title: '新任务', dueDate: day, parentId: sel ? sel.parentId ?? sel.id : rootId }, { source: 'calendar', action: '日历新建任务', detail: `${formatCN(day)} 截止` });
  };

  const chip = (t: (typeof visible)[number], day: string) => {
    const d = derived[t.id];
    const color = STATUS_COLOR[d?.status ?? 'todo'];
    return (
      <div
        key={`${day}-${t.id}`}
        className={`chip${d?.isDone ? ' done' : ''}${selectedId === t.id ? ' selected' : ''}`}
        style={{ borderLeftColor: color }}
        draggable
        onDragStart={(e) => {
          draggingIdRef.current = t.id;
          e.dataTransfer.setData('text/plain', t.id);
          e.dataTransfer.effectAllowed = 'move';
        }}
        onDragEnd={() => { draggingIdRef.current = null; }}
        onClick={() => select(t.id)}
        title={`${t.title}\n${t.startDate} → ${t.dueDate}（${durationOf(t)} 天）\n拖动任务改期 · 拖两端手柄拉伸起止日期\n进度 ${t.progress}%${d?.isBlocked ? '\n阻塞于：' + d.blockedBy.map((b) => tasks.find((x) => x.id === b)?.title).join('、') : ''}`}
      >
        <span className="chip-resize l" title="拖动改开始日" onPointerDown={(e) => beginResize(e, t, 'l')} />
        <input
          type="checkbox"
          checked={t.progress >= 100}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => {
            e.stopPropagation();
            toggleDone(t.id, { source: 'calendar', action: e.target.checked ? '勾选完成' : '取消完成', detail: t.title });
          }}
        />
        <span>{t.title}</span>
        {t.kind === 'plan' && <span className="badge kind-plan">计划</span>}
        {basis === 'span' && <span className="badge">{d?.isDone ? '' : `${t.progress}%`}</span>}
        {d?.isDelayed && <span className="badge" style={{ background: 'rgba(239,68,68,0.35)' }}>逾期</span>}
        <span className="chip-resize r" title="拖动改截止日" onPointerDown={(e) => beginResize(e, t, 'r')} />
      </div>
    );
  };

  return (
    <>
      <div className="cal-tools">
        <button onClick={() => setAnchor(addDays(anchor, mode === 'month' ? -30 : -7))}>‹</button>
        <button onClick={() => setAnchor(today())}>今天</button>
        <button onClick={() => setAnchor(addDays(anchor, mode === 'month' ? 30 : 7))}>›</button>
        <b style={{ minWidth: 120, textAlign: 'center' }}>
          {mode === 'month' ? `${anchor.slice(0, 7).replace('-', ' 年 ')} 月` : `${formatCN(days[0])} – ${formatCN(days[6])}`}
        </b>
        <button className={mode === 'month' ? 'active' : ''} onClick={() => setMode('month')}>月视图</button>
        <button className={mode === 'week' ? 'active' : ''} onClick={() => setMode('week')}>周视图</button>
        <span style={{ color: 'var(--muted)' }}>按</span>
        <button className={basis === 'due' ? 'active' : ''} onClick={() => setBasis('due')}>截止日</button>
        <button className={basis === 'span' ? 'active' : ''} onClick={() => setBasis('span')}>执行期</button>
        <button className={hideDone ? 'active' : ''} style={{ marginLeft: 'auto' }} onClick={() => useTaskStore.getState().setHideDone(!hideDone)}>
          隐藏已完成
        </button>
        {hiddenCount > 0 && (
          <span className="cal-hidden" title="这些项被设为「不在日历显示」，可在任意视图的右键菜单或眼睛图标重新打开">
            🙈 已隐藏 {hiddenCount} 项
          </span>
        )}
      </div>

      {!compact && (
        <div className="cal-stats">
          <div className="stat">
            <b style={{ color: STATUS_COLOR.delayed }}>{stats.overdue.length}</b>
            <span>已逾期</span>
          </div>
          <div className="stat">
            <b style={{ color: STATUS_COLOR.doing }}>{stats.dueToday.length}</b>
            <span>今天到期</span>
          </div>
          <div className="stat">
            <b>{stats.thisWeek.length}</b>
            <span>本周到期</span>
          </div>
          <div className="stat">
            <b style={{ color: STATUS_COLOR.done }}>{stats.rate}%</b>
            <span>完成率（{stats.done}/{stats.total}）</span>
          </div>
        </div>
      )}

      {!compact && (
        <div className="focus-list">
        {focus.length === 0 ? (
          <div className="stat" style={{ flex: 1, color: 'var(--muted)' }}>今日无待办，去甘特图看看下一步排期吧</div>
        ) : (
          focus.slice(0, 12).map((t) => {
            const d = derived[t.id];
            const color = STATUS_COLOR[d?.status ?? 'todo'];
            const over = diffDays(t.dueDate, tRef) > 0;
            return (
              <div key={t.id} className="focus-card" style={{ borderLeftColor: color }} onClick={() => select(t.id)}>
                <div className="t">{t.title}</div>
                <div className="m">
                  <input
                    type="checkbox"
                    checked={t.progress >= 100}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => toggleDone(t.id, { source: 'calendar', action: e.target.checked ? '勾选完成' : '取消完成', detail: t.title })}
                  />
                  <span>{over ? `逾期 ${diffDays(t.dueDate, tRef)} 天` : `截止 ${formatCN(t.dueDate)}`}</span>
                  <span>· {t.progress}%</span>
                  {d?.isBlocked && <span className="pill s-blocked">阻塞</span>}
                </div>
              </div>
            );
          })
        )}
        </div>
      )}

      <div className="cal-wrap">
        {mode === 'month' ? (
          <div className="cal-grid">
            <div className="cal-head">
              {WEEK_HEAD.map((w) => (
                <div key={w}>{w}</div>
              ))}
            </div>
            {Array.from({ length: 6 }, (_, w) => (
              <div className="cal-week" key={w}>
                {days.slice(w * 7, w * 7 + 7).map((day) => {
                  const list = byDay.get(day) ?? [];
                  const other = day.slice(0, 7) !== anchor.slice(0, 7);
                  return (
                    <div
                      key={day}
                      className={`cal-cell${other ? ' other' : ''}${isWeekend(day) ? ' weekend' : ''}${dragOver === day ? ' dropping' : ''}`}
                      onDragOver={(e) => { e.preventDefault(); setDragOver(day); }}
                      onDragLeave={() => setDragOver((c) => (c === day ? null : c))}
                      onDrop={(e) => { e.preventDefault(); onDrop(day); }}
                    >
                      <div className={`cal-cell-num${day === tRef ? ' today' : ''}`} style={{ opacity: other ? 0.5 : 1 }}>
                        <span>{day === tRef ? `今天 ${Number(day.slice(8, 10))}` : Number(day.slice(8, 10))}</span>
                        <button className="cal-add" title="在此日新建任务" onClick={() => newTaskOn(day)}>+</button>
                      </div>
                      <div className="cal-chips">{list.slice(0, 4).map((t) => chip(t, day))}{list.length > 4 && <span style={{ fontSize: 10, color: 'var(--muted)' }}>还有 {list.length - 4} 项…</span>}</div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        ) : (
          <div className="cal-week-view">
            {days.map((day) => {
              const list = byDay.get(day) ?? [];
              return (
                <div
                  key={day}
                  className={`cal-day-col${dragOver === day ? ' dropping' : ''}`}
                  onDragOver={(e) => { e.preventDefault(); setDragOver(day); }}
                  onDragLeave={() => setDragOver((c) => (c === day ? null : c))}
                  onDrop={(e) => { e.preventDefault(); onDrop(day); }}
                >
                  <div className={`cal-day-head${day === tRef ? ' today' : ''}`}>
                    <span>周{weekdayCN(day)} {Number(day.slice(8, 10))}日</span>
                    <button className="cal-add" style={{ opacity: 1 }} title="新建任务" onClick={() => newTaskOn(day)}>+</button>
                  </div>
                  <div className="cal-day-body">
                    {list.map((t) => chip(t, day))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {unscheduled.length > 0 && (
        <div className="cal-unscheduled">
          <div className="cal-unscheduled-head">🗓 未排期（{unscheduled.length}）· 拖到日历某日即可安排日期</div>
          <div className="cal-unscheduled-list">
            {unscheduled.map((t) => {
              const d = derived[t.id];
              const color = STATUS_COLOR[d?.status ?? 'todo'];
              return (
                <div
                  key={t.id}
                  className={`chip unsched${d?.isDone ? ' done' : ''}`}
                  style={{ borderLeftColor: color }}
                  draggable
                  onDragStart={(e) => {
                    draggingIdRef.current = t.id;
                    e.dataTransfer.setData('text/plain', t.id);
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  onDragEnd={() => { draggingIdRef.current = null; }}
                  onClick={() => select(t.id)}
                  title={`${t.title}\n未排期 · 拖到日历某日赋予日期`}
                >
                  <input
                    type="checkbox"
                    checked={t.progress >= 100}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => {
                      e.stopPropagation();
                      toggleDone(t.id, { source: 'calendar', action: e.target.checked ? '勾选完成' : '取消完成', detail: t.title });
                    }}
                  />
                  <span>{t.title}</span>
                  {t.kind === 'plan' && <span className="badge kind-plan">计划</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
