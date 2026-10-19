import { Derived, Source } from '../types';
import { useTaskStore } from '../store/useTaskStore';

const SRC_LABEL: Record<Source, string> = {
  mind: '思维导图',
  gantt: '甘特图',
  calendar: '日历',
  hierarchy: '研究结构',
  panel: '详情面板',
  system: '系统',
};

export default function StatusBar({ derived }: { derived: Record<string, Derived> }) {
  const log = useTaskStore((s) => s.log);
  const tasks = useTaskStore((s) => s.tasks);
  const last = log[0];

  const critical = Object.values(derived).filter((d) => d.critical).length;
  const blocked = Object.values(derived).filter((d) => d.isBlocked).length;
  const delayed = Object.values(derived).filter((d) => d.isDelayed).length;

  return (
    <footer className="statusbar">
      <span>任务 {tasks.length}</span>
      <span>· 关键路径 {critical}</span>
      <span>· 阻塞 {blocked}</span>
      <span>· 逾期 {delayed}</span>
      {last ? (
        <>
          <span className="badge-src">{SRC_LABEL[last.source]}</span>
          <span>
            {last.action}
            {last.detail ? `：${last.detail}` : ''}
          </span>
          <span className="flash">
            → 已同步 {last.affected.length} 处{last.affected.length > 1 ? `（联动 ${last.affected.length - 1} 项）` : ''}
          </span>
        </>
      ) : (
        <span>在任一视图编辑，三视图即时同步（无需刷新）</span>
      )}
    </footer>
  );
}
