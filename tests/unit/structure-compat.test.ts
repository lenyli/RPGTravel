import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/valid-trip.json';
import { parseImport } from '../../src/storage/backup';
import { validateTrip } from '../../src/protocol/validate';

const fresh = () =>
  structuredClone(fixture) as unknown as Record<string, unknown> & {
    adventure?: Record<string, unknown>;
    chapters: Record<string, unknown>[];
    quests: Record<string, unknown>[];
  };
const importData = (value: unknown) => parseImport(JSON.stringify(value));

describe('lossless AI field compatibility', () => {
  it('imports a flattened complete adventure and chapter subtitle without rewriting content', () => {
    const input = fresh();
    Object.assign(input, input.adventure);
    delete input.adventure;
    input.chapters[0].subtitle = '副标题里的调查背景必须保留。';
    delete input.chapters[0].area;
    delete input.chapters[0].intro;
    const before = structuredClone(input);

    const result = importData(input);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.adventure).toEqual(fixture.adventure);
    expect(result.data.chapters[0].area).toBe(fixture.chapters[0].title);
    expect(result.data.chapters[0].intro).toBe(input.chapters[0].subtitle);
    expect(result.data.quests).toEqual(fixture.quests);
    expect(result.data.clues).toEqual(fixture.clues);
    expect(result.rawReply).toBe(JSON.stringify(before));
    expect(
      result.warnings.some((warning) => warning.includes('收拢至 adventure')),
    ).toBe(true);
    expect(
      result.warnings.some((warning) =>
        warning.includes('subtitle 已并入 intro'),
      ),
    ).toBe(true);
    expect(validateTrip(input).success).toBe(true);
    expect(input).toEqual(before);
  });

  it.each(['meta', 'trip', 'metadata'])(
    'imports a complete unique %s adventure object',
    (key) => {
      const input = fresh();
      input[key] = input.adventure;
      delete input.adventure;
      const result = importData(input);
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data).toEqual(fixture);
      expect(result.warnings).toContain(
        `完整的 ${key} 冒险概要已改用 adventure 字段，内容未改写。`,
      );
    },
  );

  it('keeps both the intro and a distinct subtitle', () => {
    const input = fresh();
    input.chapters[0].subtitle = '原有简介之外的副标题。';
    const result = importData(input);
    expect(result.success).toBe(true);
    if (result.success)
      expect(result.data.chapters[0].intro).toBe(
        `${fixture.chapters[0].intro}\n\n原有简介之外的副标题。`,
      );
  });

  it('does not duplicate identical intro and subtitle text', () => {
    const input = fresh();
    input.chapters[0].subtitle = input.chapters[0].intro;
    const result = importData(input);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(fixture);
  });

  it('leaves a missing optional chapter intro empty while preserving all task stories', () => {
    const input = fresh();
    delete input.chapters[0].intro;
    const result = importData(input);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.chapters[0].intro).toBe('');
    expect(result.data.quests).toEqual(fixture.quests);
    expect(result.warnings).toContain(
      '第 1 个章节未给出 intro，已留空，不补写剧情。',
    );
  });

  it('does not guess between multiple complete adventure candidates', () => {
    const input = fresh();
    input.meta = input.adventure;
    input.trip = structuredClone(input.adventure);
    (input.trip as Record<string, unknown>).title = '另一份概要';
    delete input.adventure;
    const result = importData(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.errors.find((error) => error.path === '$.adventure')?.message,
      ).toContain('缺少冒险概要对象');
      expect(
        result.errors.some((error) => error.code === 'UNKNOWN_FIELD'),
      ).toBe(true);
    }
  });

  it('does not create a missing ending for an incomplete flattened adventure', () => {
    const input = fresh();
    Object.assign(input, input.adventure);
    delete input.adventure;
    delete input.endingText;
    const result = importData(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.errors.find((error) => error.path === '$.adventure')?.message,
      ).toContain('缺少的剧情需由 AI 补齐');
      expect(
        result.errors.some((error) => error.path.startsWith('$.adventure.')),
      ).toBe(false);
    }
  });

  it('still rejects a genuinely missing task story and identifies the missing field', () => {
    const input = fresh();
    delete input.quests[0].story;
    const result = importData(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.errors.find((error) => error.path === '$.quests[0].story')
          ?.message,
      ).toContain('缺少必填字段 story');
      expect(
        result.errors.some((error) =>
          error.path.startsWith('$.quests[0].story.'),
        ),
      ).toBe(false);
    }
  });

  it.each(['root', 'chapter', 'adventure alias'])(
    'does not discard unknown fields from the %s',
    (location) => {
      const input = fresh();
      if (location === 'root') input.unrecognizedStory = '不可静默丢弃的正文';
      else if (location === 'chapter') {
        input.chapters[0].subtitle = '合法兼容副标题';
        input.chapters[0].unrecognizedStory = '不可静默丢弃的正文';
      } else {
        input.meta = {
          ...input.adventure,
          unrecognizedStory: '不可静默丢弃的正文',
        };
        delete input.adventure;
      }
      const result = importData(input);
      expect(result.success).toBe(false);
      if (!result.success)
        expect(
          result.errors.some((error) => error.code === 'UNKNOWN_FIELD'),
        ).toBe(true);
    },
  );

  it('reports the actual type mismatch without discarding an unmergeable subtitle', () => {
    const input = fresh();
    input.chapters[0].intro = 42;
    input.chapters[0].subtitle = '不能丢弃的副标题';
    const result = importData(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.errors.find((error) => error.path === '$.chapters[0].intro')
          ?.message,
      ).toBe(
        '字段类型错误：需要文字，实际为数字；请保留原内容并调整为 Schema 要求的类型。',
      );
      expect(
        result.errors.some(
          (error) =>
            error.code === 'UNKNOWN_FIELD' &&
            error.message.includes('subtitle'),
        ),
      ).toBe(true);
    }
  });

  it('distinguishes invalid date text from a missing or mistyped date', () => {
    const input = fresh();
    input.adventure!.startDate = '明天';
    const result = importData(input);
    expect(result.success).toBe(false);
    if (!result.success)
      expect(
        result.errors.find((error) => error.path === '$.adventure.startDate')
          ?.message,
      ).toContain('字段格式不符合协议');
  });

  it('identifies a missing literal field as missing rather than a bad value', () => {
    const input = fresh();
    delete input.schemaVersion;
    const result = importData(input);
    expect(result.success).toBe(false);
    if (!result.success)
      expect(
        result.errors.find((error) => error.path === '$.schemaVersion')
          ?.message,
      ).toContain('缺少必填字段 schemaVersion');
  });
});
