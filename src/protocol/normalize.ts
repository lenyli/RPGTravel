import { isReservedId, unsafeStructureIssue } from './extract';
import type { RPGTrip } from './schema';
import { isCalendarDate, validateTrip, type Issue } from './validate';

export type StoryNormalize =
  | {
      success: true;
      value: RPGTrip;
      warnings: string[];
      supplements: string[];
    }
  | { success: false; errors: Issue[] };

const ADVENTURE_KEYS = [
  'id',
  'title',
  'subtitle',
  'destination',
  'startDate',
  'endDate',
  'timeZone',
  'gameStyle',
  'premise',
  'mainMystery',
  'finalGoal',
  'endingTitle',
  'endingText',
  'practicalNotes',
  'verificationNotes',
  'sources',
] as const;
const CHAPTER_KEYS = ['id', 'order', 'title', 'area', 'intro', 'questIds'];
const QUEST_KEYS = [
  'id',
  'chapterId',
  'order',
  'title',
  'location',
  'visit',
  'story',
  'npcIds',
  'objectives',
  'completionText',
  'rewardClueIds',
  'sourceIds',
];
const LOCATION_KEYS = [
  'name',
  'address',
  'query',
  'latitude',
  'longitude',
  'coordinateSystem',
  'coordinateSourceId',
];
const VISIT_KEYS = [
  'recommendedDate',
  'recommendedTime',
  'estimatedMinutes',
  'durationText',
  'transportNote',
  'accessNote',
  'safetyNote',
  'fallbackText',
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const fail = (code: string, path: string, message: string): StoryNormalize => ({
  success: false,
  errors: [{ code, path, message }],
});

function looksLikeAdventure(value: unknown): boolean {
  return (
    isRecord(value) &&
    ['title', 'destination', 'premise', 'endingText', 'mainMystery'].some(
      (key) => typeof value[key] === 'string' && value[key].trim(),
    )
  );
}

function text(value: unknown, max = 20_000): string | null {
  if (typeof value !== 'string') return null;
  if (value.length > max) return null;
  return value;
}

function tooBig(value: unknown, max = 20_000): boolean {
  return typeof value === 'string' && value.length > max;
}

function calendarOrNull(
  value: unknown,
  warnings: string[],
  label: string,
): string | null {
  if (value == null || value === '') return null;
  if (typeof value === 'string' && isCalendarDate(value)) return value;
  if (typeof value === 'string' && value.trim())
    warnings.push(
      `${label}未能识别（${value.trim().slice(0, 40)}），已保持未提供，没有填入今天。`,
    );
  return null;
}

function validZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function uniqueId(base: string, used: Set<string>): string {
  const stem = /^[a-z]/.test(base) ? base : `id_${base}`;
  let id = stem.slice(0, 64).replace(/[^a-z0-9_]/g, '_') || 'id_item';
  if (!/^[a-z]/.test(id)) id = `id_${id}`.slice(0, 64);
  let next = id;
  let n = 2;
  while (used.has(next) || isReservedId(next) || !/^[a-z][a-z0-9_]{0,63}$/.test(next)) {
    const suffix = `_${n++}`;
    next = `${id.slice(0, 64 - suffix.length)}${suffix}`;
  }
  used.add(next);
  return next;
}

function pick(source: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) if (Object.hasOwn(source, key)) out[key] = source[key];
  return out;
}

function rememberUnknown(
  source: Record<string, unknown>,
  keys: string[],
  supplements: string[],
): boolean {
  let found = false;
  for (const key of Object.keys(source)) {
    if (keys.includes(key)) continue;
    found = true;
    const value = source[key];
    if (typeof value === 'string' && value.trim())
      supplements.push(`${key}：${value.trim().slice(0, 500)}`);
  }
  return found;
}

function numberOrNull(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value)))
    return Number(value);
  return null;
}

export function normalizeImportedStory(input: unknown): StoryNormalize {
  const unsafe = unsafeStructureIssue(input);
  if (unsafe) return { success: false, errors: [unsafe] };
  const direct = validateTrip(input);
  if (direct.success) {
    const warnings: string[] = [];
    if (!direct.data.adventure.endingText.trim())
      warnings.push('尚缺结局。可以先保存已有任务；这里不会用套话代替结局。');
    return { success: true, value: direct.data, warnings, supplements: [] };
  }
  if (!isRecord(input))
    return fail('INVALID_ROOT', '$', '请粘贴完整的故事正文或 JSON 对象。');
  if (
    typeof input.schemaVersion === 'string' &&
    input.schemaVersion !== '1.0' &&
    input.schemaVersion !== '1.1'
  )
    return fail(
      'UNSUPPORTED_SCHEMA_VERSION',
      '$.schemaVersion',
      '无法读取这个故事版本。当前只导入 1.1，以及可辨认的旧 1.0 故事。',
    );

  const warnings: string[] = [];
  const supplements: string[] = [];
  if (input.schemaVersion === '1.0')
    warnings.push(
      '这是按旧版 1.0 导入的故事。原剧情可能仍依赖访问顺序；本次没有把它改写成独立地点叙事，也没有继承旧的锁定状态。',
    );

  let adventure: Record<string, unknown> | null = isRecord(input.adventure)
    ? input.adventure
    : null;
  if (!adventure) {
    const named = ['meta', 'trip', 'metadata'].filter(
      (key) => isRecord(input[key]) && looksLikeAdventure(input[key]),
    );
    if (named.length > 1)
      return fail(
        'AMBIGUOUS_ADVENTURE',
        '$.adventure',
        '这份内容里有多份冒险概要，没有替你选择。请只保留一份后再导入。',
      );
    if (named.length === 1) {
      adventure = input[named[0]] as Record<string, unknown>;
      warnings.push(
        `完整的 ${named[0]} 冒险概要已改用 adventure 字段，内容未改写。`,
      );
    } else if (looksLikeAdventure(input)) {
      adventure = input;
      warnings.push('根对象中完整的冒险概要字段已收拢至 adventure，内容未改写。');
    }
  }
  if (!adventure)
    return fail(
      'INVALID_FIELD',
      '$.adventure',
      '没有找到冒险标题或目的地。请保留原文，补上标题后再导入。',
    );
  if (rememberUnknown(adventure, [...ADVENTURE_KEYS], supplements))
    warnings.push('已忽略协议以外的字段，原文仍保留。');
  for (const value of Object.values(adventure)) {
    if (tooBig(value))
      return fail(
        'VALUE_TOO_LARGE',
        '$.adventure',
        '有一段文字超过单字段安全上限，没有截断。请缩短后再导入。',
      );
  }

  const chaptersIn = Array.isArray(input.chapters) ? input.chapters : [];
  const questsIn = Array.isArray(input.quests) ? input.quests : [];
  if (!questsIn.length)
    return fail('NO_QUESTS', '$.quests', '没有识别到地点任务。');
  if (questsIn.length > 60)
    return fail('VALUE_TOO_LARGE', '$.quests', '地点超过 60 处，没有删减。请拆成更小的冒险。');

  const used = new Set<string>();
  const counts = new Map<string, number>();
  const noteId = (value: unknown) => {
    if (typeof value !== 'string' || !value) return;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  };
  noteId(adventure.id);
  for (const chapter of chaptersIn) if (isRecord(chapter)) noteId(chapter.id);
  for (const quest of questsIn) {
    if (!isRecord(quest)) continue;
    noteId(quest.id);
    if (Array.isArray(quest.objectives))
      for (const objective of quest.objectives)
        if (isRecord(objective)) noteId(objective.id);
  }
  for (const clue of Array.isArray(input.clues) ? input.clues : [])
    if (isRecord(clue)) noteId(clue.id);
  for (const npc of Array.isArray(input.npcs) ? input.npcs : [])
    if (isRecord(npc)) noteId(npc.id);
  for (const source of Array.isArray(adventure.sources) ? adventure.sources : [])
    if (isRecord(source)) noteId(source.id);

  const ambiguous = new Set(
    [...counts.entries()].filter(([, count]) => count > 1).map(([id]) => id),
  );
  if (ambiguous.size)
    warnings.push('有重复标识，关联不确定的内容已从可执行结构中分开，正文仍留在原始回复里。');

  const assign = (raw: unknown, fallback: string): string => {
    if (typeof raw === 'string' && raw && !ambiguous.has(raw)) {
      if (/^[a-z][a-z0-9_]{0,63}$/.test(raw) && !isReservedId(raw) && !used.has(raw)) {
        used.add(raw);
        return raw;
      }
    }
    return uniqueId(fallback, used);
  };

  const chapterAlias = new Map<string, string>();
  const chapters = chaptersIn.map((chapter, index) => {
    const source = isRecord(chapter) ? chapter : {};
    if (rememberUnknown(source, CHAPTER_KEYS, supplements))
      warnings.push('已忽略协议以外的字段，原文仍保留。');
    const next = pick(source, CHAPTER_KEYS);
    const subtitle = text(source.subtitle);
    const introText = text(source.intro);
    if (typeof source.intro !== 'undefined' && typeof source.intro !== 'string')
      supplements.push(`章节简介原文不是文字，已留在原始回复中。`);
    if (subtitle !== null) {
      next.intro = !introText
        ? subtitle
        : !subtitle || introText === subtitle
          ? introText
          : `${introText}\n\n${subtitle}`;
      warnings.push(`第 ${index + 1} 个章节的 subtitle 已并入 intro，原文字保留。`);
    } else if (introText !== null) next.intro = introText;
    else {
      next.intro = '';
      warnings.push(`第 ${index + 1} 个章节未给出 intro，已留空，不补写剧情。`);
    }
    const title = text(source.title)?.trim() || `分组${index + 1}`;
    next.title = title;
    if (!text(source.area)?.trim()) {
      next.area = title;
      warnings.push(
        `第 ${index + 1} 个章节缺少 area，已使用现有章节标题作为分组名称。`,
      );
    } else next.area = text(source.area)!.trim();
    next.id = assign(source.id, `chapter_${String(index + 1).padStart(3, '0')}`);
    chapterAlias.set(next.id as string, next.id as string);
    if (typeof source.id === 'string') chapterAlias.set(source.id, next.id as string);
    next.order = index + 1;
    next.questIds = [];
    return next;
  });
  if (!chapters.length) {
    const id = assign('chapter_001', 'chapter_001');
    chapters.push({
      id,
      order: 1,
      title: '本次冒险',
      area: '本次冒险',
      intro: '',
      questIds: [],
    });
  }

  const cluesIn = Array.isArray(input.clues) ? input.clues : [];
  const clueById = new Map<string, Record<string, unknown>>();
  const clues = cluesIn.flatMap((clue, index) => {
    if (!isRecord(clue)) return [];
    const content = text(clue.content)?.trim() ?? '';
    const title = text(clue.title)?.trim() || `线索${index + 1}`;
    if (!content) {
      if (clue.content != null && String(clue.content).trim())
        supplements.push(`线索“${title}”没有可用正文，没有另写内容。`);
      return [];
    }
    const id = assign(clue.id, `clue_${String(index + 1).padStart(3, '0')}`);
    const item = {
      id,
      title,
      content,
      sourceQuestId: typeof clue.sourceQuestId === 'string' ? clue.sourceQuestId : '',
      rawId: typeof clue.id === 'string' ? clue.id : '',
    };
    clueById.set(id, item);
    if (item.rawId) clueById.set(item.rawId, item);
    return [item];
  });

  const npcsIn = Array.isArray(input.npcs) ? input.npcs : [];
  const npcs = npcsIn.flatMap((npc, index) => {
    if (!isRecord(npc)) return [];
    const name = text(npc.name)?.trim();
    const description = text(npc.description)?.trim() ?? '';
    if (!name && !description) return [];
    return [
      {
        id: assign(npc.id, `npc_${String(index + 1).padStart(3, '0')}`),
        rawId: typeof npc.id === 'string' ? npc.id : '',
        name: name || `人物${index + 1}`,
        role: text(npc.role)?.trim() || '故事人物',
        description,
        motivation: text(npc.motivation)?.trim() ?? '',
        fictional: true as const,
      },
    ];
  });
  const npcAlias = new Map<string, string>();
  for (const npc of npcs) {
    npcAlias.set(npc.id, npc.id);
    if (npc.rawId) npcAlias.set(npc.rawId, npc.id);
  }

  const sourcesIn = Array.isArray(adventure.sources) ? adventure.sources : [];
  const sources = sourcesIn.flatMap((source, index) => {
    if (!isRecord(source)) return [];
    if (tooBig(source.url) || tooBig(source.title))
      return [];
    const url = typeof source.url === 'string' ? source.url : '';
    const title = text(source.title)?.trim() || url || `来源${index + 1}`;
    const checkedOn = calendarOrNull(
      source.checkedOn,
      warnings,
      '来源查阅日期',
    );
    return [
      {
        id: assign(source.id, `source_${String(index + 1).padStart(3, '0')}`),
        rawId: typeof source.id === 'string' ? source.id : '',
        title,
        url,
        checkedOn,
      },
    ];
  });
  if (sources.length < sourcesIn.length && sourcesIn.length > sources.length)
    warnings.push('部分来源缺少可用文字，没有编造网址。');
  const sourceAlias = new Map<string, string>();
  for (const source of sources) {
    sourceAlias.set(source.id, source.id);
    if (source.rawId) sourceAlias.set(source.rawId, source.id);
  }

  const quests = questsIn.map((quest, index) => {
    const source = isRecord(quest) ? quest : {};
    rememberUnknown(source, QUEST_KEYS, supplements);
    const locationIn = isRecord(source.location) ? source.location : {};
    const visitIn = isRecord(source.visit) ? source.visit : {};
    const storyIn = isRecord(source.story) ? source.story : {};
    const id = assign(source.id, `quest_${String(index + 1).padStart(3, '0')}`);
    const title = text(source.title)?.trim() || `地点任务${index + 1}`;
    const name = text(locationIn.name)?.trim() || '';
    const query = text(locationIn.query)?.trim() || '';
    const address = text(locationIn.address) ?? '';
    const navName = name || query || '未提供导航';
    const latitude = numberOrNull(locationIn.latitude);
    const longitude = numberOrNull(locationIn.longitude);
    const coordinateKeys = ['latitude', 'longitude', 'coordinateSourceId'];
    const coordsAbsent = coordinateKeys.every((key) => !Object.hasOwn(locationIn, key));
    let coordinates: {
      latitude: number | null;
      longitude: number | null;
      coordinateSystem: 'WGS84';
      coordinateSourceId: string | null;
    } = {
      latitude: null,
      longitude: null,
      coordinateSystem: 'WGS84',
      coordinateSourceId: null,
    };
    const sourceId =
      typeof locationIn.coordinateSourceId === 'string'
        ? locationIn.coordinateSourceId
        : null;
    const system = locationIn.coordinateSystem;
    const paired =
      typeof latitude === 'number' &&
      typeof longitude === 'number' &&
      latitude >= -90 &&
      latitude <= 90 &&
      longitude >= -180 &&
      longitude <= 180 &&
      (system == null || system === 'WGS84') &&
      !!sourceId &&
      !ambiguous.has(sourceId);
    if (coordsAbsent) {
      warnings.push(
        `第 ${index + 1} 个任务未给出坐标字段，已补为 null，使用地点搜索导航。`,
      );
      warnings.push(`第 ${index + 1} 个任务坐标全空，已补缺省坐标系统 WGS84。`);
    } else if (paired && sourceId) {
      coordinates = {
        latitude: latitude as number,
        longitude: longitude as number,
        coordinateSystem: 'WGS84',
        coordinateSourceId: sourceId,
      };
    } else if (
      latitude != null ||
      longitude != null ||
      sourceId ||
      (system != null && system !== 'WGS84')
    ) {
      warnings.push(
        `第 ${index + 1} 个地点的坐标无法使用，已改用地点搜索。原始回复里仍保留原值。`,
      );
    }
    const objectivesIn = Array.isArray(source.objectives) ? source.objectives : [];
    if (objectivesIn.length > 20)
      return { error: `第 ${index + 1} 个地点的行动超过 20 项，没有删减。` };
    const objectives = objectivesIn.flatMap((objective, actionIndex) => {
      const body = isRecord(objective)
        ? text(objective.text)?.trim()
        : text(objective)?.trim();
      if (!body) return [];
      const rawId = isRecord(objective) ? objective.id : undefined;
      return [
        {
          id: assign(
            rawId,
            `objective_${String(index + 1).padStart(3, '0')}_${String(actionIndex + 1).padStart(3, '0')}`,
          ),
          text: body,
        },
      ];
    });
    if (!Array.isArray(source.npcIds))
      warnings.push(`第 ${index + 1} 个任务缺少 npcIds，已补为空数组。`);
    if (!Array.isArray(source.sourceIds))
      warnings.push(`第 ${index + 1} 个任务缺少 sourceIds，已补为空数组。`);
    const npcRefs = (Array.isArray(source.npcIds) ? source.npcIds : []).flatMap(
      (ref) => (typeof ref === 'string' && npcAlias.has(ref) ? [npcAlias.get(ref)!] : []),
    );
    const droppedNpcs = (Array.isArray(source.npcIds) ? source.npcIds : []).filter(
      (ref) => typeof ref === 'string' && !npcAlias.has(ref),
    );
    if (droppedNpcs.length)
      warnings.push('引用了没有正文的人物，已从任务里移除，没有编造人物。');
    const sourceRefs = (Array.isArray(source.sourceIds) ? source.sourceIds : []).flatMap(
      (ref) =>
        typeof ref === 'string' && sourceAlias.has(ref) ? [sourceAlias.get(ref)!] : [],
    );
    const minutesRaw = visitIn.estimatedMinutes;
    let estimatedMinutes: number | null = null;
    let durationText: string | undefined;
    if (typeof minutesRaw === 'number' && minutesRaw >= 1 && minutesRaw <= 720)
      estimatedMinutes = Math.trunc(minutesRaw);
    else if (typeof minutesRaw === 'string') {
      const matched = minutesRaw.match(/约?\s*(\d+)\s*分钟/);
      if (matched && Number(matched[1]) >= 1 && Number(matched[1]) <= 720)
        estimatedMinutes = Number(matched[1]);
      else if (minutesRaw.trim()) durationText = minutesRaw.trim().slice(0, 200);
    } else if (typeof visitIn.durationText === 'string' && visitIn.durationText.trim())
      durationText = visitIn.durationText.trim().slice(0, 200);
    const chapterId =
      (typeof source.chapterId === 'string' && chapterAlias.get(source.chapterId)) ||
      (chapters[0].id as string);
    return {
      id,
      rawId: typeof source.id === 'string' ? source.id : '',
      chapterId,
      order: index + 1,
      title,
      location: {
        name: navName,
        address,
        query: query || (name ? name : ''),
        ...coordinates,
      },
      visit: {
        recommendedDate: calendarOrNull(
          visitIn.recommendedDate,
          warnings,
          '建议日期',
        ),
        recommendedTime: text(visitIn.recommendedTime)?.trim() || null,
        estimatedMinutes,
        ...(durationText ? { durationText } : {}),
        transportNote: text(visitIn.transportNote) ?? '',
        accessNote: text(visitIn.accessNote) ?? '',
        safetyNote: text(visitIn.safetyNote) ?? '',
        fallbackText: text(visitIn.fallbackText) ?? '',
      },
      story: {
        scene: text(storyIn.scene) ?? '',
        currentMystery:
          text(storyIn.currentMystery) ??
          (text(adventure.mainMystery) ?? ''),
      },
      npcIds: [...new Set(npcRefs)],
      objectives,
      completionText: text(source.completionText) ?? '',
      rewardClueIds: Array.isArray(source.rewardClueIds)
        ? source.rewardClueIds.filter((ref): ref is string => typeof ref === 'string')
        : [],
      sourceIds: [...new Set(sourceRefs)],
    };
  });
  const questError = quests.find(
    (quest) => 'error' in quest && typeof quest.error === 'string',
  );
  if (questError && 'error' in questError)
    return fail('VALUE_TOO_LARGE', '$.quests', questError.error);
  const readyQuests = quests.filter((quest) => !('error' in quest)) as Exclude<
    (typeof quests)[number],
    { error: string }
  >[];
  if (!readyQuests.some((quest) => quest.objectives.length > 0))
    return fail(
      'NO_ACTIONS',
      '$.quests',
      '没有识别到行动列表。尚未提供行动的地点不能假装已经可以游玩。',
    );

  const questIdSet = new Set(
    readyQuests.flatMap((quest) => [quest.id, quest.rawId].filter(Boolean)),
  );
  const attached = new Set<string>();
  for (const quest of readyQuests) {
    const kept: string[] = [];
    for (const ref of quest.rewardClueIds) {
      const clue = clueById.get(ref);
      if (!clue) continue;
      const owner = String(clue.sourceQuestId || '');
      if (owner && questIdSet.has(owner) && owner !== quest.id && owner !== quest.rawId)
        continue;
      const clueId = String(clue.id);
      if (attached.has(clueId)) continue;
      attached.add(clueId);
      kept.push(clueId);
      clue.sourceQuestId = quest.id;
    }
    quest.rewardClueIds = kept;
  }
  for (const clue of clues) {
    if (attached.has(String(clue.id))) continue;
    const owner = readyQuests.find(
      (quest) => quest.id === clue.sourceQuestId || quest.rawId === clue.sourceQuestId,
    );
    if (owner && !attached.has(String(clue.id))) {
      attached.add(String(clue.id));
      owner.rewardClueIds.push(String(clue.id));
      clue.sourceQuestId = owner.id;
      continue;
    }
    supplements.push(`未关联线索：${clue.title}\n${clue.content}`);
    warnings.push('有线索无法判断属于哪一处地点，已放在未关联内容里，没有挂到第一处。');
  }
  for (const quest of readyQuests) {
    if (quest.location.coordinateSourceId) {
      const mapped = sourceAlias.get(quest.location.coordinateSourceId);
      if (mapped) quest.location.coordinateSourceId = mapped;
      else {
        quest.location.latitude = null;
        quest.location.longitude = null;
        quest.location.coordinateSourceId = null;
        warnings.push('坐标来源对不上，已改用地点搜索。原始回复里仍保留原值。');
      }
    }
  }
  const executableClues = clues
    .filter((clue) => attached.has(String(clue.id)))
    .map(({ rawId: _rawId, ...clue }) => clue);
  for (const chapter of chapters) {
    chapter.questIds = readyQuests
      .filter((quest) => quest.chapterId === chapter.id)
      .map((quest) => quest.id);
  }
  const keptChapters = chapters.filter(
    (chapter) => (chapter.questIds as string[]).length > 0,
  );
  for (const chapter of chapters) {
    if ((chapter.questIds as string[]).length) continue;
    if (typeof chapter.intro === 'string' && chapter.intro.trim())
      supplements.push(`未挂上任务的章节说明：${chapter.title}\n${chapter.intro}`);
  }
  if (!keptChapters.length) return fail('NO_QUESTS', '$.chapters', '没有识别到地点任务。');
  keptChapters.forEach((chapter, index) => {
    chapter.order = index + 1;
  });
  const orphanQuests = readyQuests.filter(
    (quest) => !keptChapters.some((chapter) => chapter.id === quest.chapterId),
  );
  if (orphanQuests.length) {
    const id = assign('chapter_extra', 'chapter_extra');
    keptChapters.push({
      id,
      order: keptChapters.length + 1,
      title: '本次冒险',
      area: '本次冒险',
      intro: '',
      questIds: orphanQuests.map((quest) => quest.id),
    });
    for (const quest of orphanQuests) quest.chapterId = id;
  }

  const destination =
    text(adventure.destination)?.trim() ||
    [
      ...new Set(
        readyQuests
          .map((quest) => quest.location.name)
          .filter((name) => name && name !== '未提供导航'),
      ),
    ].join('、') ||
    '未提供目的地';
  const endingText = text(adventure.endingText) ?? '';
  const endingTitle = text(adventure.endingTitle)?.trim() ?? '';
  if (!endingText.trim())
    warnings.push('尚缺结局。可以先保存已有任务；这里不会用套话代替结局。');
  const gameStyle = Array.isArray(adventure.gameStyle)
    ? adventure.gameStyle.filter((item): item is string => typeof item === 'string' && !!item.trim())
    : typeof adventure.gameStyle === 'string' && adventure.gameStyle.trim()
      ? [adventure.gameStyle.trim()]
      : [];
  const notes = (key: 'practicalNotes' | 'verificationNotes') =>
    (Array.isArray(adventure[key]) ? adventure[key] : []).filter(
      (item): item is string => typeof item === 'string' && !!item.trim(),
    );
  const startDate = calendarOrNull(adventure.startDate, warnings, '开始日期');
  const endDate = calendarOrNull(adventure.endDate, warnings, '结束日期');
  let timeZone: string | null = null;
  if (typeof adventure.timeZone === 'string' && adventure.timeZone.trim()) {
    timeZone = validZone(adventure.timeZone) ? adventure.timeZone : null;
    if (!timeZone) warnings.push('时区无法识别，已保持未提供。');
  }

  const draft = {
    schemaVersion: '1.1' as const,
    adventure: {
      id: assign(adventure.id, 'adventure_001'),
      title: text(adventure.title)?.trim() || '未命名冒险',
      subtitle: text(adventure.subtitle) ?? '',
      destination,
      startDate,
      endDate,
      timeZone,
      gameStyle,
      premise: text(adventure.premise) ?? '',
      mainMystery: text(adventure.mainMystery) ?? '',
      finalGoal: text(adventure.finalGoal) ?? '',
      endingTitle: endingText.trim() ? endingTitle || '故事结局' : endingTitle,
      endingText,
      practicalNotes: notes('practicalNotes'),
      verificationNotes: notes('verificationNotes'),
      sources: sources.map(({ rawId: _rawId, ...source }) => source),
    },
    chapters: keptChapters,
    quests: readyQuests.map(({ rawId: _rawId, ...quest }) => quest),
    clues: executableClues,
    npcs: npcs.map(({ rawId: _rawId, ...npc }) => npc),
  };
  const checked = validateTrip(draft);
  if (!checked.success) return checked;
  const emptyObjectives = checked.data.quests.filter(
    (quest) => quest.objectives.length === 0,
  ).length;
  if (emptyObjectives)
    warnings.push(
      `${emptyObjectives} 处地点尚未提供行动，不会被自动算成已完成。`,
    );
  return {
    success: true,
    value: checked.data,
    warnings: [...new Set(warnings)],
    supplements: [...new Set(supplements)],
  };
}
