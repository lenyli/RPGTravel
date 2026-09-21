import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import fixture from '../fixtures/valid-trip.json';
import coordinateFixture from '../fixtures/valid-synthetic-coordinates.json';
import invalidManifest from '../fixtures/invalid-manifest.json';
import {
  tripJsonSchema,
  tripSchema,
  type RPGTrip,
} from '../../src/protocol/schema';
import {
  extractReply,
  MAX_ENVELOPE_BYTES,
  MAX_REPLY_BYTES,
} from '../../src/protocol/extract';
import { isCalendarDate, validateTrip } from '../../src/protocol/validate';
import { createSave, parseImport } from '../../src/storage/backup';
import {
  createGenerationPrompt,
  createRepairPrompt,
  validateTripInput,
  type TripInput,
} from '../../src/protocol/prompt';

const fresh = (): RPGTrip => structuredClone(fixture) as RPGTrip;
const encoded = () => JSON.stringify(fixture);
const wrapped = () => `<RPG_TRIP_V1>\n${encoded()}\n</RPG_TRIP_V1>`;
const codes = (input: unknown) => {
  const result = validateTrip(input);
  return result.success ? [] : result.errors.map((error) => error.code);
};

describe('single-source schema and complete fixtures', () => {
  it('accepts the complete three-quest story without normalization', () => {
    const result = validateTrip(fixture);
    expect(result.success).toBe(true);
    if (result.success) expect(result.warnings).toEqual([]);
  });

  it.each(invalidManifest)(
    'rejects the complete $file fixture with $code',
    ({ file, code }) => {
      const content = readFileSync(
        fileURLToPath(new URL(`../fixtures/${file}`, import.meta.url)),
        'utf8',
      );
      expect(codes(JSON.parse(content))).toContain(code);
    },
  );

  it('exports a self-contained strict schema, with every field required', () => {
    const json = JSON.stringify(tripJsonSchema);
    expect(json).toContain('"additionalProperties":false');
    expect(json).toContain('"const":"1.1"');
    expect(json).toContain('"coordinateSourceId"');
    expect(json).not.toContain('"$ref"');
    expect(json).not.toMatch(/"initialStatus"|"unlockQuestIds"|"day"/);
    const withoutEnding = fresh() as unknown as {
      adventure: Record<string, unknown>;
    };
    delete withoutEnding.adventure.endingText;
    expect(tripSchema.safeParse(withoutEnding).success).toBe(false);
  });

  it('rejects the unpublished old protocol with an actionable repair hint', () => {
    const result = validateTrip({ ...fixture, schemaVersion: '1.0' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors[0].code).toBe('UNSUPPORTED_SCHEMA_VERSION');
      expect(result.errors[0].message).toContain('复制修复 Prompt');
      expect(result.errors[0].message).toContain('不自动迁移');
    }
    expect(codes({ ...fixture, schemaVersion: '2.0' })).toContain(
      'UNSUPPORTED_SCHEMA_VERSION',
    );
  });

  it('rejects removed dependency and scheduled-chapter fields instead of keeping hidden gates', () => {
    for (const field of ['initialStatus', 'unlockQuestIds']) {
      const trip = fresh();
      Object.assign(trip.quests[0], {
        [field]: field === 'initialStatus' ? 'locked' : ['quest_02'],
      });
      expect(codes(trip)).toContain('UNKNOWN_FIELD');
    }
    const trip = fresh();
    Object.assign(trip.chapters[0], { day: 1 });
    expect(codes(trip)).toContain('UNKNOWN_FIELD');
  });

  it('keeps every fixture place self-contained without a previous-clue objective', () => {
    expect(fixture.schemaVersion).toBe('1.1');
    for (const quest of fixture.quests) {
      expect(quest.visit.recommendedDate).toBeNull();
      expect(quest.visit.recommendedTime).toBeNull();
      expect(
        quest.objectives.map((objective) => objective.text).join('\n'),
      ).not.toMatch(/前两节|上一节|先完成|已解锁线索/);
    }
    expect(fixture.quests[2].objectives[1].text).toContain('本节已经完整展示');
  });
});

describe('reply extraction', () => {
  it.each([
    ['complete marker package', () => wrapped()],
    ['plain JSON', () => encoded()],
    [
      'one JSON code fence',
      () => `结果如下\n\x60\x60\x60json\n${encoded()}\n\x60\x60\x60\n请核对`,
    ],
    [
      'one unlabelled code fence',
      () => `\x60\x60\x60\n${encoded()}\n\x60\x60\x60`,
    ],
    [
      'outer explanations',
      () => `这是完整结果。\n${wrapped()}\n请核验出行信息。`,
    ],
    ['BOM and whitespace', () => `\uFEFF \n${wrapped()}\n`],
  ])('extracts %s', (_name, content) => {
    const result = extractReply((content as () => string)());
    expect(result.success).toBe(true);
    if (result.success) expect(result.value).toEqual(fixture);
  });

  it('preserves Chinese quotation marks, escaped newlines and literal HTML', () => {
    const trip = fresh();
    trip.quests[0].story.scene =
      '“你好”\n<script>alert("x")</script><img src="https://example.com/a" onerror="evil()">';
    const result = extractReply(JSON.stringify(trip));
    expect(result.success).toBe(true);
    if (result.success) expect(result.value).toEqual(trip);
    expect(validateTrip(trip).success).toBe(true);
  });

  it.each([
    ['missing ending marker', () => `<RPG_TRIP_V1>${encoded()}`],
    ['unknown outer marker', () => `<RPG_TRIP_V2>${encoded()}</RPG_TRIP_V2>`],
    ['reversed outer markers', () => `</RPG_TRIP_V1>${encoded()}<RPG_TRIP_V1>`],
    ['closing marker alone', () => `${encoded()}</RPG_TRIP_V1>`],
    ['unclosed code fence', () => `\x60\x60\x60json\n${encoded()}`],
  ])('accepts complete JSON despite %s', (_name, content) => {
    const result = extractReply((content as () => string)());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value).toEqual(fixture);
      expect(result.warnings.length).toBeGreaterThan(0);
    }
  });

  it.each([
    ['truncated JSON', () => encoded().slice(0, -30), 'INVALID_JSON'],
    ['illegal punctuation', () => '{“schemaVersion”: "1.1"}', 'INVALID_JSON'],
    ['array root', () => '[]', 'INVALID_ROOT'],
    ['empty reply', () => ' \n ', 'EMPTY_REPLY'],
  ])('rejects %s without reconstructing content', (_name, content, code) => {
    const result = extractReply((content as () => string)());
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errors[0].code).toBe(code);
  });

  it('applies UTF-8 limits to the raw input, including wrappers', () => {
    const result = extractReply(
      `${'中'.repeat(Math.ceil(MAX_REPLY_BYTES / 3))}${wrapped()}`,
    );
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errors[0].code).toBe('REPLY_TOO_LARGE');
    const absolute = extractReply(' '.repeat(MAX_ENVELOPE_BYTES + 1));
    expect(absolute.success).toBe(false);
    if (!absolute.success)
      expect(absolute.errors[0].code).toBe('INPUT_TOO_LARGE');
  });

  it('allows a backup envelope under 20 MiB for the separate full backup validator', () => {
    const envelope = {
      format: 'RPG_TRIP_SAVE',
      saveVersion: 1,
      adventureData: fixture,
      progress: null,
      exportedAt: '2026-09-20T00:00:00Z',
    };
    const result = extractReply(
      ' '.repeat(MAX_REPLY_BYTES) + JSON.stringify(envelope),
    );
    expect(result.success).toBe(true);
    if (result.success) expect(result.value).toEqual(envelope);
  });

  it.each(['__proto__', 'constructor', 'prototype'])(
    'rejects forbidden key %s at any depth',
    (key) => {
      const result = extractReply(`{"safe":[{"${key}":{"polluted":true}}]}`);
      expect(result.success).toBe(false);
      if (!result.success) expect(result.errors[0].code).toBe('UNSAFE_KEY');
      expect(Object.hasOwn({}, 'polluted')).toBe(false);
    },
  );

  it('does not mutate the original raw text after any failure', () => {
    const raw = '<RPG_TRIP_V1>{“broken”: true}';
    const before = raw;
    extractReply(raw);
    expect(raw).toBe(before);
  });
});

describe('business validation', () => {
  it.each([
    [
      'duplicate global ID',
      (trip: RPGTrip) => {
        trip.npcs[0].id = trip.quests[0].id;
      },
      'DUPLICATE_ID',
    ],
    [
      'reserved ID',
      (trip: RPGTrip) => {
        trip.adventure.id = 'constructor';
      },
      'RESERVED_ID',
    ],
    [
      'missing NPC',
      (trip: RPGTrip) => {
        trip.quests[0].npcIds = ['missing_npc'];
      },
      'UNKNOWN_NPC',
    ],
    [
      'missing source',
      (trip: RPGTrip) => {
        trip.quests[0].sourceIds = ['missing_source'];
      },
      'UNKNOWN_SOURCE',
    ],
    [
      'missing chapter',
      (trip: RPGTrip) => {
        trip.quests[0].chapterId = 'missing_chapter';
      },
      'UNKNOWN_CHAPTER',
    ],
    [
      'omitted chapter task',
      (trip: RPGTrip) => {
        trip.chapters[0].questIds.pop();
      },
      'QUEST_CHAPTER_MEMBERSHIP',
    ],
    [
      'wrong chapter ordering',
      (trip: RPGTrip) => {
        trip.chapters[0].questIds.reverse();
      },
      'CHAPTER_QUEST_ORDER_MISMATCH',
    ],
    [
      'duplicate chapter order',
      (trip: RPGTrip) => {
        trip.chapters[1].order = 1;
      },
      'INVALID_CHAPTER_ORDER',
    ],
    [
      'duplicate quest order',
      (trip: RPGTrip) => {
        trip.quests[1].order = 1;
      },
      'INVALID_QUEST_ORDER',
    ],
    [
      'ending before start',
      (trip: RPGTrip) => {
        trip.adventure.endDate = '2026-09-22';
      },
      'INVALID_DATE_RANGE',
    ],
    [
      'task outside trip',
      (trip: RPGTrip) => {
        trip.quests[0].visit.recommendedDate = '2026-09-22';
      },
      'QUEST_DATE_OUTSIDE_TRIP',
    ],
    [
      'orphan clue',
      (trip: RPGTrip) => {
        trip.clues.push({ ...trip.clues[0], id: 'orphan' });
      },
      'CLUE_REWARD_COUNT',
    ],
    [
      'clue source mismatch',
      (trip: RPGTrip) => {
        trip.clues[0].sourceQuestId = trip.quests[1].id;
      },
      'CLUE_SOURCE_MISMATCH',
    ],
    [
      'duplicate reward',
      (trip: RPGTrip) => {
        trip.quests[0].rewardClueIds.push(trip.clues[0].id);
      },
      'CLUE_REWARD_COUNT',
    ],
    [
      'duplicate NPC reference',
      (trip: RPGTrip) => {
        trip.quests[0].npcIds.push(trip.npcs[0].id);
      },
      'DUPLICATE_REFERENCE',
    ],
    [
      'unknown time zone',
      (trip: RPGTrip) => {
        trip.adventure.timeZone = 'Not/A_TimeZone';
      },
      'INVALID_TIME_ZONE',
    ],
  ])('rejects %s', (_name, mutate, code) => {
    const trip = fresh();
    (mutate as (trip: RPGTrip) => void)(trip);
    expect(codes(trip)).toContain(code);
  });

  it('does not depend on input array order when order fields are valid', () => {
    const trip = fresh();
    trip.quests.reverse();
    trip.chapters.reverse();
    expect(validateTrip(trip).success).toBe(true);
  });

  it('accepts optional date hints in any chronological order without chapter scheduling', () => {
    const trip = fresh();
    trip.quests[0].visit.recommendedDate = '2026-09-24';
    trip.quests[1].visit.recommendedDate = '2026-09-23';
    trip.quests[2].visit.recommendedDate = null;
    expect(validateTrip(trip).success).toBe(true);
  });

  it('still rejects nonexistent optional dates without inventing a replacement', () => {
    const trip = fresh();
    trip.quests[1].visit.recommendedDate = '2026-09-31';
    expect(codes(trip)).toContain('INVALID_DATE');
    expect(trip.quests[1].visit.recommendedDate).toBe('2026-09-31');
  });

  it('accepts one-day planning with all independent place dates unspecified', () => {
    const trip = fresh();
    trip.adventure.endDate = trip.adventure.startDate;
    expect(
      trip.quests.every((quest) => quest.visit.recommendedDate === null),
    ).toBe(true);
    expect(validateTrip(trip).success).toBe(true);
  });

  it.each([
    ['2024-02-29', true],
    ['2026-02-29', false],
    ['2026-02-30', false],
    ['2000-02-29', true],
    ['1900-02-29', false],
    ['2026-13-01', false],
    ['2026-04-31', false],
    ['2026-00-01', false],
    ['0000-01-01', false],
  ])('checks actual calendar date %s', (date, valid) =>
    expect(isCalendarDate(date as string)).toBe(valid),
  );

  it('preserves an optional calendar hint despite device/destination differences', () => {
    const trip = fresh();
    trip.adventure.timeZone = 'Pacific/Honolulu';
    trip.quests[0].visit.recommendedDate = '2026-09-23';
    expect(validateTrip(trip).success).toBe(true);
    expect(trip.quests[0].visit.recommendedDate).toBe('2026-09-23');
  });

  it('rejects limits and whitespace instead of truncating content', () => {
    const trip = fresh();
    trip.adventure.endingText = '文'.repeat(20_001);
    expect(codes(trip)).toContain('VALUE_TOO_LARGE');
    trip.adventure.endingText = ' \n\t';
    expect(codes(trip)).toContain('INVALID_FIELD');
    const tooLarge = {
      ...fixture,
      extra: '字'.repeat(Math.ceil(MAX_REPLY_BYTES / 3)),
    };
    expect(codes(tooLarge)).toContain('TRIP_TOO_LARGE');
  });

  it('allows only the documented empty explanation fields', () => {
    const trip = fresh();
    trip.adventure.subtitle = '';
    Object.assign(trip.quests[0].visit, {
      transportNote: '',
      accessNote: '',
      safetyNote: '',
    });
    expect(validateTrip(trip).success).toBe(true);
    trip.quests[0].visit.fallbackText = '';
    expect(validateTrip(trip).success).toBe(false);
  });
});

describe('coordinates and safe normalization', () => {
  it('accepts null coordinates and sourced numerical zeros', () => {
    expect(validateTrip(fixture).success).toBe(true);
    expect(validateTrip(coordinateFixture).success).toBe(true);
  });

  it.each([
    ['latitude only', { latitude: 0 }, 'COORDINATE_PAIR_REQUIRED'],
    ['longitude only', { longitude: 0 }, 'COORDINATE_PAIR_REQUIRED'],
    [
      'no coordinate source',
      { latitude: 0, longitude: 0 },
      'COORDINATE_SOURCE_REQUIRED',
    ],
    ['invalid latitude', { latitude: 91, longitude: 0 }, 'VALUE_TOO_LARGE'],
    ['invalid longitude', { latitude: 0, longitude: 181 }, 'VALUE_TOO_LARGE'],
    ['other coordinate system', { coordinateSystem: 'GCJ02' }, 'INVALID_FIELD'],
    [
      'unknown coordinate source',
      { latitude: 0, longitude: 0, coordinateSourceId: 'source_missing' },
      'UNKNOWN_SOURCE',
    ],
  ])('rejects %s', (_name, overrides, code) => {
    const trip = fresh();
    Object.assign(trip.quests[0].location, overrides);
    expect(codes(trip)).toContain(code);
  });

  it('fills only absent optional ID lists and entirely absent coordinate fields', () => {
    const trip = fresh();
    const quest = trip.quests[0] as unknown as Record<string, unknown>;
    delete quest.npcIds;
    delete quest.sourceIds;
    const location = quest.location as Record<string, unknown>;
    for (const key of [
      'latitude',
      'longitude',
      'coordinateSourceId',
      'coordinateSystem',
    ])
      delete location[key];
    const original = structuredClone(trip);
    const result = validateTrip(trip);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.warnings).toHaveLength(4);
      expect(result.data.quests[0].location.latitude).toBeNull();
      expect(result.data.quests[0].location.coordinateSystem).toBe('WGS84');
    }
    expect(trip).toEqual(original);
  });

  it('does not guess a single missing coordinate, unknown fields, or missing story', () => {
    const trip = fresh();
    delete (
      trip.quests[0].location as Partial<RPGTrip['quests'][number]['location']>
    ).latitude;
    expect(validateTrip(trip).success).toBe(false);
    const raw = JSON.parse(encoded());
    raw.quests[0].story = undefined;
    raw.quests[0].sourceIds = null;
    expect(validateTrip(raw).success).toBe(false);
  });
});

describe('source URL text preservation', () => {
  it.each([
    ['HTTP URL', 'http://example.com/travel?name=峨眉山#路线'],
    ['unreachable HTTPS URL', 'https://no-such-travel-source.invalid/path'],
    ['no scheme', 'www.example.com/峨眉山'],
    ['Markdown link', '[峨眉山资料](https://example.com/旅行)'],
    [
      'AI Markdown URL label',
      '[https://example.com/travel](https://example.com/travel)',
    ],
    ['surrounding whitespace', ' \nhttps://example.com/原文\t '],
    ['incomplete URL', 'https://'],
    ['non-HTTP scheme', 'ftp://example.com/source'],
    ['script text', 'javascript:alert(1)'],
    ['local file text', 'file:///旅行/资料.html'],
    ['empty text', ''],
    ['whitespace text', ' \n\t'],
    ['long URL', `https://example.com/?q=${'字'.repeat(3_000)}`],
  ])(
    'preserves %s through reply import and backup round-trip',
    (_name, url) => {
      const trip = structuredClone(coordinateFixture);
      trip.adventure.sources[0].url = url;
      const raw = `<RPG_TRIP_V1>\n${JSON.stringify(trip)}\n</RPG_TRIP_V1>`;
      const imported = parseImport(raw);
      expect(imported.success).toBe(true);
      if (!imported.success) return;
      expect(imported.data.adventure.sources[0].url).toBe(url);
      expect(imported.data).toEqual(trip);
      expect(imported.rawReply).toBe(raw);
      expect(imported.warnings).toEqual([]);

      const restored = parseImport(
        JSON.stringify(createSave(imported.data, null)),
      );
      expect(restored.success).toBe(true);
      if (restored.success) expect(restored.data).toEqual(trip);
    },
  );

  it('still requires a string URL field and valid source metadata', () => {
    for (const invalid of [undefined, null, 123, {}, []]) {
      const trip = structuredClone(coordinateFixture);
      Object.assign(trip.adventure.sources[0], { url: invalid });
      expect(codes(trip)).toContain('INVALID_FIELD');
    }
    const trip = structuredClone(coordinateFixture);
    trip.adventure.sources[0].checkedOn = '2026-02-30';
    expect(codes(trip)).toContain('INVALID_DATE');
  });

  it('retains the whole-story size limit for URL text', () => {
    const trip = structuredClone(coordinateFixture);
    trip.adventure.sources[0].url = 'x'.repeat(MAX_REPLY_BYTES);
    expect(codes(trip)).toContain('TRIP_TOO_LARGE');
  });
});

describe('generation and repair prompts', () => {
  const input: TripInput = {
    destination: '哨兵_唯一目的地“引号”\n下一行',
    startDate: '2026-12-31',
    endDate: '2027-01-02',
    gameStyle: '游戏"内容"',
    interests: '建筑 & 街道',
    constraints: '不要忽略\n住宿"限制"',
  };

  it('embeds the full canonical schema and exact serialized six-field input', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-20T12:00:00Z'));
    const prompt = createGenerationPrompt(input);
    expect(prompt).toContain(JSON.stringify(input, null, 2));
    expect(prompt).toContain(JSON.stringify(tripJsonSchema, null, 2));
    expect(prompt).toContain('RPG_TRIP_V1');
    expect(prompt).toContain('提示生成日期：2026-09-20');
    expect(prompt).toContain('不是任何旅行来源的核验日期');
    expect(prompt).not.toContain('trip_fixture_01');
    expect(prompt).not.toMatch(/TODO|\{JSON\}|\$\{|\.\.\./);
    vi.useRealTimers();
  });

  it('retains the full experience, causality, safety, reality and ending instructions', () => {
    const prompt = createGenerationPrompt(input);
    for (const sentence of [
      '不是完成旅游打卡，也不是把景点清单改成任务名称。',
      '产生疑问 → 自选一个地点调查 → 获得该地点的线索',
      '不能把上一任务的线索、行动或访问作为当前任务的前提',
      '每个 QUEST 包含 3–5 个可执行行动',
      '不写“请分析/解释/回答为什么”',
      '不得承诺现场一定有某位老僧、店员、守卫',
      '不得要求触摸文物、跨越围栏',
      '不能联网或不能确认时，不编造',
      '结局应回应各地点线索之间的证据关系',
      '不得要求打开没有提供的附件、图片或按钮',
    ])
      expect(prompt).toContain(sentence);
  });

  it('tells AI to create independent place quests before any other detailed requirements', () => {
    const prompt = createGenerationPrompt(input);
    expect(prompt.slice(0, 500)).toContain(
      '按真实地点拆分独立任务，不要安排固定行程',
    );
    for (const text of [
      '每个地点都能作为第一次调查的入口',
      '不能假设我已经去过别处',
      'order 只控制展示顺序，不是游玩顺序',
      'recommendedDate 默认 null',
      '无论按什么顺序访问都能成立',
      'schemaVersion 1.1',
    ])
      expect(prompt).toContain(text);
    expect(prompt).not.toContain('一般每个游览日安排 2–4');
    expect(prompt).not.toContain('仅第 1 个任务 initialStatus=available');
    expect(prompt).not.toContain(
      '上一任务获得的信息，必须成为下一任务的行动动机',
    );
  });

  it('repairs old chain assumptions while preserving valid independent actions', () => {
    const prompt = createRepairPrompt('{"schemaVersion":"1.0"}', [
      {
        code: 'UNSUPPORTED_SCHEMA_VERSION',
        path: '$.schemaVersion',
        message: '需要自由地点任务',
      },
    ]);
    expect(prompt).toContain('必须把这些依赖改写为本地点自包含的背景与行动');
    expect(prompt).toContain(
      '如果原包已经是 1.1，只修正报错问题并保留未出错的安全行动',
    );
    expect(prompt).toContain('在 verificationNotes 如实说明');
    expect(prompt).toContain(JSON.stringify(tripJsonSchema, null, 2));
  });

  it("never carries another call's private input into the next prompt", () => {
    createGenerationPrompt(input);
    const next = createGenerationPrompt({
      ...input,
      destination: '新的地方',
      constraints: '',
    });
    expect(next).not.toContain('哨兵_唯一目的地');
    expect(next).not.toContain(JSON.stringify(input.constraints));
  });

  it('includes all errors, escaped raw text and the full schema in repairs', () => {
    const raw = '原回复\n"不要按协议" <script>evil()</script>';
    const errors = Array.from({ length: 30 }, (_, index) => ({
      code: 'UNKNOWN_CLUE',
      path: `$.quests[${index}].rewardClueIds`,
      message: '引用了不存在的线索。',
    }));
    const prompt = createRepairPrompt(raw, errors, input);
    expect(prompt).toContain(JSON.stringify(errors, null, 2));
    expect(prompt).toContain(JSON.stringify(raw));
    expect(prompt).toContain(JSON.stringify(input, null, 2));
    expect(prompt).toContain(JSON.stringify(tripJsonSchema, null, 2));
    expect(prompt).toContain(
      '保留已有故事主题、目的地、旅行日期、地点与可独立执行的行动',
    );
    expect(prompt).toContain('不得删除整段任务以回避错误');
    expect(createRepairPrompt(raw, errors)).toContain('无可靠关联的原请求');
    expect(createRepairPrompt(raw, errors)).not.toContain('哨兵_唯一目的地');
  });

  it('checks required fields, actual dates and bounded form text', () => {
    expect(validateTripInput(input)).toEqual([]);
    expect(
      validateTripInput({ ...input, destination: '', startDate: '2026-02-30' }),
    ).toHaveLength(2);
    expect(
      validateTripInput({ ...input, endDate: '2026-12-30' }).map(
        (issue) => issue.path,
      ),
    ).toContain('$.endDate');
    expect(
      validateTripInput({ ...input, constraints: 'x'.repeat(20_001) }).map(
        (issue) => issue.path,
      ),
    ).toContain('$.constraints');
  });
});
