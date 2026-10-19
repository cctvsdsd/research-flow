import { useTaskStore } from '../store/useTaskStore';

export default function TrashDrawer({ onClose }: { onClose: () => void }) {
  const trash = useTaskStore((s) => s.trash);
  const restoreTrash = useTaskStore((s) => s.restoreTrash);
  const purgeTrash = useTaskStore((s) => s.purgeTrash);
  const emptyTrash = useTaskStore((s) => s.emptyTrash);

  return (
    <div className="drawer-mask" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <h3>回收站 <small>{trash.length} 项已删除</small></h3>
          <div style={{ display: 'flex', gap: 6 }}>
            {trash.length > 0 && (
              <button className="ghost" onClick={() => { if (confirm('清空回收站？这些任务将彻底删除，无法恢复。')) emptyTrash(); }}>
                清空回收站
              </button>
            )}
            <button className="ghost" onClick={onClose}>关闭</button>
          </div>
        </div>

        <div className="drawer-body">
          {trash.length === 0 ? (
            <div className="panel-empty">回收站是空的。<br />删除的任务（含整棵子树）会先到这里，可随时还原。</div>
          ) : (
            trash.map((item) => (
              <div className="trash-item" key={item.id}>
                <div className="trash-item-top">
                  <div className="trash-meta">
                    <b>{item.reason}</b>
                    <span className="trash-time">{item.time} · {item.tasks.length} 个任务</span>
                  </div>
                  <div className="trash-actions">
                    <button className="primary" onClick={() => restoreTrash(item.id)}>还原</button>
                    <button className="danger" onClick={() => { if (confirm('彻底删除这一项？无法恢复。')) purgeTrash(item.id); }}>彻底删除</button>
                  </div>
                </div>
                <div className="trash-tasks">
                  {item.tasks.map((t) => (
                    <span key={t.id} className="trash-chip" title={`${t.startDate} → ${t.dueDate}`}>
                      {t.title}
                      {item.rootIds.includes(t.id) ? ' · 顶层' : ''}
                    </span>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="drawer-foot">
          提示：还原会按原层级接回原位；若该任务曾被别的任务依赖，依赖关系也会一并补回。
        </div>
      </div>
    </div>
  );
}
