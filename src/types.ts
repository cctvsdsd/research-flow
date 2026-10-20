export type Status = 'todo' | 'doing' | 'done' | 'delayed' | 'blocked';

export type ViewId = 'all' | 'hierarchy' | 'mind' | 'gantt' | 'calendar';

/** 编辑来源，用于联动日志 */
export type Source = 'mind' | 'gantt' | 'calendar' | 'hierarchy' | 'panel' | 'system';

/** 计划 = 还没进排期的构思（默认不进日历）；任务 = 已排期的执行项（默认进日历） */
export type TaskKind = 'plan' | 'task';

export interface Task {
  id: string;
  title: string;
  parentId: string | null;
  dependsOn: string[];
  /** YYYY-MM-DD */
  startDate: string;
  dueDate: string;
  /** 起止具体时间 HH:MM，可选；为空字符串表示不设置（默认项） */
  startTime?: string;
  endTime?: string;
  progress: number; // 0-100
  status: Status; // 存储值；实际展示以派生状态为准（除非 statusLocked）
  owner: string;
  note: string;
  /** 手动锁定状态后，不再由引擎自动推导 */
  statusLocked: boolean;
  /** 计划 / 任务。默认按 kind 决定日历是否显示，但用户可随时单独改 showInCalendar */
  kind: TaskKind;
  /** 是否在日历中显示 —— 与完成状态无关，纯用户控制 */
  showInCalendar: boolean;
  /** 所属画布 id（多画布隔离用） */
  canvasId: string;
}

/** 回收站条目：整棵子树连同结构信息一起暂存，保证能原样还原 */
export interface TrashItem {
  id: string;
  /** 删除时间戳 */
  ts: number;
  /** 展示用的删除时间 */
  time: string;
  /** 触发删除的动作描述 */
  reason: string;
  /** 被删除的任务（含级联子任务） */
  tasks: Task[];
  /** 直接被删除的顶层节点 id（区分"直接删的"与"被级联带走的"） */
  rootIds: string[];
  /** 每个任务的父 id，还原时按此接回原位 */
  parentLinks: Record<string, string | null>;
  /** 留存任务中对被删任务的依赖引用，还原时补回 */
  externalDeps: { ownerId: string; depId: string }[];
}

/** 调度引擎派生出的只读信息 */
export interface Derived {
  status: Status;
  isDone: boolean;
  isDelayed: boolean;
  isBlocked: boolean;
  blockedBy: string[];
  /** 依赖约束下的最早可开始日 */
  earliestStart: string;
  /** 总浮动天数 */
  slack: number;
  critical: boolean;
  duration: number;
  depth: number;
  hasChildren: boolean;
  /** 含子孙的任务数 */
  subtreeSize: number;
}

export interface LogEntry {
  id: string;
  ts: number;
  time: string;
  source: Source;
  action: string;
  detail: string;
  /** 本次操作实际波及的任务（联动证据） */
  affected: string[];
}

export const STATUS_LABEL: Record<Status, string> = {
  todo: '未开始',
  doing: '进行中',
  done: '已完成',
  delayed: '延期',
  blocked: '阻塞',
};

export const STATUS_COLOR: Record<Status, string> = {
  todo: '#64748b',
  doing: '#3b82f6',
  done: '#22c55e',
  delayed: '#ef4444',
  blocked: '#94a3b8',
};

export const KIND_LABEL: Record<TaskKind, string> = {
  plan: '计划',
  task: '任务',
};

/** 新建时按类型给出的日历默认值：计划默认不进日历，任务默认进 */
export const DEFAULT_SHOW_IN_CALENDAR: Record<TaskKind, boolean> = {
  plan: false,
  task: true,
};

/** 画布：一块独立思维导图 + 配套的三视图数据，互不干扰 */
export interface Canvas {
  id: string;
  name: string;
}

/** 全局默认参数，可在设置面板调整 */
export interface Settings {
  /** 新增子节点时默认类型 */
  defaultKind: TaskKind;
  /** 新增子任务默认是否进日历（计划类型即便勾选也按 kind 默认不进） */
  defaultInCalendar: boolean;
  /** 默认工期（天） */
  defaultDuration: number;
  /** 详情面板里"起止时间"是否默认展开 */
  timesExpanded: boolean;
  /** 框选后，点击非选中目标（空白/其他节点）是否取消框选 */
  clearSelOnOutsideClick: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  defaultKind: 'task',
  defaultInCalendar: true,
  defaultDuration: 5,
  timesExpanded: false,
  clearSelOnOutsideClick: true,
};

export const DEFAULT_CANVAS_ID = 'default';
