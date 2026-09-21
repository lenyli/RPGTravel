import {
  adventureSchema,
  chapterSchema,
  tripSchema,
  type RPGTrip,
} from './schema';
import { isReservedId, MAX_REPLY_BYTES, unsafeStructureIssue } from './extract';

export type Issue = { code: string; path: string; message: string };
export type TripValidation =
  | { success: true; data: RPGTrip; warnings: string[] }
  | { success: false; errors: Issue[] };
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return (
    day <=
    [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
  );
}

function normalize(input: unknown): { value: unknown; warnings: string[] } {
  const warnings: string[] = [];
  if (!record(input)) return { value: input, warnings };
  const value = { ...input };
  if (!Object.hasOwn(value, 'adventure')) {
    const keys = Object.keys(adventureSchema.shape);
    const flat = Object.fromEntries(keys.map((key) => [key, input[key]]));
    const candidates = [
      { key: '$', data: flat },
      ...['meta', 'trip', 'metadata'].map((key) => ({ key, data: input[key] })),
    ].filter((candidate) => adventureSchema.safeParse(candidate.data).success);
    if (candidates.length === 1) {
      const candidate = candidates[0];
      value.adventure = candidate.data;
      if (candidate.key === '$') {
        for (const key of keys) delete value[key];
        warnings.push(
          '根对象中完整的冒险概要字段已收拢至 adventure，内容未改写。',
        );
      } else {
        delete value[candidate.key];
        warnings.push(
          `完整的 ${candidate.key} 冒险概要已改用 adventure 字段，内容未改写。`,
        );
      }
    }
  }
  if (Array.isArray(input.chapters)) {
    value.chapters = input.chapters.map((chapter: unknown, index: number) => {
      if (!record(chapter)) return chapter;
      const next = { ...chapter };
      if (
        typeof next.subtitle === 'string' &&
        (!Object.hasOwn(next, 'intro') || typeof next.intro === 'string')
      ) {
        const intro = typeof next.intro === 'string' ? next.intro : '';
        next.intro = !intro
          ? next.subtitle
          : !next.subtitle || intro === next.subtitle
            ? intro
            : `${intro}\n\n${next.subtitle}`;
        delete next.subtitle;
        warnings.push(
          `第 ${index + 1} 个章节的 subtitle 已并入 intro，原文字保留。`,
        );
      }
      if (
        !Object.hasOwn(next, 'area') &&
        chapterSchema.shape.title.safeParse(next.title).success
      ) {
        next.area = next.title;
        warnings.push(
          `第 ${index + 1} 个章节缺少 area，已使用现有章节标题作为分组名称。`,
        );
      }
      if (!Object.hasOwn(next, 'intro')) {
        next.intro = '';
        warnings.push(
          `第 ${index + 1} 个章节未给出 intro，已留空，不补写剧情。`,
        );
      }
      return next;
    });
  }
  if (!Array.isArray(input.quests)) return { value, warnings };
  value.quests = input.quests.map((quest: unknown, index: number) => {
    if (!record(quest)) return quest;
    const next = { ...quest };
    for (const key of ['npcIds', 'sourceIds']) {
      if (!Object.hasOwn(next, key)) {
        next[key] = [];
        warnings.push(`第 ${index + 1} 个任务缺少 ${key}，已补为空数组。`);
      }
    }
    if (record(quest.location)) {
      const location = { ...quest.location };
      const coordinateKeys = ['latitude', 'longitude', 'coordinateSourceId'];
      if (coordinateKeys.every((key) => !Object.hasOwn(location, key))) {
        for (const key of coordinateKeys) location[key] = null;
        warnings.push(
          `第 ${index + 1} 个任务未给出坐标字段，已补为 null，使用地点搜索导航。`,
        );
      }
      if (
        coordinateKeys.every((key) => location[key] === null) &&
        !Object.hasOwn(location, 'coordinateSystem')
      ) {
        location.coordinateSystem = 'WGS84';
        warnings.push(
          `第 ${index + 1} 个任务坐标全空，已补缺省坐标系统 WGS84。`,
        );
      }
      next.location = location;
    }
    return next;
  });
  return { value, warnings };
}

export function validateTrip(input: unknown): TripValidation {
  const unsafe = unsafeStructureIssue(input);
  if (unsafe) return { success: false, errors: [unsafe] };
  try {
    if (
      new TextEncoder().encode(JSON.stringify(input)).length > MAX_REPLY_BYTES
    )
      return {
        success: false,
        errors: [
          {
            code: 'TRIP_TOO_LARGE',
            path: '$',
            message:
              '故事内容的紧凑 JSON 超过 2 MiB 上限，请让 AI 缩减篇幅后完整重发。',
          },
        ],
      };
  } catch {
    return {
      success: false,
      errors: [
        {
          code: 'INVALID_STRUCTURE',
          path: '$',
          message: '输入不是可读取的 JSON 数据。',
        },
      ],
    };
  }
  if (
    record(input) &&
    Object.hasOwn(input, 'schemaVersion') &&
    input.schemaVersion !== '1.1'
  )
    return {
      success: false,
      errors: [
        {
          code: 'UNSUPPORTED_SCHEMA_VERSION',
          path: '$.schemaVersion',
          message:
            '当前仅支持 schemaVersion 为 "1.1" 的自由地点冒险包。请复制修复 Prompt，让 AI 按地点独立任务重新输出完整包；旧版不自动迁移。',
        },
      ],
    };
  const normalized = normalize(input);
  const result = tripSchema.safeParse(normalized.value);
  if (!result.success) {
    return {
      success: false,
      errors: result.error.issues.map((issue) => {
        const path =
          '$' +
          issue.path
            .map((part) =>
              typeof part === 'number' ? `[${part}]` : `.${String(part)}`,
            )
            .join('');
        if (issue.code === 'unrecognized_keys')
          return {
            code: 'UNKNOWN_FIELD',
            path,
            message: `存在协议未允许的字段：${issue.keys.join('、')}。请保留正式协议字段。`,
          };
        if (issue.code === 'too_big')
          return {
            code: 'VALUE_TOO_LARGE',
            path,
            message:
              '字段超出协议允许的长度、数量或数值范围，请缩减后重新生成完整包。',
          };
        if (issue.code === 'too_small')
          return {
            code: 'VALUE_TOO_SMALL',
            path,
            message: '字段为空、数量不足或数值过小，请按 Schema 补齐。',
          };
        let actual = normalized.value;
        for (const part of issue.path) {
          actual =
            (record(actual) || Array.isArray(actual)) &&
            Object.hasOwn(actual, part)
              ? (actual as Record<PropertyKey, unknown>)[part]
              : undefined;
        }
        if (actual === undefined)
          return {
            code: 'INVALID_FIELD',
            path,
            message:
              path === '$.adventure'
                ? '缺少冒险概要对象 adventure（标题、开场、结局等）；请把已有完整概要放入该对象，缺少的剧情需由 AI 补齐。'
                : `缺少必填字段 ${String(issue.path.at(-1) ?? '$')}；请按完整 Schema 提供该字段，不使用空白代替必填内容。`,
          };
        if (issue.code === 'invalid_type') {
          const typeLabels: Record<string, string> = {
            string: '文字',
            object: '对象',
            array: '数组',
            number: '数字',
            boolean: '布尔值',
            int: '整数',
          };
          const expected = typeLabels[issue.expected] ?? issue.expected;
          const received =
            actual === null
              ? 'null'
              : Array.isArray(actual)
                ? '数组'
                : typeof actual === 'object'
                  ? '对象'
                  : typeof actual === 'string'
                    ? '文字'
                    : typeof actual === 'number'
                      ? '数字'
                      : typeof actual;
          return {
            code: 'INVALID_FIELD',
            path,
            message: `字段类型错误：需要${expected}，实际为${received}；请保留原内容并调整为 Schema 要求的类型。`,
          };
        }
        if (issue.path.at(-1) === 'id')
          return {
            code: 'INVALID_ID',
            path,
            message:
              'ID 必须以小写字母开头，仅含小写字母、数字、下划线，最多 64 字符。',
          };
        return {
          code: 'INVALID_FIELD',
          path,
          message:
            issue.code === 'invalid_value'
              ? `字段值不符合协议；允许值为 ${issue.values.map((value) => JSON.stringify(value)).join('、')}。`
              : '字段格式不符合协议；请按完整 Schema 修正格式，不使用空白代替必填内容。',
        };
      }),
    };
  }
  const data = result.data;
  const errors: Issue[] = [];
  const add = (code: string, path: string, message: string) =>
    errors.push({ code, path, message });
  const knownIds = new Map<string, string>();
  const register = (id: string, path: string) => {
    if (isReservedId(id))
      add(
        'RESERVED_ID',
        path,
        '该 ID 为危险保留名称，请改为普通、唯一的协议 ID。',
      );
    if (knownIds.has(id))
      add(
        'DUPLICATE_ID',
        path,
        `ID“${id}”与 ${knownIds.get(id)} 重复；所有对象 ID 必须全局唯一。`,
      );
    else knownIds.set(id, path);
  };
  register(data.adventure.id, '$.adventure.id');
  for (const key of ['chapters', 'quests', 'clues', 'npcs'] as const)
    data[key].forEach((item, index) =>
      register(item.id, `$.${key}[${index}].id`),
    );
  data.adventure.sources.forEach((source, index) =>
    register(source.id, `$.adventure.sources[${index}].id`),
  );
  data.quests.forEach((quest, index) =>
    quest.objectives.forEach((objective, objectiveIndex) =>
      register(
        objective.id,
        `$.quests[${index}].objectives[${objectiveIndex}].id`,
      ),
    ),
  );
  const checkDate = (value: string, path: string): boolean => {
    const valid = isCalendarDate(value);
    if (!valid)
      add(
        'INVALID_DATE',
        path,
        '日期不是实际存在的日历日期，请使用 YYYY-MM-DD。',
      );
    return valid;
  };
  const startValid = checkDate(
    data.adventure.startDate,
    '$.adventure.startDate',
  );
  const endValid = checkDate(data.adventure.endDate, '$.adventure.endDate');
  if (
    startValid &&
    endValid &&
    data.adventure.endDate < data.adventure.startDate
  )
    add(
      'INVALID_DATE_RANGE',
      '$.adventure.endDate',
      '结束日期不能早于开始日期。',
    );
  if (data.adventure.timeZone !== null) {
    try {
      new Intl.DateTimeFormat('en', { timeZone: data.adventure.timeZone });
    } catch {
      add(
        'INVALID_TIME_ZONE',
        '$.adventure.timeZone',
        '目的地时区不是有效 IANA 时区；无法确认时请使用 null。',
      );
    }
  }
  data.adventure.sources.forEach((source, index) => {
    checkDate(source.checkedOn, `$.adventure.sources[${index}].checkedOn`);
  });

  const chapters = [...data.chapters].sort((a, b) => a.order - b.order);
  const quests = [...data.quests].sort((a, b) => a.order - b.order);
  const chapterMap = new Map(
    data.chapters.map((chapter) => [chapter.id, chapter]),
  );
  const questMap = new Map(data.quests.map((quest) => [quest.id, quest]));
  const clueMap = new Map(data.clues.map((clue) => [clue.id, clue]));
  const npcIds = new Set(data.npcs.map((npc) => npc.id));
  const sourceIds = new Set(data.adventure.sources.map((source) => source.id));
  const chapterMembership = new Map<string, number>();
  const rewards = new Map<string, number>();
  if (chapters.some((chapter, index) => chapter.order !== index + 1))
    add(
      'INVALID_CHAPTER_ORDER',
      '$.chapters',
      '章节 order 必须是唯一、连续的 1..N。',
    );
  if (quests.some((quest, index) => quest.order !== index + 1))
    add(
      'INVALID_QUEST_ORDER',
      '$.quests',
      '任务 order 必须是全旅程唯一、连续的 1..N。',
    );
  const flattened = chapters.flatMap((chapter) => chapter.questIds);
  if (
    flattened.length !== quests.length ||
    flattened.some((id, index) => id !== quests[index]?.id)
  )
    add(
      'CHAPTER_QUEST_ORDER_MISMATCH',
      '$.chapters',
      '按章节顺序拼接的 questIds 必须恰好等于全局任务顺序，不能漏项、重复或乱序。',
    );
  data.chapters.forEach((chapter, index) => {
    chapter.questIds.forEach((id, refIndex) => {
      const path = `$.chapters[${index}].questIds[${refIndex}]`;
      chapterMembership.set(id, (chapterMembership.get(id) ?? 0) + 1);
      const quest = questMap.get(id);
      if (!quest) add('UNKNOWN_QUEST', path, '章节引用了不存在的任务。');
      else if (quest.chapterId !== chapter.id)
        add(
          'CHAPTER_MISMATCH',
          path,
          '章节中的任务 chapterId 与所属章节不一致。',
        );
    });
  });
  const checkRefs = (
    ids: string[],
    allowed: Set<string>,
    code: string,
    path: string,
    label: string,
  ) => {
    const seen = new Set<string>();
    ids.forEach((id, index) => {
      if (!allowed.has(id))
        add(code, `${path}[${index}]`, `引用了不存在的${label}“${id}”。`);
      if (seen.has(id))
        add(
          'DUPLICATE_REFERENCE',
          `${path}[${index}]`,
          `同一列表重复引用了${label}“${id}”。`,
        );
      seen.add(id);
    });
  };
  data.quests.forEach((quest, index) => {
    const path = `$.quests[${index}]`;
    const chapter = chapterMap.get(quest.chapterId);
    if (!chapter)
      add('UNKNOWN_CHAPTER', `${path}.chapterId`, '任务引用了不存在的章节。');
    if (chapterMembership.get(quest.id) !== 1)
      add(
        'QUEST_CHAPTER_MEMBERSHIP',
        `${path}.chapterId`,
        '每个任务必须恰好出现在一个章节的 questIds 中。',
      );
    const recommendedDate = quest.visit.recommendedDate;
    const valid =
      recommendedDate !== null &&
      checkDate(recommendedDate, `${path}.visit.recommendedDate`);
    if (
      valid &&
      startValid &&
      endValid &&
      recommendedDate !== null &&
      (recommendedDate < data.adventure.startDate ||
        recommendedDate > data.adventure.endDate)
    )
      add(
        'QUEST_DATE_OUTSIDE_TRIP',
        `${path}.visit.recommendedDate`,
        '任务建议日期必须在旅行开始和结束日期内。',
      );
    checkRefs(quest.npcIds, npcIds, 'UNKNOWN_NPC', `${path}.npcIds`, '人物');
    checkRefs(
      quest.sourceIds,
      sourceIds,
      'UNKNOWN_SOURCE',
      `${path}.sourceIds`,
      '来源',
    );
    checkRefs(
      quest.rewardClueIds,
      new Set(clueMap.keys()),
      'UNKNOWN_CLUE',
      `${path}.rewardClueIds`,
      '线索',
    );
    quest.rewardClueIds.forEach((id) => {
      rewards.set(id, (rewards.get(id) ?? 0) + 1);
      const clue = clueMap.get(id);
      if (clue && clue.sourceQuestId !== quest.id)
        add(
          'CLUE_SOURCE_MISMATCH',
          `${path}.rewardClueIds`,
          '奖励线索的 sourceQuestId 必须与当前任务相同。',
        );
    });
    const location = quest.location;
    if ((location.latitude === null) !== (location.longitude === null))
      add(
        'COORDINATE_PAIR_REQUIRED',
        `${path}.location`,
        '纬度与经度必须同时有值或同时为 null。',
      );
    if (
      location.latitude !== null &&
      location.longitude !== null &&
      location.coordinateSourceId === null
    )
      add(
        'COORDINATE_SOURCE_REQUIRED',
        `${path}.location.coordinateSourceId`,
        '有坐标时必须引用可靠的 WGS84 来源；无法确认请把坐标与来源设为 null。',
      );
    if (
      location.coordinateSourceId !== null &&
      !sourceIds.has(location.coordinateSourceId)
    )
      add(
        'UNKNOWN_SOURCE',
        `${path}.location.coordinateSourceId`,
        '坐标引用了不存在的来源。',
      );
    if (
      location.latitude === null &&
      location.longitude === null &&
      location.coordinateSourceId !== null
    )
      add(
        'COORDINATE_SOURCE_WITHOUT_COORDINATES',
        `${path}.location.coordinateSourceId`,
        '没有坐标时，坐标来源应为 null。',
      );
  });
  data.clues.forEach((clue, index) => {
    if (!questMap.has(clue.sourceQuestId))
      add(
        'UNKNOWN_QUEST',
        `$.clues[${index}].sourceQuestId`,
        '线索来源任务不存在。',
      );
    if (rewards.get(clue.id) !== 1)
      add(
        'CLUE_REWARD_COUNT',
        `$.clues[${index}]`,
        '每条线索必须恰好被一个任务奖励，不能孤立或重复奖励。',
      );
  });
  return errors.length
    ? { success: false, errors }
    : { success: true, data, warnings: normalized.warnings };
}
