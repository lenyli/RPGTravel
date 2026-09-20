import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/valid-trip.json';
import type { RPGTrip } from '../../src/protocol/schema';
import {
  MAX_ENVELOPE_BYTES,
  MAX_REPLY_BYTES,
} from '../../src/protocol/extract';
import { initialProgress, transitionProgress } from '../../src/domain/progress';
import {
  createSave,
  parseImport,
  saveFilename,
} from '../../src/storage/backup';

const trip = fixture as RPGTrip;

describe('故事与进度备份', () => {
  it('原始回复在导入后保留，生成 envelope 只包含五个指定字段', () => {
    const raw = `说明\n<RPG_TRIP_V1>\n${JSON.stringify(trip)}\n</RPG_TRIP_V1>\n结束`;
    const parsed = parseImport(raw);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.rawReply).toBe(raw);
    expect(Object.keys(createSave(parsed.data, null))).toEqual([
      'format',
      'saveVersion',
      'exportedAt',
      'adventureData',
      'progress',
    ]);
    expect(JSON.stringify(createSave(parsed.data, null))).not.toContain(
      'rawReply',
    );
  });

  it('完整存档往返保持当前任务、勾选与跳过；分享故事从零开始', () => {
    let progress = initialProgress(trip);
    progress = transitionProgress(trip, progress, {
      type: 'skip',
      questId: 'quest_01',
    });
    progress = transitionProgress(trip, progress, {
      type: 'start',
      questId: 'quest_02',
    });
    progress = transitionProgress(trip, progress, {
      type: 'check',
      questId: 'quest_02',
      objectiveId: 'objective_04',
      checked: true,
    });
    const restored = parseImport(JSON.stringify(createSave(trip, progress)));
    expect(restored.success && restored.progress).toEqual(progress);
    const story = parseImport(JSON.stringify(createSave(trip, null)));
    expect(story.success && story.progress).toBeNull();
  });

  it('损坏进度明确失败并仅提供经确认使用的 storyOnly', () => {
    const save = createSave(trip, initialProgress(trip));
    save.progress!.currentQuestId = 'quest_missing';
    const result = parseImport(JSON.stringify(save));
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.errors[0].code).toBe('CURRENT_QUEST_MISMATCH');
    expect(result.storyOnly?.data).toEqual(trip);
    expect(result.storyOnly?.progress).toBeNull();
    expect(result.storyOnly?.warnings.join('')).toContain('明确确认');
  });

  it('自由地点进度导出版本为 2，非顺序完成恢复后仍可切换；不猜测旧进度迁移', () => {
    let progress = initialProgress(trip);
    progress = transitionProgress(trip, progress, {
      type: 'select',
      questId: 'quest_03',
    });
    progress = transitionProgress(trip, progress, {
      type: 'skip',
      questId: 'quest_03',
    });
    progress = transitionProgress(trip, progress, {
      type: 'start',
      questId: 'quest_01',
    });
    progress = transitionProgress(trip, progress, {
      type: 'check',
      questId: 'quest_01',
      objectiveId: 'objective_01',
      checked: true,
    });
    const save = createSave(trip, progress);
    expect(save.saveVersion).toBe(1);
    expect(save.progress?.progressVersion).toBe(2);
    const restored = parseImport(JSON.stringify(save));
    expect(restored.success && restored.progress).toEqual(progress);
    if (restored.success && restored.progress) {
      const selected = transitionProgress(restored.data, restored.progress, {
        type: 'select',
        questId: 'quest_02',
      });
      expect(selected.currentQuestId).toBe('quest_02');
      expect(selected.quests.quest_01.checkedObjectiveIds).toEqual([
        'objective_01',
      ]);
    }
    Object.assign(save.progress!, { progressVersion: 1 });
    const old = parseImport(JSON.stringify(save));
    expect(old.success).toBe(false);
    if (!old.success) {
      expect(old.errors[0].code).toBe('UNSUPPORTED_PROGRESS_VERSION');
      expect(old.storyOnly?.progress).toBeNull();
    }
  });

  it.each([
    { saveVersion: 2 },
    { exportedAt: '2026-02-30T00:00:00Z' },
    { extra: 'never accepted' },
    { adventureData: { ...trip, schemaVersion: '9.0' } },
  ])('未知版本、无效时间、未知字段及坏故事均不绕过协议', (change) => {
    expect(
      parseImport(JSON.stringify({ ...createSave(trip, null), ...change }))
        .success,
    ).toBe(false);
  });

  it('备份按 UTF-8 4 MiB 限额，并拒绝危险对象键', () => {
    expect(
      parseImport('中'.repeat(Math.ceil((4 * 1024 * 1024) / 3))).success,
    ).toBe(false);
    const raw = JSON.stringify(createSave(trip, initialProgress(trip))).replace(
      '"progressVersion":2',
      '"progressVersion":2,"__proto__":{}',
    );
    const result = parseImport(raw);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errors[0].code).toBe('UNSAFE_KEY');
  });

  it('拒绝导出无效进度；标题不能变成文件路径', () => {
    const progress = initialProgress(trip);
    progress.currentQuestId = null;
    expect(() => createSave(trip, progress)).toThrow('进度未通过');
    expect(
      saveFilename(
        { ...trip, adventure: { ...trip.adventure, title: '../危险/名称:*' } },
        '2026-09-23T00:00:00Z',
      ),
    ).toBe('.._危险_名称___存档_2026-09-23.rpgtrip.json');
  });

  it('接近 2 MiB 的合法故事可通过更大的备份 envelope 完整往返', () => {
    const large = structuredClone(trip);
    large.adventure.practicalNotes = Array.from({ length: 100 }, () =>
      'a'.repeat(19_000),
    );
    const size = (value: unknown) =>
      new TextEncoder().encode(JSON.stringify(value)).length;
    while (size(large) < MAX_REPLY_BYTES - 50) {
      const remaining = MAX_REPLY_BYTES - 50 - size(large);
      if (remaining <= 3) break;
      large.adventure.verificationNotes.push(
        '中'.repeat(Math.min(6_666, Math.floor((remaining - 3) / 3))),
      );
      if (remaining < 6) break;
    }
    expect(size(large)).toBeGreaterThan(MAX_REPLY_BYTES - 60);
    const envelope = createSave(large, initialProgress(large));
    const pretty = JSON.stringify(envelope, null, 2);
    expect(new TextEncoder().encode(pretty).length).toBeGreaterThan(
      MAX_REPLY_BYTES,
    );
    expect(new TextEncoder().encode(pretty).length).toBeLessThan(
      MAX_ENVELOPE_BYTES,
    );
    const restored = parseImport(pretty);
    expect(restored.success).toBe(true);
    if (restored.success) expect(restored.data).toEqual(large);

    large.adventure.verificationNotes.push('多'.repeat(100));
    const tooLarge = parseImport(
      JSON.stringify({ ...envelope, adventureData: large }),
    );
    expect(tooLarge.success).toBe(false);
    expect(() => createSave(large, null)).toThrow('故事数据未通过');
  });
});
