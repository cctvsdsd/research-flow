import { useEffect, useMemo } from 'react';
import { useTaskStore, useCanvasTasks } from './store/useTaskStore';
import { computeDerived } from './lib/schedule';
import TopBar from './components/TopBar';
import MindMapView from './components/MindMapView';
import GanttView from './components/GanttView';
import CalendarView from './components/CalendarView';
import HierarchyView from './components/HierarchyView';
import OverviewView from './components/OverviewView';
import TaskPanel from './components/TaskPanel';
import StatusBar from './components/StatusBar';
import BulkEditModal from './components/BulkEditModal';

export default function App() {
  const tasks = useCanvasTasks();
  const view = useTaskStore((s) => s.view);
  const selectedIds = useTaskStore((s) => s.selectedIds);
  const selectedId = useTaskStore((s) => s.selectedId);
  const panelOpen = useTaskStore((s) => s.panelOpen);
  const setPanelOpen = useTaskStore((s) => s.setPanelOpen);
  const derived = useMemo(() => computeDerived(tasks), [tasks]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) {
        // 输入框内只放行撤销/重做，文本原生历史交给浏览器
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') return;
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) useTaskStore.getState().redo();
        else useTaskStore.getState().undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        useTaskStore.getState().redo();
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        const t = useTaskStore.getState().tasks.find((x) => x.id === selectedId);
        if (!t) return;
        e.preventDefault();
        if (selectedIds.length > 1) {
          if (confirm(`删除选中的 ${selectedIds.length} 个任务？三视图将同步移除。`)) {
            useTaskStore.getState().bulkRemove(selectedIds, { source: 'system', action: '键盘批量删除', detail: `${selectedIds.length} 项` });
          }
        } else if (confirm(`删除「${t.title}」？三个视图将同步移除。`)) {
          useTaskStore.getState().removeTask(selectedId, { source: 'system', action: '键盘删除', detail: t.title });
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId, selectedIds]);

  return (
    <div className="app">
      <TopBar />
      <div className="body">
        <div className="view-wrap">
          {view === 'all' && <OverviewView derived={derived} />}
          {view === 'hierarchy' && <HierarchyView derived={derived} />}
          {view === 'mind' && <MindMapView derived={derived} />}
          {view === 'gantt' && <GanttView derived={derived} />}
          {view === 'calendar' && <CalendarView derived={derived} />}
        </div>
        {view === 'all' ? (
          <button
            className={`panel-fab${panelOpen ? ' open' : ''}`}
            onClick={() => setPanelOpen(!panelOpen)}
            title={panelOpen ? '收起编辑面板' : '打开编辑面板'}
          >
            {panelOpen ? '›' : '‹ 编辑'}
          </button>
        ) : null}
        {view !== 'all' || panelOpen ? <TaskPanel derived={derived} /> : null}
      </div>
      <StatusBar derived={derived} />
      <BulkEditModal />
    </div>
  );
}
