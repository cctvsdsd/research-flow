import { Derived, ViewId } from '../types';
import { useTaskStore } from '../store/useTaskStore';
import HierarchyView from './HierarchyView';
import GanttView from './GanttView';
import CalendarView from './CalendarView';

function Cell({
  title,
  view,
  children,
}: {
  title: string;
  view: ViewId;
  children: React.ReactNode;
}) {
  const setView = useTaskStore((s) => s.setView);
  return (
    <div className="ov-cell">
      <div className="ov-cell-head">
        <span className="ov-cell-title">{title}</span>
        <button className="ov-cell-zoom" onClick={() => setView(view)} title="放大为单视图">
          ⤢ 放大
        </button>
      </div>
      <div className="ov-cell-body">{children}</div>
    </div>
  );
}

export default function OverviewView({ derived }: { derived: Record<string, Derived> }) {
  return (
    <div className="overview-grid">
      <div className="ov-left">
        <Cell title="研究结构" view="hierarchy">
          <HierarchyView derived={derived} compact />
        </Cell>
      </div>
      <div className="ov-right">
        <Cell title="甘特图" view="gantt">
          <GanttView derived={derived} compact />
        </Cell>
        <Cell title="日历" view="calendar">
          <CalendarView derived={derived} compact />
        </Cell>
      </div>
    </div>
  );
}
