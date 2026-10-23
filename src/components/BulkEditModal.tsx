import { useState } from 'react';
import { useTaskStore } from '../store/useTaskStore';
import type { TaskKind } from '../types';

type StatusKey = 'todo' | 'doing' | 'done' | 'blocked';
const STATUS_OPTS: { v: StatusKey; label: string }[] = [
  { v: 'todo', label: '待开始' },
  { v: 'doing', label: '进行中' },
  { v: 'done', label: '已完成' },
  { v: 'blocked', label: '阻塞' },
];
const PROGRESS_OPTS = ['0', '25', '50', '75', '100'];

/**
 * 批量编辑面板：选中 ≥2 项时浮出入口，弹窗内可对「类型 / 状态 / 进度 / 负责人 /
 * 日历显隐 / 整体平移日期」选择性批量改写。未选「不修改」的字段不参与提交。
 */
export default function BulkEditModal() {
  const selectedIds = useTaskStore((s) => s.selectedIds);
  const tasks = useTaskStore((s) => s.tasks);
  const bulkKind = useTaskStore((s) => s.bulkKind);
  const bulkStatus = useTaskStore((s) => s.bulkStatus);
  const bulkProgress = useTaskStore((s) => s.bulkProgress);
  const bulkOwner = useTaskStore((s) => s.bulkOwner);
  const bulkCalendar = useTaskStore((s) => s.bulkCalendar);
  const bulkShift = useTaskStore((s) => s.bulkShift);
  const setSelection = useTaskStore((s) => s.setSelection);

  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<'' | TaskKind>('');
  const [status, setStatus] = useState<'' | StatusKey>('');
  const [progress, setProgress] = useState<string>('');
  const [owner, setOwner] = useState<string>('');
  const [cal, setCal] = useState<'' | 'on' | 'off'>('');
  const [shift, setShift] = useState<string>('0');

  const n = selectedIds.length;
  const selTitles = tasks.filter((t) => selectedIds.includes(t.id)).map((t) => t.title);
  const preview = selTitles.slice(0, 4).join('、') + (selTitles.length > 4 ? ` 等 ${selTitles.length} 项` : '');

  const close = () => {
    setOpen(false);
    setKind('');
    setStatus('');
    setProgress('');
    setOwner('');
    setCal('');
    setShift('0');
  };

  const apply = () => {
    const meta = { source: 'panel' as const, action: '批量编辑', detail: `${n} 项` };
    if (kind) bulkKind(selectedIds, kind, meta);
    if (status) bulkStatus(selectedIds, status, meta);
    if (progress !== '') bulkProgress(selectedIds, Number(progress), meta);
    if (owner.trim()) bulkOwner(selectedIds, owner.trim(), meta);
    if (cal === 'on') bulkCalendar(selectedIds, true, meta);
    if (cal === 'off') bulkCalendar(selectedIds, false, meta);
    const days = Number(shift);
    if (days !== 0) bulkShift(selectedIds, days, meta);
    close();
  };

  if (n < 2 && !open) return null;

  return (
    <>
      {!open && n >= 2 && (
        <button className="bulk-edit-fab" onClick={() => setOpen(true)} title="批量编辑选中项">
          批量编辑 <b>{n}</b> 项
        </button>
      )}

      {open && (
        <div className="modal-overlay" onClick={close}>
          <div className="modal bulk-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>批量编辑</h3>
              <button className="icon" onClick={close}>✕</button>
            </div>
            <div className="bulk-summary">已选中 <b>{n}</b> 项：{preview}</div>

            <div className="bulk-grid">
              <label>
                类型
                <select value={kind} onChange={(e) => setKind(e.target.value as '' | TaskKind)}>
                  <option value="">不修改</option>
                  <option value="plan">计划</option>
                  <option value="task">任务</option>
                </select>
              </label>

              <label>
                状态
                <select value={status} onChange={(e) => setStatus(e.target.value as '' | StatusKey)}>
                  <option value="">不修改</option>
                  {STATUS_OPTS.map((o) => (
                    <option key={o.v} value={o.v}>{o.label}</option>
                  ))}
                </select>
              </label>

              <label>
                进度
                <select value={progress} onChange={(e) => setProgress(e.target.value)}>
                  <option value="">不修改</option>
                  {PROGRESS_OPTS.map((p) => (
                    <option key={p} value={p}>{p}%</option>
                  ))}
                </select>
              </label>

              <label>
                负责人
                <input
                  type="text"
                  placeholder="留空=不修改"
                  value={owner}
                  onChange={(e) => setOwner(e.target.value)}
                />
              </label>

              <label>
                日历显隐
                <select value={cal} onChange={(e) => setCal(e.target.value as '' | 'on' | 'off')}>
                  <option value="">不修改</option>
                  <option value="on">加入日历</option>
                  <option value="off">移出日历</option>
                </select>
              </label>

              <label>
                整体平移（天）
                <input
                  type="number"
                  value={shift}
                  onChange={(e) => setShift(e.target.value)}
                  title="正数向后、负数向前；0=不平移"
                />
              </label>
            </div>

            <div className="bulk-actions">
              <button className="ghost" onClick={() => setSelection([])}>清空选择</button>
              <span style={{ flex: 1 }} />
              <button className="ghost" onClick={close}>取消</button>
              <button className="primary" onClick={apply}>应用修改</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
