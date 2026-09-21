import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import fixture from '../fixtures/valid-trip.json';
import type { RPGTrip } from '../../src/protocol/schema';
import {
  MAX_ENVELOPE_BYTES,
  MAX_REPLY_BYTES,
} from '../../src/protocol/extract';
import { initialProgress, transitionProgress } from '../../src/domain/progress';
import { MAX_PHOTO_BYTES, type PhotoAttachment } from '../../src/domain/photos';
import {
  createSave,
  parseImport,
  saveFilename,
} from '../../src/storage/backup';

const trip = fixture as RPGTrip;
const jpeg = readFileSync(
  new URL('../fixtures/photo-valid.jpg', import.meta.url),
);
const photo: PhotoAttachment = {
  id: 'photo_01',
  questId: 'quest_01',
  createdAt: '2026-09-20T00:00:00Z',
  caption: '山间石阶',
  width: 2,
  height: 2,
  dataUrl: `data:image/jpeg;base64,${jpeg.toString('base64')}`,
};

// Valid JPEG APP2 segments let the boundary test fill the encoded photo budget
// without relying on an invalid base64 string or a mock photo validator.
function jpegAtLimit() {
  const segments: Buffer[] = [jpeg.subarray(0, 2)];
  let remaining = MAX_PHOTO_BYTES - jpeg.length;
  while (remaining > 0) {
    const chunk = Math.min(60_000, remaining);
    const segment = Buffer.alloc(chunk);
    segment[0] = 0xff;
    segment[1] = 0xe2;
    segment.writeUInt16BE(chunk - 2, 2);
    segments.push(segment);
    remaining -= chunk;
  }
  segments.push(jpeg.subarray(2));
  return `data:image/jpeg;base64,${Buffer.concat(segments).toString('base64')}`;
}

describe('故事与进度备份', () => {
  it('旧 v1 存档继续可导入，照片缺省为空；附照片完整备份采用严格 v2 并往返恢复', () => {
    const progress = initialProgress(trip);
    const legacy = createSave(trip, progress);
    expect(legacy.saveVersion).toBe(1);
    const old = parseImport(JSON.stringify(legacy));
    expect(old.success && old.photos).toEqual([]);
    const save = createSave(trip, progress, undefined, [photo]);
    expect(save.saveVersion).toBe(2);
    expect(Object.keys(save)).toEqual([
      'format',
      'saveVersion',
      'exportedAt',
      'adventureData',
      'progress',
      'photos',
    ]);
    const restored = parseImport(JSON.stringify(save, null, 2));
    expect(restored.success).toBe(true);
    if (restored.success) {
      expect(restored.progress).toEqual(progress);
      expect(restored.photos).toEqual([photo]);
      expect(restored.rawReply).not.toContain(photo.dataUrl);
      expect(restored.rawReply).not.toContain('RPG_TRIP_SAVE');
    }
  });

  it('仅故事分享即使收到照片数组也完全排除照片和私人照片说明', () => {
    const save = createSave(trip, null, undefined, [photo]);
    const raw = JSON.stringify(save);
    expect(save.saveVersion).toBe(1);
    expect(raw).not.toContain('"photos"');
    expect(raw).not.toContain(photo.caption);
    expect(raw).not.toContain(photo.dataUrl);
    const restored = parseImport(raw);
    expect(restored.success && restored.photos).toEqual([]);
    expect(restored.success && restored.progress).toBeNull();
  });

  it.each([
    { ...photo, questId: 'quest_missing' },
    { ...photo, dataUrl: 'https://example.com/private.jpg' },
    { ...photo, dataUrl: 'data:image/svg+xml;base64,PHN2Zy8+' },
    { ...photo, width: 100 },
    { ...photo, extra: 'not a known attachment field' },
  ])(
    '损坏照片明确失败，storyOnly必须丢弃进度和全部照片供用户明确选择',
    (invalid) => {
      const save = {
        ...createSave(trip, initialProgress(trip), undefined, [photo]),
        photos: [invalid],
      };
      const result = parseImport(JSON.stringify(save));
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(
          result.errors.some((error) => error.path.startsWith('$.photos')),
        ).toBe(true);
        expect(result.storyOnly?.data).toEqual(trip);
        expect(result.storyOnly?.progress).toBeNull();
        expect(result.storyOnly?.photos).toEqual([]);
        expect(result.storyOnly?.rawReply).not.toContain('data:image');
        expect(result.storyOnly?.warnings.join('')).toContain('明确确认');
      }
    },
  );

  it('照片导出前拒绝重复ID、错误关联和超出单任务数量的附件', () => {
    const progress = initialProgress(trip);
    expect(() => createSave(trip, progress, undefined, [photo, photo])).toThrow(
      '照片未通过',
    );
    expect(() =>
      createSave(trip, progress, undefined, [{ ...photo, questId: 'missing' }]),
    ).toThrow('照片未通过');
    const seven = Array.from({ length: 7 }, (_, index) => ({
      ...photo,
      id: `photo_${index}`,
    }));
    expect(() => createSave(trip, progress, undefined, seven)).toThrow(
      '照片未通过',
    );
  });

  it('v2不可在无进度故事中夹带照片，也不接受缺失或额外的顶层字段', () => {
    const save = createSave(trip, initialProgress(trip), undefined, [photo]);
    const missing = { ...save } as Record<string, unknown>;
    delete missing.photos;
    for (const input of [
      missing,
      { ...save, unknown: true },
      { ...save, saveVersion: 1 },
    ]) {
      const result = parseImport(JSON.stringify(input));
      expect(result.success).toBe(false);
      if (!result.success)
        expect(result.errors[0].code).toBe('INVALID_SAVE_FIELDS');
    }
    const noProgress = parseImport(JSON.stringify({ ...save, progress: null }));
    expect(noProgress.success).toBe(false);
    if (!noProgress.success) {
      expect(noProgress.errors[0].code).toBe('PHOTOS_WITHOUT_PROGRESS');
      expect(noProgress.storyOnly?.photos).toEqual([]);
    }
  });

  it('12 MiB JPEG照片预算可完整导入，超出总预算拒绝导出和导入而不静默删照片', () => {
    const dataUrl = jpegAtLimit();
    const photos = Array.from({ length: 12 }, (_, index) => ({
      ...photo,
      id: `photo_${index}`,
      questId: `quest_0${Math.floor(index / 6) + 1}`,
      dataUrl,
    }));
    const save = createSave(trip, initialProgress(trip), undefined, photos);
    const encoded = JSON.stringify(save, null, 2);
    expect(new TextEncoder().encode(encoded).length).toBeGreaterThan(
      4 * 1024 * 1024,
    );
    expect(new TextEncoder().encode(encoded).length).toBeLessThan(
      MAX_ENVELOPE_BYTES,
    );
    const result = parseImport(encoded);
    expect(result.success).toBe(true);
    expect(result.success && result.photos).toEqual(photos);
    const overflow = [
      ...photos,
      { ...photo, id: 'photo_overflow', questId: 'quest_03' },
    ];
    expect(() =>
      createSave(trip, initialProgress(trip), undefined, overflow),
    ).toThrow('12 MiB');
    const tooLarge = parseImport(JSON.stringify({ ...save, photos: overflow }));
    expect(tooLarge.success).toBe(false);
    if (!tooLarge.success) {
      expect(tooLarge.errors[0].code).toBe('PHOTOS_TOO_LARGE');
      expect(tooLarge.storyOnly?.photos).toEqual([]);
    }
  });
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
    { saveVersion: 3 },
    { exportedAt: '2026-02-30T00:00:00Z' },
    { extra: 'never accepted' },
    { adventureData: { ...trip, schemaVersion: '9.0' } },
  ])('未知版本、无效时间、未知字段及坏故事均不绕过协议', (change) => {
    expect(
      parseImport(JSON.stringify({ ...createSave(trip, null), ...change }))
        .success,
    ).toBe(false);
  });

  it('备份按 UTF-8 20 MiB 限额，并拒绝危险对象键', () => {
    const oversized = parseImport(
      '中'.repeat(Math.ceil(MAX_ENVELOPE_BYTES / 3)),
    );
    expect(oversized.success).toBe(false);
    if (!oversized.success)
      expect(oversized.errors[0].code).toBe('INPUT_TOO_LARGE');
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
