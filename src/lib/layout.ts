import { Task } from '../types';

export const NODE_W = 218;
export const NODE_H = 88;
const GAP_X = 84;
const GAP_Y = 18;

/**
 * 横向整齐树布局：根在左，子向右；父节点 y 取首末子节点中心。
 * collapsed 中的节点不展开子节点。
 */
export function treeLayout(tasks: Task[], collapsed: Record<string, boolean>): Map<string, { x: number; y: number }> {
  const kids = new Map<string, Task[]>();
  for (const t of tasks) {
    const arr = kids.get(t.parentId ?? '') ?? [];
    arr.push(t);
    kids.set(t.parentId ?? '', arr);
  }
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const roots = tasks.filter((t) => !t.parentId || !byId.has(t.parentId));
  const pos = new Map<string, { x: number; y: number }>();
  let cursor = 0;

  const place = (id: string, depth: number): number => {
    const list = kids.get(id) ?? [];
    const x = depth * (NODE_W + GAP_X);
    if (!list.length || collapsed[id]) {
      const y = cursor * (NODE_H + GAP_Y);
      cursor += 1;
      pos.set(id, { x, y });
      return y;
    }
    const ys = list.map((c) => place(c.id, depth + 1));
    const y = (ys[0] + ys[ys.length - 1]) / 2;
    pos.set(id, { x, y });
    return y;
  };

  roots.forEach((r) => {
    place(r.id, 0);
    cursor += 0.5; // 根之间留一点空隙
  });
  return pos;
}
