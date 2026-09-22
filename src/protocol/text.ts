import { isCalendarDate, type Issue } from './validate';

export type TextCandidate = { title: string; raw: string };
export type TextParse =
  | { ok: 'story'; value: unknown; warnings: string[] }
  | { ok: 'choices'; candidates: TextCandidate[] }
  | { ok: 'error'; errors: Issue[] };

const PLACEHOLDERS = new Set([
  '一个实际可执行的行动',
  '另一个实际可执行的行动',
  '冒险标题',
  '真实地点名称＋城市或区域',
  '真实地点名称+城市或区域',
  '不剧透的共同开场',
  '正在调查的问题',
  '本次调查的目标',
  '本地点可独立理解的情景与人物对白',
  '完成后揭示的发现',
  '无法到访时的剧情补叙',
  '开放、交通、安全或待核验事项；没有可省略',
  '必要的整体出行提醒；没有可省略。',
  '实际查阅的来源标题、网址与查阅日期；未联网则说明未联网，不编造来源。',
  '让各处线索汇合，回应共同谜团，不预设访问顺序或实际看到了特定景观。',
]);

const HEADER_LABELS: Record<string, string> = {
  标题: 'title',
  目的地: 'destination',
  日期: 'dates',
  开场: 'premise',
  谜团: 'mystery',
  目标: 'goal',
};
const QUEST_LABELS: Record<string, string> = {
  导航: 'nav',
  用时: 'duration',
  剧情: 'scene',
  情景: 'scene',
  '情景 / NPC': 'scene',
  '情景/NPC': 'scene',
  行动: 'actions',
  任务列表: 'actions',
  线索: 'clue',
  获得线索: 'clue',
  跳过: 'skip',
  补叙: 'skip',
  提醒: 'note',
};

type Field = {
  title: string;
  destination: string;
  dates: string;
  premise: string;
  mystery: string;
  goal: string;
  ending: string;
  notes: string;
  sources: string;
};
type QuestDraft = {
  title: string;
  nav: string;
  duration: string;
  scene: string;
  actions: string[];
  clue: string;
  skip: string;
  note: string;
  extra: string;
};

const fail = (message: string): TextParse => ({
  ok: 'error',
  errors: [{ code: 'UNRECOGNIZED_STORY', path: '$', message }],
});

function placeholder(value: string): boolean {
  const text = value.trim();
  return !text || PLACEHOLDERS.has(text);
}

function append(current: string, next: string): string {
  if (!next) return current;
  if (!current) return next;
  return `${current}\n${next}`;
}

function headingText(line: string): string {
  let text = line.replace(/^\uFEFF/, '').trim();
  text = text.replace(/^#{1,6}\s+/, '');
  text = text.replace(/^\*\*(.+)\*\*$/, '$1').trim();
  text = text.replace(/^【\s*/, '').replace(/\s*】$/, '').trim();
  return text;
}

function matchQuest(line: string): { title: string } | null {
  const text = headingText(line);
  const quest = text.match(/^(?:地点|QUEST)\s*0*\d*\s*[|｜]\s*(.*)$/i);
  if (quest) return { title: quest[1].trim() };
  if (/^(?:地点|QUEST)\s*0*\d+$/i.test(text)) return { title: '' };
  return null;
}

function matchLabel(
  line: string,
  scope: 'header' | 'quest',
): { key: string; rest: string } | null {
  if (/^\s+\S/.test(line) && !/^\s*(?:[-*]|☐|\d+\.)\s/.test(line)) return null;
  let text = line.replace(/^\uFEFF/, '').trim();
  text = text.replace(/^#{1,6}\s+/, '');
  text = text.replace(/^\*\*([^*]+)\*\*\s*/, '$1');
  const matched = text.match(/^([^\s:：][^:：]{0,24})\s*[:：]\s*(.*)$/);
  if (!matched) return null;
  const label = matched[1].replace(/\*/g, '').trim();
  const key = (scope === 'header' ? HEADER_LABELS : QUEST_LABELS)[label];
  if (!key) return null;
  return { key, rest: matched[2] };
}

function matchAction(line: string): string | null {
  const matched = line.match(
    /^\s*(?:[-*]|☐|[-*]\s*\[[ xX]\]|\d+\.)\s+(.+)$/,
  );
  return matched ? matched[1].trim() : null;
}

function parseMinutes(value: string): {
  minutes: number | null;
  durationText?: string;
} {
  const text = value.trim();
  if (placeholder(text)) return { minutes: null };
  const matched = text.match(/约?\s*(\d+)\s*分钟/);
  if (matched) {
    const minutes = Number(matched[1]);
    if (minutes >= 1 && minutes <= 720) return { minutes };
  }
  return { minutes: null, durationText: text.slice(0, 200) };
}

function parseDates(value: string): {
  startDate: string | null;
  endDate: string | null;
} {
  const found = value.match(/\d{4}-\d{2}-\d{2}/g) ?? [];
  return {
    startDate: found[0] && isCalendarDate(found[0]) ? found[0] : null,
    endDate: found[1] && isCalendarDate(found[1]) ? found[1] : null,
  };
}

function parseSources(value: string): {
  sources: { title: string; url: string; checkedOn: string | null }[];
  verificationNotes: string[];
} {
  const sources: { title: string; url: string; checkedOn: string | null }[] =
    [];
  const verificationNotes: string[] = [];
  for (const line of value.split(/\n/)) {
    const text = line.trim().replace(/^[-*]\s+/, '');
    if (!text || placeholder(text)) continue;
    const url = text.match(/https?:\/\/\S+/);
    if (!url) {
      verificationNotes.push(text);
      continue;
    }
    const href = url[0].replace(/[，。,;；]+$/g, '');
    const date = text.match(/\d{4}-\d{2}-\d{2}/);
    const title =
      text
        .replace(url[0], '')
        .replace(date?.[0] ?? '', '')
        .replace(/^[\s\-–—:：]+|[\s\-–—:：]+$/g, '')
        .trim() || href;
    sources.push({
      title: title.slice(0, 20_000),
      url: href,
      checkedOn: date && isCalendarDate(date[0]) ? date[0] : null,
    });
  }
  return { sources, verificationNotes };
}

function parseBlock(raw: string): TextParse {
  const warnings: string[] = [];
  const field: Field = {
    title: '',
    destination: '',
    dates: '',
    premise: '',
    mystery: '',
    goal: '',
    ending: '',
    notes: '',
    sources: '',
  };
  const quests: QuestDraft[] = [];
  let quest: QuestDraft | null = null;
  let mode:
    | 'header'
    | 'quest'
    | 'actions'
    | 'ending'
    | 'notes'
    | 'sources'
    | 'done' = 'header';
  let active = '';

  const write = (key: string, value: string, replacing: boolean) => {
    if (mode === 'quest' && quest) {
      if (key === 'actions') return;
      const bag = quest as unknown as Record<string, string>;
      bag[key] = replacing ? value : append(bag[key] ?? '', value);
      active = key;
      return;
    }
    const bag = field as unknown as Record<string, string>;
    if (!(key in bag)) return;
    bag[key] = replacing ? value : append(bag[key] ?? '', value);
    active = key;
  };

  for (const line of raw.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    if (/^\s*```/.test(line)) continue;
    const questHeading = matchQuest(line);
    const bare = headingText(line);
    if (questHeading) {
      quest = {
        title: placeholder(questHeading.title) ? '' : questHeading.title,
        nav: '',
        duration: '',
        scene: '',
        actions: [],
        clue: '',
        skip: '',
        note: '',
        extra: '',
      };
      quests.push(quest);
      mode = 'quest';
      active = '';
      continue;
    }
    if (bare === '旅章') {
      mode = 'header';
      active = '';
      continue;
    }
    if (bare === '结局') {
      mode = 'ending';
      active = 'ending';
      continue;
    }
    if (bare === '实用提醒') {
      mode = 'notes';
      active = 'notes';
      continue;
    }
    if (bare === '来源') {
      mode = 'sources';
      active = 'sources';
      continue;
    }
    if (bare === '结束') {
      mode = 'done';
      active = '';
      continue;
    }
    if (mode === 'done') continue;
    if (mode === 'actions' && quest) {
      const action = matchAction(line);
      if (action) {
        if (!placeholder(action)) quest.actions.push(action);
        continue;
      }
      if (/^\s{2,}\S/.test(line) && quest.actions.length) {
        const last = quest.actions.length - 1;
        quest.actions[last] = append(quest.actions[last], line.trim());
        continue;
      }
    }
    const label = matchLabel(line, mode === 'quest' || mode === 'actions' ? 'quest' : 'header');
    if (label && (mode === 'header' || mode === 'quest' || mode === 'actions')) {
      if (label.key === 'actions') {
        mode = 'actions';
        const inline = matchAction(label.rest) ?? label.rest.trim();
        if (inline && !placeholder(inline) && quest) quest.actions.push(inline);
        continue;
      }
      mode = mode === 'actions' ? 'quest' : mode;
      write(label.key, placeholder(label.rest) ? '' : label.rest, false);
      continue;
    }
    if (!line.trim()) continue;
    if (mode === 'ending') field.ending = append(field.ending, line.trim());
    else if (mode === 'notes') field.notes = append(field.notes, line.trim());
    else if (mode === 'sources')
      field.sources = append(field.sources, line.trim());
    else if (quest && (mode === 'quest' || mode === 'actions')) {
      if (active && active !== 'actions')
        write(active, line.trim(), false);
      else quest.extra = append(quest.extra, line.trim());
    }
  }

  if (!quests.length)
    return fail('没有识别到地点。请粘贴带“地点”标题的旅章正文，或已有的 JSON。');
  const actionable = quests.filter((item) => item.actions.length > 0);
  if (!actionable.length)
    return fail('没有识别到行动列表。示例里的“一个实际可执行的行动”不会当成任务。');

  const dates = parseDates(field.dates);
  const sourcePack = parseSources(field.sources);
  const practicalNotes = field.notes
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line && !placeholder(line));
  const ending = placeholder(field.ending) ? '' : field.ending.trim();
  const tripQuests = quests.map((item, index) => {
    const minutes = parseMinutes(item.duration);
    const nav = placeholder(item.nav) ? '' : item.nav.trim();
    const scene = [item.scene, item.extra].filter((part) => part.trim()).join('\n\n');
    const clue = placeholder(item.clue) ? '' : item.clue.trim();
    return {
      id: `quest_${String(index + 1).padStart(3, '0')}`,
      chapterId: 'chapter_001',
      order: index + 1,
      title: item.title.trim() || `地点任务${index + 1}`,
      location: {
        name: nav || '未提供导航',
        address: '',
        query: nav,
        latitude: null,
        longitude: null,
        coordinateSystem: 'WGS84',
        coordinateSourceId: null,
      },
      visit: {
        recommendedDate: null,
        recommendedTime: null,
        estimatedMinutes: minutes.minutes,
        ...(minutes.durationText ? { durationText: minutes.durationText } : {}),
        transportNote: '',
        accessNote: '',
        safetyNote: '',
        fallbackText: placeholder(item.skip) ? '' : item.skip.trim(),
      },
      story: {
        scene: scene.trim(),
        currentMystery: field.mystery.trim(),
      },
      npcIds: [],
      objectives: item.actions.map((text, actionIndex) => ({
        id: `objective_${String(index + 1).padStart(3, '0')}_${String(actionIndex + 1).padStart(3, '0')}`,
        text,
      })),
      completionText: '',
      rewardClueIds: clue
        ? [`clue_${String(index + 1).padStart(3, '0')}_001`]
        : [],
      sourceIds: [],
      note: placeholder(item.note) ? '' : item.note.trim(),
    };
  });
  const clues = tripQuests.flatMap((item, index) => {
    const content = placeholder(quests[index].clue) ? '' : quests[index].clue.trim();
    if (!content) return [];
    return [
      {
        id: `clue_${String(index + 1).padStart(3, '0')}_001`,
        title: `地点${index + 1}的线索`,
        content,
        sourceQuestId: item.id,
      },
    ];
  });
  for (const item of tripQuests) {
    const note = item.note;
    delete (item as { note?: string }).note;
    if (note) {
      item.visit.accessNote = note;
      warnings.push('地点提醒已放入该地点的开放说明，没有逐句猜测类别。');
    }
  }
  return {
    ok: 'story',
    warnings,
    value: {
      schemaVersion: '1.1',
      adventure: {
        title: placeholder(field.title) ? '未命名冒险' : field.title.trim(),
        subtitle: '',
        destination: placeholder(field.destination)
          ? ''
          : field.destination.trim(),
        startDate: dates.startDate,
        endDate: dates.endDate,
        timeZone: null,
        gameStyle: [],
        premise: placeholder(field.premise) ? '' : field.premise.trim(),
        mainMystery: placeholder(field.mystery) ? '' : field.mystery.trim(),
        finalGoal: placeholder(field.goal) ? '' : field.goal.trim(),
        endingTitle: ending ? '故事结局' : '',
        endingText: ending,
        practicalNotes,
        verificationNotes: sourcePack.verificationNotes,
        sources: sourcePack.sources.map((source, index) => ({
          id: `source_${String(index + 1).padStart(3, '0')}`,
          ...source,
        })),
      },
      chapters: [
        {
          id: 'chapter_001',
          order: 1,
          title: '本次冒险',
          area: '本次冒险',
          intro: '',
          questIds: tripQuests.map((item) => item.id),
        },
      ],
      quests: tripQuests,
      clues,
      npcs: [],
    },
  };
}

function storyChunks(text: string): string[] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const chunks: string[][] = [];
  let current: string[] | null = null;
  for (const line of lines) {
    if (headingText(line) === '旅章') {
      if (current) chunks.push(current);
      current = [line];
      continue;
    }
    if (!current) current = [];
    current.push(line);
  }
  if (current) chunks.push(current);
  const stories = chunks
    .map((chunk) => chunk.join('\n').trim())
    .filter((chunk) => matchQuest(chunk) || /(?:^|\n)\s*(?:【\s*地点|地点\s*\d|[|｜])/u.test(chunk));
  return stories.length ? stories : [text];
}

export function looksLikeStoryText(text: string): boolean {
  if (/"format"\s*:\s*"RPG_TRIP_SAVE"/.test(text)) return false;
  const sample = text.replace(/^\uFEFF/, '').trim().slice(0, 200);
  if (/^(?:<RPG_TRIP_V1>\s*)?[[{]/.test(sample) && /"quests"\s*:/.test(text))
    return false;
  return /(?:^|\n)\s*(?:【\s*地点|#{1,6}\s*地点|QUEST\s+\d+|【\s*旅章\s*】|旅章\s*$)/i.test(
    text.replace(/^\uFEFF/, ''),
  );
}

export function parseStoryText(raw: string): TextParse {
  const text = raw.replace(/^\uFEFF/, '').trim();
  const fenced = text.match(/^```[^\n]*\n([\s\S]*?)\n```$/);
  const body = (fenced ? fenced[1] : text).trim();
  if (!body) return fail('请先粘贴 AI 的完整回答。');
  const chunks = storyChunks(body).filter((chunk) => looksLikeStoryText(chunk) || matchQuest(chunk));
  const parsed = (chunks.length ? chunks : [body]).map((chunk) => ({
    chunk,
    result: parseBlock(chunk),
  }));
  const stories = parsed.filter(
    (item): item is { chunk: string; result: Extract<TextParse, { ok: 'story' }> } =>
      item.result.ok === 'story',
  );
  if (!stories.length) return parsed[0]?.result ?? fail('没有识别到地点。');
  if (stories.length === 1) return stories[0].result;
  const unique: typeof stories = [];
  for (const story of stories) {
    if (
      !unique.some(
        (item) => JSON.stringify(item.result.value) === JSON.stringify(story.result.value),
      )
    )
      unique.push(story);
  }
  if (unique.length === 1) return unique[0].result;
  return {
    ok: 'choices',
    candidates: unique.map((story, index) => {
      const value = story.result.value as {
        adventure?: { title?: string };
      };
      return {
        title: value.adventure?.title || `第 ${index + 1} 份故事`,
        raw: story.chunk,
      };
    }),
  };
}
