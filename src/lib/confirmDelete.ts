import { useTaskStore } from '../store/useTaskStore';

/**
 * 删除确认：当设置 confirmDelete=false 时直接放行，否则弹出浏览器确认框。
 * 用于所有「删除任务节点」的入口，统一受设置控制。
 */
export function askDelete(msg: string): boolean {
  if (!useTaskStore.getState().settings.confirmDelete) return true;
  return confirm(msg);
}
