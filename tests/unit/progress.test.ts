import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/valid-trip.json';
import type { RPGTrip } from '../../src/protocol/schema';
import {
  initialProgress,
  isIsoInstant,
  progressSummary,
  resolvedQuests,
  transitionProgress,
  unlockedClues,
  validateProgress,
} from '../../src/domain/progress';

const trip = fixture as RPGTrip;
const time = '2026-09-23T02:00:00.000Z';
const start = () => initialProgress(trip, time);

describe('自由地点进度', () => {
  it('日志与线索按真实 3 → 1 → 2 解决时间排列，同一时间再按显示序号排列', () => {
    let progress = start();
    for (const [index, questId] of [
      'quest_03',
      'quest_01',
      'quest_02',
    ].entries()) {
      const now = `2026-09-23T0${index + 3}:00:00.000Z`;
      progress = transitionProgress(
        trip,
        progress,
        { type: 'select', questId },
        now,
      );
      progress = transitionProgress(
        trip,
        progress,
        { type: 'skip', questId },
        now,
      );
    }
    expect(resolvedQuests(trip, progress).map(({ id }) => id)).toEqual([
      'quest_03',
      'quest_01',
      'quest_02',
    ]);
    expect(unlockedClues(trip, progress).map(({ clue }) => clue.id)).toEqual([
      'clue_03',
      'clue_01',
      'clue_02',
    ]);
    for (const state of Object.values(progress.quests))
      state.resolvedAt = progress.updatedAt;
    expect(resolvedQuests(trip, progress).map(({ id }) => id)).toEqual([
      'quest_01',
      'quest_02',
      'quest_03',
    ]);
  });

  it('初始化全部地点可选，首项仅为默认选择，原故事不被游玩修改，状态 map 无原型', () => {
    const snapshot = JSON.stringify(trip);
    const progress = start();
    expect(progress.currentQuestId).toBe('quest_01');
    expect(Object.values(progress.quests).map((quest) => quest.status)).toEqual(
      ['available', 'available', 'available'],
    );
    expect(progress.progressVersion).toBe(2);
    expect(Object.getPrototypeOf(progress.quests)).toBeNull();
    transitionProgress(
      trip,
      progress,
      { type: 'start', questId: 'quest_01' },
      time,
    );
    expect(progress.quests.quest_01.status).toBe('available');
    expect(JSON.stringify(trip)).toBe(snapshot);
  });

  it('先开始、可取消勾选、全勾后主动完成，且重复提交不能重复完成', () => {
    let progress = start();
    expect(() =>
      transitionProgress(
        trip,
        progress,
        {
          type: 'check',
          questId: 'quest_01',
          objectiveId: 'objective_01',
          checked: true,
        },
        time,
      ),
    ).toThrow('先点击');
    expect(() =>
      transitionProgress(
        trip,
        progress,
        { type: 'start', questId: 'quest_02' },
        time,
      ),
    ).toThrow('只能操作');
    progress = transitionProgress(
      trip,
      progress,
      { type: 'start', questId: 'quest_01' },
      time,
    );
    expect(() =>
      transitionProgress(
        trip,
        progress,
        { type: 'complete', questId: 'quest_01' },
        time,
      ),
    ).toThrow('全部行动');
    for (const objective of trip.quests[0].objectives)
      progress = transitionProgress(
        trip,
        progress,
        {
          type: 'check',
          questId: 'quest_01',
          objectiveId: objective.id,
          checked: true,
        },
        time,
      );
    expect(progress.currentQuestId).toBe('quest_01');
    progress = transitionProgress(
      trip,
      progress,
      {
        type: 'check',
        questId: 'quest_01',
        objectiveId: 'objective_01',
        checked: false,
      },
      time,
    );
    expect(progress.quests.quest_01.checkedObjectiveIds).not.toContain(
      'objective_01',
    );
    progress = transitionProgress(
      trip,
      progress,
      {
        type: 'check',
        questId: 'quest_01',
        objectiveId: 'objective_01',
        checked: true,
      },
      time,
    );
    progress = transitionProgress(
      trip,
      progress,
      { type: 'complete', questId: 'quest_01' },
      time,
    );
    expect(progress.currentQuestId).toBe('quest_02');
    expect(progress.quests.quest_03.status).toBe('available');
    expect(unlockedClues(trip, progress).map((entry) => entry.clue.id)).toEqual(
      ['clue_01'],
    );
    expect(unlockedClues(trip, progress)[0].via).toBe('completion');
    expect(() =>
      transitionProgress(
        trip,
        progress,
        { type: 'complete', questId: 'quest_01' },
        time,
      ),
    ).toThrow('只能操作');
  });

  it('跳过保留部分行动，以补叙解锁线索，全部跳过仍能收束但不虚报完成', () => {
    let progress = transitionProgress(
      trip,
      start(),
      { type: 'start', questId: 'quest_01' },
      time,
    );
    progress = transitionProgress(
      trip,
      progress,
      {
        type: 'check',
        questId: 'quest_01',
        objectiveId: 'objective_01',
        checked: true,
      },
      time,
    );
    for (const quest of trip.quests)
      progress = transitionProgress(
        trip,
        progress,
        { type: 'skip', questId: quest.id },
        time,
      );
    expect(progress.quests.quest_01.checkedObjectiveIds).toEqual([
      'objective_01',
    ]);
    expect(progress.quests.quest_02.checkedObjectiveIds).toEqual([]);
    expect(progress.currentQuestId).toBeNull();
    expect(progressSummary(trip, progress)).toEqual({
      completed: 0,
      skipped: 3,
      resolved: 3,
      total: 3,
      isFinished: true,
    });
    expect(
      unlockedClues(trip, progress).every((entry) => entry.via === 'fallback'),
    ).toBe(true);
    expect(validateProgress(trip, progress).success).toBe(true);
  });

  it('每项真实完成后结局计数正确；设备时钟回拨不会阻止任务', () => {
    let progress = start();
    for (const quest of trip.quests) {
      progress = transitionProgress(
        trip,
        progress,
        { type: 'start', questId: quest.id },
        '2020-01-01T00:00:00Z',
      );
      for (const objective of quest.objectives)
        progress = transitionProgress(
          trip,
          progress,
          {
            type: 'check',
            questId: quest.id,
            objectiveId: objective.id,
            checked: true,
          },
          time,
        );
      progress = transitionProgress(
        trip,
        progress,
        { type: 'complete', questId: quest.id },
        time,
      );
    }
    expect(progressSummary(trip, progress).completed).toBe(3);
    expect(progressSummary(trip, progress).isFinished).toBe(true);
    expect(
      validateProgress(trip, JSON.parse(JSON.stringify(progress))).success,
    ).toBe(true);
  });

  it('按地点 3 → 1 → 2 完成，不依赖显示序号或访问日期', () => {
    let progress = start();
    for (const [index, questId] of [
      'quest_03',
      'quest_01',
      'quest_02',
    ].entries()) {
      const now = `2026-10-0${index + 1}T12:00:00.000Z`;
      progress = transitionProgress(
        trip,
        progress,
        { type: 'select', questId },
        now,
      );
      progress = transitionProgress(
        trip,
        progress,
        { type: 'start', questId },
        now,
      );
      const quest = trip.quests.find((item) => item.id === questId)!;
      for (const objective of quest.objectives)
        progress = transitionProgress(
          trip,
          progress,
          { type: 'check', questId, objectiveId: objective.id, checked: true },
          now,
        );
      progress = transitionProgress(
        trip,
        progress,
        { type: 'complete', questId },
        now,
      );
      expect(validateProgress(trip, progress).success).toBe(true);
    }
    expect(progress.currentQuestId).toBeNull();
    expect(progress.quests.quest_03.resolvedAt).toBe(
      '2026-10-01T12:00:00.000Z',
    );
    expect(progress.quests.quest_01.resolvedAt).toBe(
      '2026-10-02T12:00:00.000Z',
    );
    expect(progress.quests.quest_02.resolvedAt).toBe(
      '2026-10-03T12:00:00.000Z',
    );
    expect(progressSummary(trip, progress)).toMatchObject({
      completed: 3,
      isFinished: true,
    });
  });

  it('地点 1 部分行动后切到 3，再回到 1，保留多个地点的调查与勾选', () => {
    let progress = transitionProgress(
      trip,
      start(),
      { type: 'start', questId: 'quest_01' },
      time,
    );
    progress = transitionProgress(
      trip,
      progress,
      {
        type: 'check',
        questId: 'quest_01',
        objectiveId: 'objective_01',
        checked: true,
      },
      time,
    );
    progress = transitionProgress(
      trip,
      progress,
      { type: 'select', questId: 'quest_03' },
      time,
    );
    progress = transitionProgress(
      trip,
      progress,
      { type: 'start', questId: 'quest_03' },
      time,
    );
    progress = transitionProgress(
      trip,
      progress,
      {
        type: 'check',
        questId: 'quest_03',
        objectiveId: 'objective_07',
        checked: true,
      },
      time,
    );
    expect(progress.quests.quest_01.status).toBe('active');
    expect(progress.quests.quest_03.status).toBe('active');
    expect(validateProgress(trip, progress).success).toBe(true);
    progress = transitionProgress(
      trip,
      progress,
      { type: 'select', questId: 'quest_01' },
      time,
    );
    expect(progress.quests.quest_01.checkedObjectiveIds).toEqual([
      'objective_01',
    ]);
    expect(progress.quests.quest_03.checkedObjectiveIds).toEqual([
      'objective_07',
    ]);
    expect(progress.currentQuestId).toBe('quest_01');
  });

  it('可以单独跳过第三个地点而不解决前两项，补叙只揭露该地点线索', () => {
    let progress = transitionProgress(
      trip,
      start(),
      { type: 'select', questId: 'quest_03' },
      time,
    );
    progress = transitionProgress(
      trip,
      progress,
      { type: 'skip', questId: 'quest_03' },
      time,
    );
    expect(progress.currentQuestId).toBe('quest_01');
    expect(progress.quests.quest_01.status).toBe('available');
    expect(progress.quests.quest_02.status).toBe('available');
    expect(progress.quests.quest_03.checkedObjectiveIds).toEqual([]);
    expect(
      unlockedClues(trip, progress).map(({ clue, via }) => [clue.id, via]),
    ).toEqual([['clue_03', 'fallback']]);
    expect(validateProgress(trip, progress).success).toBe(true);
    expect(() =>
      transitionProgress(
        trip,
        progress,
        { type: 'select', questId: 'quest_03' },
        time,
      ),
    ).toThrow('已经解决');
  });
});

describe('不可信备份进度', () => {
  it.each([
    [
      '未知任务',
      (progress: ReturnType<typeof start>) => {
        progress.quests.extra = {
          status: 'available',
          checkedObjectiveIds: [],
          resolvedAt: null,
        };
      },
    ],
    [
      '漏任务',
      (progress: ReturnType<typeof start>) => {
        delete progress.quests.quest_03;
      },
    ],
    [
      '旧进度版本',
      (progress: ReturnType<typeof start>) => {
        Object.assign(progress, { progressVersion: 1 });
      },
    ],
    [
      '不支持锁定状态',
      (progress: ReturnType<typeof start>) => {
        Object.assign(progress.quests.quest_02, { status: 'locked' });
      },
    ],
    [
      '当前 ID 错误',
      (progress: ReturnType<typeof start>) => {
        progress.currentQuestId = 'quest_missing';
      },
    ],
    [
      '行动重复',
      (progress: ReturnType<typeof start>) => {
        progress.quests.quest_01.status = 'active';
        progress.quests.quest_01.checkedObjectiveIds = [
          'objective_01',
          'objective_01',
        ];
      },
    ],
    [
      '他任务行动',
      (progress: ReturnType<typeof start>) => {
        progress.quests.quest_01.status = 'active';
        progress.quests.quest_01.checkedObjectiveIds = ['objective_04'];
      },
    ],
    [
      '未开始已勾选',
      (progress: ReturnType<typeof start>) => {
        progress.quests.quest_01.checkedObjectiveIds = ['objective_01'];
      },
    ],
    [
      '未解决有时间',
      (progress: ReturnType<typeof start>) => {
        progress.quests.quest_01.resolvedAt = time;
      },
    ],
    [
      '完成没勾全',
      (progress: ReturnType<typeof start>) => {
        progress.quests.quest_01.status = 'completed';
        progress.quests.quest_01.resolvedAt = time;
        progress.quests.quest_02.status = 'available';
        progress.currentQuestId = 'quest_02';
      },
    ],
    [
      '日期不存在',
      (progress: ReturnType<typeof start>) => {
        progress.updatedAt = '2026-02-30T12:00:00.000Z';
      },
    ],
  ])('拒绝%s', (_description, mutate) => {
    const progress = start();
    mutate(progress);
    expect(validateProgress(trip, progress).success).toBe(false);
  });

  it('拒绝未知字段、原型键和将来时序错误', () => {
    const progress = start();
    expect(
      validateProgress(trip, { ...progress, surprise: true }).success,
    ).toBe(false);
    const unsafe = JSON.parse(JSON.stringify(progress));
    unsafe.quests = JSON.parse(
      `{"__proto__":{},${JSON.stringify(progress.quests).slice(1)}`,
    );
    expect(validateProgress(trip, unsafe).success).toBe(false);
    const skipped = transitionProgress(
      trip,
      progress,
      { type: 'skip', questId: 'quest_01' },
      time,
    );
    skipped.quests.quest_01.resolvedAt = '2026-09-24T00:00:00Z';
    expect(validateProgress(trip, skipped).success).toBe(false);
  });

  it.each([
    '2026-02-30T12:00:00Z',
    'yesterday',
    '2026-09-23',
    '2026-09-23T25:00:00Z',
    '2026-09-23T12:61:00Z',
    '2026-09-23T12:00:00+25:00',
  ])('拒绝无效时间 %s', (value) => expect(isIsoInstant(value)).toBe(false));
});
