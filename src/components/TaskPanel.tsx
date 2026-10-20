import { useEffect, useMemo, useState } from 'react';
import { Derived, KIND_LABEL, STATUS_LABEL, Status } from '../types';
import { useTaskStore, useCanvasTasks } from '../store/useTaskStore';
import { descendantsOf, durationOf, topoSort } from '../lib/schedule';
import { formatCN } from '../lib/date';
import { StatusPill } from './common';

export default function TaskPanel({ derived }: { derived: Record<string, Derived> }) {
  const tasks = useCanvasTasks();
  const selectedId = useTaskStore((s) => s.selectedId);
  const updateTask = useTaskStore((s) => s.updateTask);
  const setProgress = useTaskStore((s) => s.setProgress);
  const setDates = useTaskStore((s) => s.setDates);
  const setParent = useTaskStore((s) => s.setParent);
  const addDependency = useTaskStore((s) => s.addDependency);
  const removeDependency = useTaskStore((s) => s.removeDependency);
  const removeTask = useTaskStore((s) => s.removeTask);
  const addChild = useTaskStore((s) => s.addChild);
  const setStatusLock = useTaskStore((s) => s.setStatusLock);
  const setView = useTaskStore((s) => s.setView);
  const setKind = useTaskStore((s) => s.setKind);
  const toggleCalendar = useTaskStore((s) => s.toggleCalendar);
  const settings = useTaskStore((s) => s.settings);
  /** 具体起止时间：默认折叠；已有时间或设置开启时自动展开 */
  const [showTime, setShowTime] = useState(false);

  const task = tasks.find((t) => t.id === selectedId) ?? null;
  const d = task ? derived[task.id] : undefined;

  useEffect(() => {
    if (task) setShowTime(!!(task.startTime || task.endTime) || settings.timesExpanded);
  }, [task, settings.timesExpanded]);

  const depCandidates = useMemo(() => {
    if (!task) return [];
    const banned = new Set([task.id, ...descendantsOf(tasks, task.id), ...task.dependsOn]);
    return tasks.filter((t) => {
      if (banned.has(t.id)) return false;
      const probe = tasks.map((x) => (x.id === task.id ? { ...x, dependsOn: [...x.dependsOn, t.id] } : x));
      return topoSort(probe).cyclic.size === 0;
    });
  }, [task, tasks]);

  const parentCandidates = useMemo(() => {
    if (!task) return [];
    const banned = new Set([task.id, ...descendantsOf(tasks, task.id)]);
    return tasks.filter((t) => !banned.has(t.id));
  }, [task, tasks]);

  if (!task || !d) {
    return (
      <aside className="panel">
        <h3>任务详情</h3>
        <div className="panel-empty">
          在任一视图中点击任务即可编辑。
          <br />
          <br />
          三个视图共用同一份任务数据，
          <br />
          任何一处修改都会实时同步到其余两处。
        </div>
      </aside>
    );
  }

  return (
    <aside className="panel">
      <h3>任务详情</h3>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '6px 0 10px' }}>
        <StatusPill status={d.status} />
        {d.critical && <span className="pill" style={{ color: '#fca5a5', borderColor: 'rgba(249,115,22,0.5)', background: 'rgba(249,115,22,0.15)' }}>关键路径</span>}
        {d.isDelayed && <span className="pill s-delayed">逾期 {formatCN(task.dueDate)}</span>}
      </div>

      <label>任务名称</label>
      <input value={task.title} onChange={(e) => updateTask(task.id, { title: e.target.value }, { source: 'panel', action: '修改标题', detail: e.target.value })} />

      <div className="row">
        <div>
          <label>类型</label>
          <select
            value={task.kind}
            onChange={(e) => setKind(task.id, e.target.value as 'plan' | 'task', { source: 'panel', action: '切换类型', detail: `${task.title} → ${KIND_LABEL[e.target.value as 'plan' | 'task']}` })}
          >
            <option value="task">任务（已排期，默认进日历）</option>
            <option value="plan">计划（构思中，默认不进日历）</option>
          </select>
        </div>
        <div>
          <label>在日历中显示</label>
          <button
            className={task.showInCalendar ? 'active' : 'ghost'}
            style={{ width: '100%', marginTop: 0 }}
            onClick={() => toggleCalendar(task.id, { source: 'panel', action: task.showInCalendar ? '移出日历' : '加入日历', detail: task.title })}
          >
            {task.showInCalendar ? '✓ 显示在日历' : '🙈 不在日历'}
          </button>
        </div>
      </div>

      <div className="row">
        <div>
          <label>负责人</label>
          <input value={task.owner} placeholder="可选" onChange={(e) => updateTask(task.id, { owner: e.target.value }, { source: 'panel', action: '修改负责人', detail: e.target.value })} />
        </div>
        <div>
          <label>状态（手动覆盖）</label>
          <select
            value={task.statusLocked ? task.status : 'auto'}
            onChange={(e) => {
              const v = e.target.value;
              setStatusLock(task.id, v === 'auto' ? null : (v as Status), { source: 'panel', action: '锁定状态', detail: v === 'auto' ? '恢复自动推导' : STATUS_LABEL[v as Status] });
            }}
          >
            <option value="auto">自动推导</option>
            {(Object.keys(STATUS_LABEL) as Status[]).map((s) => (
              <option key={s} value={s}>{STATUS_LABEL[s]}</option>
            ))}
          </select>
        </div>
      </div>

      <label>进度 {task.progress}%</label>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input type="range" min={0} max={100} value={task.progress} style={{ padding: 0 }} onChange={(e) => setProgress(task.id, Number(e.target.value), { source: 'panel', action: '调整进度', detail: `${task.title} → ${e.target.value}%` })} />
        <button onClick={() => setProgress(task.id, task.progress >= 100 ? 0 : 100, { source: 'panel', action: task.progress >= 100 ? '取消完成' : '标记完成', detail: task.title })}>
          {task.progress >= 100 ? '取消完成' : '标记完成'}
        </button>
      </div>

      <div className="row">
        <div>
          <label>开始日期</label>
          <input type="date" value={task.startDate} onChange={(e) => e.target.value && setDates(task.id, e.target.value, task.dueDate, { source: 'panel', action: '修改开始日', detail: `${task.title} → ${e.target.value}` })} />
        </div>
        <div>
          <label>截止日期</label>
          <input type="date" value={task.dueDate}               onChange={(e) => e.target.value && setDates(task.id, task.startDate, e.target.value, { source: 'panel', action: '修改截止日', detail: `${task.title} → ${e.target.value}` })} />
        </div>
      </div>

      <div className="time-toggle-row">
        <button className="time-toggle" onClick={() => setShowTime((v) => !v)} title="设置具体起止时间（默认不填）">
          🕒 具体时间（开始/结束时刻）{showTime ? ' ▾' : ' ▸'}
        </button>
        {showTime && (
          <div className="time-inputs">
            <label>
              开始时刻
              <input type="time" value={task.startTime ?? ''} onChange={(e) => updateTask(task.id, { startTime: e.target.value }, { source: 'panel', action: '修改开始时间', detail: task.title })} />
            </label>
            <label>
              结束时刻
              <input type="time" value={task.endTime ?? ''} onChange={(e) => updateTask(task.id, { endTime: e.target.value }, { source: 'panel', action: '修改结束时间', detail: task.title })} />
            </label>
          </div>
        )}
      </div>

      <label>父任务（思维导图层级）</label>
      <select
        value={task.parentId ?? ''}
        onChange={(e) => setParent(task.id, e.target.value || null, { source: 'panel', action: '调整层级', detail: `${task.title} → ${e.target.value ? tasks.find((x) => x.id === e.target.value)?.title : '顶层'}` })}
      >
        <option value="">（顶层课题）</option>
        {parentCandidates.map((t) => (
          <option key={t.id} value={t.id}>{t.title}</option>
        ))}
      </select>

      <div className="panel-sec">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <b style={{ fontSize: 12 }}>前置依赖（{task.dependsOn.length}）</b>
        </div>
        <div className="dep-list" style={{ marginTop: 6 }}>
          {task.dependsOn.length === 0 && <div style={{ color: 'var(--muted)', fontSize: 11 }}>无依赖</div>}
          {task.dependsOn.map((id) => {
            const dep = tasks.find((t) => t.id === id);
            return (
              <div className="dep-item" key={id}>
                <i className="dot" style={{ width: 7, height: 7, borderRadius: '50%', background: dep ? (dep.progress >= 100 ? 'var(--done)' : 'var(--delayed)') : '#333' }} />
                <span onClick={() => useTaskStore.getState().select(id)} style={{ cursor: 'pointer' }}>{dep?.title ?? id}</span>
                <span style={{ fontSize: 10, color: 'var(--muted)' }}>{dep?.progress ?? 0}%</span>
                <button className="icon" onClick={() => removeDependency(task.id, id, { source: 'panel', action: '移除依赖', detail: `${dep?.title} ⇢ ${task.title}` })}>×</button>
              </div>
            );
          })}
        </div>
        <label>添加前置依赖</label>
        <select
          value=""
          onChange={(e) => {
            if (!e.target.value) return;
            addDependency(task.id, e.target.value, { source: 'panel', action: '添加依赖', detail: `${tasks.find((x) => x.id === e.target.value)?.title} ⇢ ${task.title}` });
          }}
        >
          <option value="">选择任务…</option>
          {depCandidates.map((t) => (
            <option key={t.id} value={t.id}>{t.title}</option>
          ))}
        </select>
      </div>

      <div className="panel-sec">
        <label>备注</label>
        <textarea value={task.note} onChange={(e) => updateTask(task.id, { note: e.target.value }, { source: 'panel', action: '修改备注', detail: task.title })} />
      </div>

      <div className="panel-sec">
        <div className="kv"><span>工期</span><b>{durationOf(task)} 天</b></div>
        <div className="kv"><span>依赖约束最早开始</span><b>{d.earliestStart}</b></div>
        <div className="kv"><span>总浮动</span><b>{d.slack} 天{d.critical ? '（关键路径）' : ''}</b></div>
        {d.isBlocked && (
          <div className="kv">
            <span>阻塞来源</span>
            <b>{d.blockedBy.map((id) => tasks.find((t) => t.id === id)?.title).join('、')}</b>
          </div>
        )}
        {d.hasChildren && <div className="kv"><span>子任务</span><b>{task.progress}% 由 {d.subtreeSize - 1} 个子项汇总</b></div>}
      </div>

      <div className="panel-sec" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button onClick={() => addChild(task.id, { source: 'panel', action: '新增子任务', detail: task.title })}>+ 子任务</button>
        <button onClick={() => setView('gantt')}>在甘特图查看</button>
        <button onClick={() => setView('calendar')}>在日历查看</button>
        <button
          style={{ color: '#fca5a5', borderColor: 'rgba(239,68,68,0.5)' }}
          onClick={() => {
            const n = d.subtreeSize;
            if (confirm(`确认删除「${task.title}」${n > 1 ? `及其 ${n - 1} 个子任务` : ''}？三个视图将同步移除。`)) {
              removeTask(task.id, { source: 'panel', action: '删除任务', detail: task.title });
            }
          }}
        >
          删除任务
        </button>
      </div>
    </aside>
  );
}
