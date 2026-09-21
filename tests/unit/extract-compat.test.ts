import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/valid-trip.json';
import {
  extractReply,
  MAX_ENVELOPE_BYTES,
  MAX_REPLY_BYTES,
} from '../../src/protocol/extract';
import { parseImport } from '../../src/storage/backup';

const json = JSON.stringify(fixture);
const wrapped = (content = json) => `<RPG_TRIP_V1>\n${content}\n</RPG_TRIP_V1>`;
const fenced = (content = json) => `\x60\x60\x60json\n${content}\n\x60\x60\x60`;

describe('complete AI reply extraction compatibility', () => {
  it.each([
    [
      'plain JSON with surrounding prose',
      `已修复，请导入以下内容：\n${json}\n完成。`,
    ],
    ['code fence inside protocol markers', wrapped(fenced())],
    ['protocol markers inside a code fence', fenced(wrapped())],
    [
      'explanatory markers before the actual package',
      `请复制 <RPG_TRIP_V1> 与 </RPG_TRIP_V1> 之间的完整故事。\n${wrapped()}`,
    ],
    ['repeated identical marked packages', `${wrapped()}\n${wrapped()}`],
    ['repeated identical code fences', `${fenced()}\n${fenced()}`],
    ['marked package repeated without wrappers', `${wrapped()}\n${json}`],
    [
      'duplicates with different formatting and object key order',
      `${json}\n${JSON.stringify(Object.fromEntries(Object.entries(fixture).reverse()), null, 2)}`,
    ],
  ])(
    'imports %s without sending the unchanged story back to AI',
    (_name, raw) => {
      const extracted = extractReply(raw);
      expect(extracted.success).toBe(true);
      if (extracted.success) expect(extracted.value).toEqual(fixture);
      expect(parseImport(raw).success).toBe(true);
    },
  );

  it('does not interpret marker or code-fence text inside story strings', () => {
    const story = structuredClone(fixture);
    story.quests[0].story.scene =
      '纸上写着 <RPG_TRIP_V1>、</RPG_TRIP_V1> 与 <RPG_TRIP_V2>；还有 ```json 和 {"线索":"云"}。';
    const raw = wrapped(JSON.stringify(story));
    const extracted = extractReply(raw);
    expect(extracted.success).toBe(true);
    if (extracted.success) expect(extracted.value).toEqual(story);
    expect(parseImport(raw).success).toBe(true);
  });

  it('uses the actual story when explanations contain unrelated JSON examples', () => {
    const raw = `格式示例：{"example":"value"}\n[说明]\n${wrapped()}\n另一个示例：{"field":1}`;
    const extracted = extractReply(raw);
    expect(extracted.success).toBe(true);
    if (extracted.success) {
      expect(extracted.value).toEqual(fixture);
      expect(extracted.warnings.join(' ')).toContain('JSON 示例');
    }
    expect(parseImport(raw).success).toBe(true);
  });

  it('deduplicates complete backup envelopes without changing saved progress', () => {
    const backup = {
      format: 'RPG_TRIP_SAVE',
      saveVersion: 1,
      adventureData: fixture,
      progress: null,
      exportedAt: '2026-09-20T00:00:00Z',
    };
    const raw = JSON.stringify(backup);
    const extracted = extractReply(`${raw}\n${fenced(raw)}`);
    expect(extracted.success).toBe(true);
    if (extracted.success) expect(extracted.value).toEqual(backup);
    expect(parseImport(`${raw}\n${fenced(raw)}`).success).toBe(true);
  });

  it('reports that duplicate content was ignored while keeping the original reply unchanged', () => {
    const raw = `${wrapped()}\n${wrapped()}`;
    const before = raw;
    const extracted = extractReply(raw);
    expect(raw).toBe(before);
    expect(extracted.success).toBe(true);
    if (extracted.success)
      expect(extracted.warnings.join(' ')).toContain('重复');
  });

  it.each([
    ['bare JSON', (content: string) => content],
    ['marked packages', wrapped],
    ['code fences', fenced],
  ])(
    'never chooses silently between different stories in %s',
    (_name, wrap) => {
      const second = structuredClone(fixture);
      second.adventure.title = '另一个故事';
      const extracted = extractReply(
        `${wrap(json)}\n${wrap(JSON.stringify(second))}`,
      );
      expect(extracted.success).toBe(false);
      if (!extracted.success) {
        expect(extracted.errors[0].code).toBe('MULTIPLE_PACKAGES');
        expect(extracted.candidates).toEqual([fixture, second]);
      }
    },
  );

  it('offers only distinct stories when a reply mixes repetitions with another story', () => {
    const second = structuredClone(fixture);
    second.adventure.title = '另一个故事';
    const extracted = extractReply(
      `${json}\n${wrapped()}\n${JSON.stringify(second)}`,
    );
    expect(extracted.success).toBe(false);
    if (!extracted.success)
      expect(extracted.candidates).toEqual([fixture, second]);
  });

  it('does not expose an over-limit story list for candidate selection', () => {
    const second = structuredClone(fixture);
    second.adventure.title = '另一个故事';
    const extracted = extractReply(
      `${' '.repeat(MAX_REPLY_BYTES)}${json}\n${JSON.stringify(second)}`,
    );
    expect(extracted.success).toBe(false);
    if (!extracted.success) {
      expect(extracted.errors[0].code).toBe('REPLY_TOO_LARGE');
      expect(extracted.candidates).toBeUndefined();
    }
  });

  it('allows backup choices up to the envelope limit but rejects oversized envelopes', () => {
    const first = {
      format: 'RPG_TRIP_SAVE',
      adventureData: fixture,
      exportedAt: '2026-09-20',
    };
    const second = { ...first, exportedAt: '2026-09-21' };
    const extracted = extractReply(
      `${' '.repeat(MAX_REPLY_BYTES)}${JSON.stringify(first)}\n${JSON.stringify(second)}`,
    );
    expect(extracted.success).toBe(false);
    if (!extracted.success) {
      expect(extracted.errors[0].code).toBe('MULTIPLE_PACKAGES');
      expect(extracted.candidates).toEqual([first, second]);
    }
    const oversized = extractReply(
      `${' '.repeat(MAX_ENVELOPE_BYTES)}${JSON.stringify(first)}\n${JSON.stringify(second)}`,
    );
    expect(oversized.success).toBe(false);
    if (!oversized.success) {
      expect(oversized.errors[0].code).toBe('INPUT_TOO_LARGE');
      expect(oversized.candidates).toBeUndefined();
    }
  });

  it.each([
    ['truncated story', json.slice(0, -30)],
    [
      'complete story followed by a truncated story',
      `${json}\n${json.slice(0, -30)}`,
    ],
    [
      'malformed story followed by a complete story',
      `{ "schemaVersion": }\n${json}`,
    ],
    [
      'illegal quotation marks in a second story',
      `${json}\n{“adventure”:“另一个故事”}`,
    ],
  ])('does not discard or reconstruct %s', (_name, raw) => {
    const result = extractReply(raw);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errors[0].code).toBe('INVALID_JSON');
  });

  it('does not unwrap an array of stories as a single story', () => {
    const result = extractReply(`故事如下：\n[${json}]\n完毕。`);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errors[0].code).toBe('INVALID_ROOT');
  });

  it('does not discard a second story just because it is wrapped in an array', () => {
    const result = extractReply(`${json}\n[${json}]`);
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.errors[0].code).toBe('MULTIPLE_PACKAGES');
  });

  it('does not choose between unrelated objects when no story is identifiable', () => {
    const result = extractReply('{"first":"story"}\n{"second":"story"}');
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.errors[0].code).toBe('MULTIPLE_PACKAGES');
  });
});
