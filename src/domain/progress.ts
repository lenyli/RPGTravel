import type { RPGTrip, Quest } from '../protocol/schema';
import type { Issue } from '../protocol/validate';

export type QuestStatus = 'available' | 'active' | 'completed' | 'skipped';
export type QuestProgress = {
  status: QuestStatus;
  checkedObjectiveIds: string[];
  resolvedAt: string | null;
};
export type Progress = {
  progressVersion: 2;
  currentQuestId: string | null;
  quests: Record<string, QuestProgress>;
  updatedAt: string;
};
export type ProgressAction =
  | { type: 'select' | 'start' | 'complete' | 'skip'; questId: string }
  | { type: 'check'; questId: string; objectiveId: string; checked: boolean };

export class ProgressError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProgressError';
  }
}

const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
const states = new Set<QuestStatus>([
  'available',
  'active',
  'completed',
  'skipped',
]);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const hasExactKeys = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));

export function isIsoInstant(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(
      value,
    );
  if (!match) return false;
  const [, year, month, day, hour, minute, second, zone] = match;
  const calendar = new Date(`${year}-${month}-${day}T00:00:00.000Z`);
  if (
    !Number.isFinite(calendar.getTime()) ||
    calendar.toISOString().slice(0, 10) !== `${year}-${month}-${day}`
  )
    return false;
  if (Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59)
    return false;
  if (
    zone !== 'Z' &&
    (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4, 6)) > 59)
  )
    return false;
  return Number.isFinite(Date.parse(value));
}

export function sortedQuests(trip: RPGTrip): Quest[] {
  return [...trip.quests].sort((left, right) => left.order - right.order);
}

const resolved = (status: QuestStatus) =>
  status === 'completed' || status === 'skipped';

export function initialProgress(
  trip: RPGTrip,
  now = new Date().toISOString(),
): Progress {
  if (!isIsoInstant(now))
    throw new ProgressError('进度时间无效，请检查设备时间后重试。');
  const ordered = sortedQuests(trip);
  const quests: Record<string, QuestProgress> = Object.create(null);
  for (const quest of ordered) {
    if (forbidden.has(quest.id))
      throw new ProgressError('任务 ID 不安全，无法建立存档。');
    quests[quest.id] = {
      status: 'available',
      checkedObjectiveIds: [],
      resolvedAt: null,
    };
  }
  return {
    progressVersion: 2,
    currentQuestId: ordered[0]?.id ?? null,
    quests,
    updatedAt: now,
  };
}

export function validateProgress(
  trip: RPGTrip,
  input: unknown,
): { success: true; data: Progress } | { success: false; errors: Issue[] } {
  const errors: Issue[] = [];
  const issue = (code: string, path: string, message: string) =>
    errors.push({ code, path, message });
  if (
    !isRecord(input) ||
    !hasExactKeys(input, [
      'progressVersion',
      'currentQuestId',
      'quests',
      'updatedAt',
    ])
  ) {
    return {
      success: false,
      errors: [
        {
          code: 'INVALID_PROGRESS',
          path: '$.progress',
          message: '存档进度字段缺失或含有未知字段。',
        },
      ],
    };
  }
  if (input.progressVersion !== 2)
    issue(
      'UNSUPPORTED_PROGRESS_VERSION',
      '$.progress.progressVersion',
      '暂不支持这份进度的版本。',
    );
  if (!isIsoInstant(input.updatedAt))
    issue(
      'INVALID_PROGRESS_TIME',
      '$.progress.updatedAt',
      '进度更新时间不是有效的 ISO 时间。',
    );
  if (!isRecord(input.quests))
    return {
      success: false,
      errors: [
        ...errors,
        {
          code: 'INVALID_PROGRESS',
          path: '$.progress.quests',
          message: '任务进度必须是一份对象。',
        },
      ],
    };
  const ordered = sortedQuests(trip);
  const expectedIds = new Set(ordered.map((quest) => quest.id));
  for (const id of Object.keys(input.quests)) {
    if (!expectedIds.has(id) || forbidden.has(id))
      issue(
        'UNKNOWN_PROGRESS_QUEST',
        `$.progress.quests.${id}`,
        '进度引用了不存在或不安全的任务。',
      );
  }
  const safeQuests: Record<string, QuestProgress> = Object.create(null);
  for (const quest of ordered) {
    const path = `$.progress.quests.${quest.id}`;
    const state = Object.hasOwn(input.quests, quest.id)
      ? input.quests[quest.id]
      : undefined;
    if (
      !isRecord(state) ||
      !hasExactKeys(state, ['status', 'checkedObjectiveIds', 'resolvedAt'])
    ) {
      issue('INVALID_QUEST_PROGRESS', path, '任务进度字段缺失或含有未知字段。');
      continue;
    }
    if (
      typeof state.status !== 'string' ||
      !states.has(state.status as QuestStatus)
    ) {
      issue('INVALID_QUEST_STATUS', `${path}.status`, '任务状态无效。');
      continue;
    }
    const status = state.status as QuestStatus;
    if (
      !Array.isArray(state.checkedObjectiveIds) ||
      !state.checkedObjectiveIds.every((id) => typeof id === 'string')
    ) {
      issue(
        'INVALID_OBJECTIVE_PROGRESS',
        `${path}.checkedObjectiveIds`,
        '已勾选行动必须为 ID 列表。',
      );
      continue;
    }
    const checked = state.checkedObjectiveIds as string[];
    const objectiveIds = new Set(
      quest.objectives.map((objective) => objective.id),
    );
    if (
      new Set(checked).size !== checked.length ||
      checked.some((id) => !objectiveIds.has(id) || forbidden.has(id))
    ) {
      issue(
        'INVALID_OBJECTIVE_PROGRESS',
        `${path}.checkedObjectiveIds`,
        '进度中的行动有重复、未知或不属于该任务的 ID。',
      );
    }
    if (
      status === 'completed' &&
      (checked.length !== objectiveIds.size ||
        !quest.objectives.every(({ id }) => checked.includes(id)))
    ) {
      issue(
        'INCOMPLETE_COMPLETED_QUEST',
        path,
        '已完成的任务必须勾选全部行动。',
      );
    }
    if (status === 'available' && checked.length > 0)
      issue(
        'INVALID_OBJECTIVE_PROGRESS',
        path,
        '尚未开始的任务不能已经勾选行动。',
      );
    if (resolved(status)) {
      if (!isIsoInstant(state.resolvedAt)) {
        issue(
          'INVALID_PROGRESS_TIME',
          `${path}.resolvedAt`,
          '已解决任务缺少有效的完成或跳过时间。',
        );
      } else {
        const time = Date.parse(state.resolvedAt);
        if (isIsoInstant(input.updatedAt) && time > Date.parse(input.updatedAt))
          issue(
            'INVALID_PROGRESS_TIME',
            `${path}.resolvedAt`,
            '解决时间不能晚于进度更新时间。',
          );
      }
    } else {
      if (state.resolvedAt !== null)
        issue(
          'INVALID_PROGRESS_TIME',
          `${path}.resolvedAt`,
          '未解决的任务不能有完成或跳过时间。',
        );
    }
    safeQuests[quest.id] = {
      status,
      checkedObjectiveIds: [...checked],
      resolvedAt:
        typeof state.resolvedAt === 'string' ? state.resolvedAt : null,
    };
  }
  const unresolvedIds = ordered
    .filter(
      (quest) => safeQuests[quest.id] && !resolved(safeQuests[quest.id].status),
    )
    .map((quest) => quest.id);
  if (
    unresolvedIds.length === 0
      ? input.currentQuestId !== null
      : typeof input.currentQuestId !== 'string' ||
        !unresolvedIds.includes(input.currentQuestId)
  )
    issue(
      'CURRENT_QUEST_MISMATCH',
      '$.progress.currentQuestId',
      '当前任务须是一个尚未解决的地点；全部解决后应为空。',
    );
  if (errors.length) return { success: false, errors };
  return {
    success: true,
    data: {
      progressVersion: 2,
      currentQuestId: input.currentQuestId as string | null,
      quests: safeQuests,
      updatedAt: input.updatedAt as string,
    },
  };
}

export function transitionProgress(
  trip: RPGTrip,
  progress: Progress,
  action: ProgressAction,
  now = new Date().toISOString(),
): Progress {
  const valid = validateProgress(trip, progress);
  if (!valid.success) throw new ProgressError(valid.errors[0].message);
  if (!isIsoInstant(now))
    throw new ProgressError('设备时间无效，无法记录本次操作。');
  const next = valid.data;
  if (action.type !== 'select' && next.currentQuestId !== action.questId)
    throw new ProgressError(
      '只能操作当前任务；这项操作可能已在另一个页面完成，请重新打开存档。',
    );
  const quest = trip.quests.find(({ id }) => id === action.questId);
  if (!quest) throw new ProgressError('当前任务不存在。');
  const state = next.quests[action.questId];
  if (action.type === 'select') {
    if (resolved(state.status))
      throw new ProgressError(
        '该地点任务已经解决，可在日志中回看；选择其他未解决地点继续。',
      );
    next.currentQuestId = action.questId;
  } else if (action.type === 'start') {
    if (state.status !== 'available')
      throw new ProgressError('该任务已经开始，不能重复开始。');
    state.status = 'active';
  } else if (action.type === 'check') {
    if (state.status !== 'active')
      throw new ProgressError('请先点击“我已到达，开始调查”。');
    if (!quest.objectives.some(({ id }) => id === action.objectiveId))
      throw new ProgressError('这项行动不属于当前任务。');
    const checked = new Set(state.checkedObjectiveIds);
    if (action.checked) checked.add(action.objectiveId);
    else checked.delete(action.objectiveId);
    state.checkedObjectiveIds = quest.objectives
      .filter(({ id }) => checked.has(id))
      .map(({ id }) => id);
  } else if (action.type === 'complete' || action.type === 'skip') {
    if (
      action.type === 'complete' &&
      (state.status !== 'active' ||
        !quest.objectives.every(({ id }) =>
          state.checkedObjectiveIds.includes(id),
        ))
    )
      throw new ProgressError('开始调查并勾选全部行动后，才能完成本节。');
    if (state.status !== 'available' && state.status !== 'active')
      throw new ProgressError('本节已经解决，不能重复提交。');
    state.status = action.type === 'complete' ? 'completed' : 'skipped';
    state.resolvedAt = new Date(
      Math.max(Date.parse(now), Date.parse(progress.updatedAt)),
    ).toISOString();
    next.currentQuestId =
      sortedQuests(trip).find(
        (candidate) => !resolved(next.quests[candidate.id].status),
      )?.id ?? null;
  } else {
    throw new ProgressError('不支持这项进度操作。');
  }
  // Changing a device clock must not invalidate already saved activity.
  next.updatedAt = new Date(
    Math.max(Date.parse(now), Date.parse(progress.updatedAt)),
  ).toISOString();
  return next;
}

export function resolvedQuests(trip: RPGTrip, progress: Progress): Quest[] {
  return trip.quests
    .filter((quest) => resolved(progress.quests[quest.id].status))
    .sort(
      (left, right) =>
        Date.parse(progress.quests[left.id].resolvedAt!) -
          Date.parse(progress.quests[right.id].resolvedAt!) ||
        left.order - right.order,
    );
}

export function unlockedClues(trip: RPGTrip, progress: Progress) {
  return resolvedQuests(trip, progress).flatMap((quest) =>
    quest.rewardClueIds.map((id) => ({
      clue: trip.clues.find((clue) => clue.id === id)!,
      questId: quest.id,
      via:
        progress.quests[quest.id].status === 'skipped'
          ? ('fallback' as const)
          : ('completion' as const),
    })),
  );
}

export function progressSummary(trip: RPGTrip, progress: Progress) {
  const values = Object.values(progress.quests);
  const completed = values.filter(
    (state) => state.status === 'completed',
  ).length;
  const skipped = values.filter((state) => state.status === 'skipped').length;
  return {
    completed,
    skipped,
    resolved: completed + skipped,
    total: trip.quests.length,
    isFinished: completed + skipped === trip.quests.length,
  };
}
