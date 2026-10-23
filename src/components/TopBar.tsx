import { useEffect, useRef, useState } from 'react';
import { ViewId } from '../types';
import { useTaskStore, useCanvasTasks } from '../store/useTaskStore';
import { initCloudSync, onCloudStatus, cloudSyncNow, CloudStatus } from '../lib/cloud-sync';
import { askDelete } from '../lib/confirmDelete';
import TrashDrawer from './TrashDrawer';
import SettingsModal from './SettingsModal';

const TABS: { id: ViewId; label: string }[] = [
  { id: 'all', label: '总览' },
  { id: 'hierarchy', label: '研究结构' },
  { id: 'mind', label: '思维导图' },
  { id: 'gantt', label: '甘特图' },
  { id: 'calendar', label: '日历' },
];

export default function TopBar() {
  const view = useTaskStore((s) => s.view);
  const setView = useTaskStore((s) => s.setView);
  const addChild = useTaskStore((s) => s.addChild);
  const resetSample = useTaskStore((s) => s.resetSample);
  const clearAll = useTaskStore((s) => s.clearAll);
  const importTasks = useTaskStore((s) => s.importTasks);
  const undo = useTaskStore((s) => s.undo);
  const redo = useTaskStore((s) => s.redo);
  const canUndo = useTaskStore((s) => s.past.length > 0);
  const canRedo = useTaskStore((s) => s.future.length > 0);
  const trashCount = useTaskStore((s) => s.trash.length);
  const canvases = useTaskStore((s) => s.canvases);
  const currentCanvasId = useTaskStore((s) => s.currentCanvasId);
  const setCurrentCanvas = useTaskStore((s) => s.setCurrentCanvas);
  const addCanvas = useTaskStore((s) => s.addCanvas);
  const tasks = useCanvasTasks();
  const fileRef = useRef<HTMLInputElement>(null);

  const [trashOpen, setTrashOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [syncState, setSyncState] = useState<CloudStatus>('idle');
  const [syncHint, setSyncHint] = useState('');

  useEffect(() => {
    const off = onCloudStatus(setSyncState);
    initCloudSync();
    return () => {
      off();
    };
  }, []);

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(tasks, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `research-flow-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const onImport = (f: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        const arr = Array.isArray(data) ? data : Array.isArray(data?.tasks) ? data.tasks : null;
        if (arr) importTasks(arr);
        else alert('文件格式不正确：应为任务数组或含 tasks 字段的对象');
      } catch {
        alert('解析失败：不是合法 JSON');
      }
    };
    reader.readAsText(f);
  };

  const doSync = async () => {
    setSyncHint('正在与云端同步…');
    await cloudSyncNow();
    setSyncHint('');
  };

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <span className="dot" />
          ResearchFlow <small>科研工作流 · 单数据源三视图联动</small>
        </div>

        <div className="tabs">
          {TABS.map((t) => (
            <button key={t.id} className={view === t.id ? 'active' : ''} onClick={() => setView(t.id)}>
              {t.label}
            </button>
          ))}
        </div>

        <div className="spacer" />

        <div className="canvas-switch" title="切换画布（多工作区）">
          <select value={currentCanvasId} onChange={(e) => setCurrentCanvas(e.target.value)}>
            {canvases.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button
            className="add"
            title="新建画布"
            onClick={() => {
              const name = prompt('新画布名称：', `画布 ${canvases.length + 1}`);
              if (name && name.trim()) addCanvas(name.trim());
            }}
          >
            ＋
          </button>
        </div>

        <div className="toolgroup">
          <button className="ghost" onClick={undo} disabled={!canUndo} title="撤销 (Ctrl/⌘+Z)">
            ↶ 撤销
          </button>
          <button className="ghost" onClick={redo} disabled={!canRedo} title="重做 (Ctrl/⌘+Shift+Z)">
            ↷ 重做
          </button>
          <button className="ghost" onClick={() => setTrashOpen(true)} title="回收站（软删除的任务可还原）">
            回收站{trashCount > 0 ? ` (${trashCount})` : ''}
          </button>
          <button className="primary" onClick={() => addChild(null, { source: 'panel', action: '新建顶层课题', detail: '新课题' })}>
            + 新建课题
          </button>
          <button onClick={exportJson}>导出 JSON</button>
          <button onClick={() => fileRef.current?.click()}>导入</button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onImport(f);
              e.target.value = '';
            }}
          />
          <button className="ghost" onClick={() => confirm('载入示例课题会覆盖当前画布数据，继续？') && resetSample()}>
            载入示例
          </button>
          <button className="ghost" onClick={() => askDelete('确认清空当前画布全部任务？（已删除的项会进入回收站）') && clearAll()}>
            清空
          </button>
          <button className="gear" onClick={() => setSettingsOpen(true)} title="默认参数 / 画布管理">
            ⚙ 设置
          </button>

          <div className="sync-box">
            <button
              className={`ghost ${syncState === 'synced' ? 'sync-on' : ''}`}
              onClick={doSync}
              title={syncState === 'syncing' ? '正在同步…' : syncState === 'error' ? '同步出错：后端 API 不可用，请确认已绑定 KV' : syncState === 'offline' ? '网络离线或后端未部署' : '点击立即同步'}
            >
              {syncState === 'syncing' ? '⟳ 云同步中' : syncState === 'error' ? '⚠ 同步失败' : syncState === 'offline' ? '🔌 离线' : syncState === 'idle' ? '☁ 待同步' : '☁ 已云同步'}
            </button>
          </div>
        </div>
      </header>
      {trashOpen && <TrashDrawer onClose={() => setTrashOpen(false)} />}
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
      {syncHint && (
        <div className="sync-hint">
          {syncHint}
          <button className="link" onClick={() => setSyncHint('')}>
            ×
          </button>
        </div>
      )}
    </>
  );
}
