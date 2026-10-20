import { useState } from 'react';
import { TaskKind } from '../types';
import { useTaskStore } from '../store/useTaskStore';

export default function SettingsModal({ onClose }: { onClose: () => void }) {
  const settings = useTaskStore((s) => s.settings);
  const setSettings = useTaskStore((s) => s.setSettings);
  const canvases = useTaskStore((s) => s.canvases);
  const currentCanvasId = useTaskStore((s) => s.currentCanvasId);
  const setCurrentCanvas = useTaskStore((s) => s.setCurrentCanvas);
  const addCanvas = useTaskStore((s) => s.addCanvas);
  const renameCanvas = useTaskStore((s) => s.renameCanvas);
  const removeCanvas = useTaskStore((s) => s.removeCanvas);
  const resetLayout = useTaskStore((s) => s.resetLayout);

  const [tab, setTab] = useState<'defaults' | 'canvases'>('defaults');
  const [newName, setNewName] = useState('');

  return (
    <div className="modal-mask" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>设置</h3>
          <button className="icon" onClick={onClose} title="关闭">
            ×
          </button>
        </div>

        <div className="modal-tabs">
          <button className={tab === 'defaults' ? 'active' : ''} onClick={() => setTab('defaults')}>
            默认参数
          </button>
          <button className={tab === 'canvases' ? 'active' : ''} onClick={() => setTab('canvases')}>
            画布管理
          </button>
        </div>

        <div className="modal-body">
          {tab === 'defaults' && (
            <>
              <label>新增子节点默认类型</label>
              <select
                value={settings.defaultKind}
                onChange={(e) => setSettings({ defaultKind: e.target.value as TaskKind })}
              >
                <option value="task">任务（已排期，默认进日历）</option>
                <option value="plan">计划（构思中，默认不进日历）</option>
              </select>

              <label className="chk">
                <input
                  type="checkbox"
                  checked={settings.defaultInCalendar}
                  onChange={(e) => setSettings({ defaultInCalendar: e.target.checked })}
                />
                新建「任务」默认显示在日历中
              </label>

              <label>新增任务默认工期（天）</label>
              <input
                type="number"
                min={1}
                max={365}
                value={settings.defaultDuration}
                onChange={(e) =>
                  setSettings({ defaultDuration: Math.max(1, Math.min(365, Number(e.target.value) || 1)) })
                }
              />

              <label className="chk">
                <input
                  type="checkbox"
                  checked={settings.timesExpanded}
                  onChange={(e) => setSettings({ timesExpanded: e.target.checked })}
                />
                详情面板的「具体时间」默认展开
              </label>

              <label className="chk">
                <input
                  type="checkbox"
                  checked={settings.clearSelOnOutsideClick}
                  onChange={(e) => setSettings({ clearSelOnOutsideClick: e.target.checked })}
                />
                框选后，点击空白处 / 其他节点 取消框选
              </label>

              <div className="modal-note">
                提示：一个任务是否出现在日历，始终以它本身的「类型 + 单独的日历开关」为准；上面的「默认进日历」只是新建时的初始值，之后仍可单独改。
              </div>
            </>
          )}

          {tab === 'canvases' && (
            <>
              <p className="modal-note">
                每个画布是一块独立的工作区（拥有自己的思维导图与三视图数据），互不干扰。删除画布会把其中的任务移入回收站，可还原。
              </p>
              <div className="canvas-list">
                {canvases.map((c) => (
                  <div key={c.id} className={`canvas-row${c.id === currentCanvasId ? ' current' : ''}`}>
                    <button className="canvas-pick" onClick={() => setCurrentCanvas(c.id)}>
                      {c.id === currentCanvasId ? '● ' : '○ '}
                      {c.name}
                    </button>
                    <input
                      className="canvas-rename"
                      value={c.name}
                      onChange={(e) => renameCanvas(c.id, e.target.value)}
                    />
                    <button
                      className="canvas-del danger"
                      disabled={canvases.length <= 1}
                      title={canvases.length <= 1 ? '至少保留一个画布' : '删除画布（数据入回收站）'}
                      onClick={() => {
                        if (confirm(`删除画布「${c.name}」？其中的任务会移入回收站。`)) removeCanvas(c.id);
                      }}
                    >
                      删除
                    </button>
                  </div>
                ))}
              </div>
              <div className="canvas-add">
                <input
                  value={newName}
                  placeholder="新画布名称"
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newName.trim()) {
                      addCanvas(newName);
                      setNewName('');
                    }
                  }}
                />
                <button
                  className="primary"
                  onClick={() => {
                    if (newName.trim()) {
                      addCanvas(newName);
                      setNewName('');
                    }
                  }}
                >
                  ＋ 新建画布
                </button>
              </div>
              <div style={{ marginTop: 12 }}>
                <button
                  onClick={() => {
                    if (
                      confirm('重置当前画布的节点布局？节点手动摆放的位置将被清除，重新自动排布（不影响任务数据）。')
                    )
                      resetLayout();
                  }}
                >
                  重置当前画布布局
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
