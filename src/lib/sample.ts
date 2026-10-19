import { DEFAULT_SHOW_IN_CALENDAR, Task, TaskKind } from '../types';
import { addDays, today } from './date';

const d = (offset: number) => addDays(today(), offset);

/**
 * 精简示例：只保留演示联动所必需的结构（层级 + 一条依赖链 + 四种状态）。
 * 默认启动为空，用户点「载入示例」才写入。
 */
export function sampleTasks(): Task[] {
  const mk = (
    id: string,
    title: string,
    parentId: string | null,
    dependsOn: string[],
    startDate: string,
    dueDate: string,
    progress: number,
    kind: TaskKind = 'task',
  ): Task => ({
    id,
    title,
    parentId,
    dependsOn,
    startDate,
    dueDate,
    progress,
    status: 'todo',
    owner: '',
    note: '',
    statusLocked: false,
    kind,
    showInCalendar: DEFAULT_SHOW_IN_CALENDAR[kind],
  });

  return [
    mk('P', '课题总目标', null, [], d(-6), d(30), 0),
    mk('A', '文献调研', 'P', [], d(-6), d(2), 100),
    mk('B', '实验执行', 'P', ['A'], d(3), d(16), 40),
    mk('B1', '样品制备', 'B', [], d(3), d(9), 80),
    mk('B2', '数据采集', 'B', ['B1'], d(10), d(16), 0),
    mk('C', '数据分析', 'P', ['B'], d(17), d(24), 0),
    mk('D', '论文撰写', 'P', ['C'], d(25), d(30), 0),
    // 计划项：还没排进执行日程，默认不出现在日历里
    mk('E', '备选路线：低温合成', 'P', [], d(31), d(40), 0, 'plan'),
  ];
}

/** 空白起始：只给一个可改名的根课题，避免用户面对完全空屏 */
export function blankTasks(): Task[] {
  const s = today();
  return [
    {
      id: 'ROOT',
      title: '新课题',
      parentId: null,
      dependsOn: [],
      startDate: s,
      dueDate: addDays(s, 29),
      progress: 0,
      status: 'todo',
      owner: '',
      note: '',
      statusLocked: false,
      kind: 'task',
      showInCalendar: true,
    },
  ];
}
