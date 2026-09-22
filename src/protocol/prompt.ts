import type { RPGTrip } from './schema';
import { isCalendarDate, type Issue } from './validate';

export type TripInput = {
  destination: string;
  startDate: string;
  endDate: string;
  gameStyle: string;
  interests: string;
  constraints: string;
};

export const STORY_TEMPLATE = `【旅章】
标题：冒险标题
目的地：真实游览范围
日期：开始日期 ～ 结束日期
开场：不剧透的共同开场
谜团：正在调查的问题
目标：本次调查的目标

【地点1｜任务名称】
导航：真实地点名称＋城市或区域
用时：约45分钟；无法估计可省略
剧情：本地点可独立理解的情景与人物对白
行动：
- 一个实际可执行的行动
- 另一个实际可执行的行动
线索：完成后揭示的发现
跳过：无法到访时的剧情补叙
提醒：开放、交通、安全或待核验事项；没有可省略

【结局】
让各处线索汇合，回应共同谜团，不预设访问顺序或实际看到了特定景观。
【实用提醒】
必要的整体出行提醒；没有可省略。
【来源】
实际查阅的来源标题、网址与查阅日期；未联网则说明未联网，不编造来源。
【结束】`;

const RULES = `要求：
1. 有共同谜团、地点调查、线索和明确结局。每个地点都能独立开始，访问顺序可变，不依赖前置任务或固定日程。
2. 地点必须真实，尊重已填住宿、预约、体力、必去及不去地点。范围太大时缩小主题，不为了数量塞满行程。未填游戏风格就不预设参考游戏。
3. 行动以观察、空间探索、摄影或当地体验为主，不写分析题，不反复“寻找某物”。默认每处2–4项，不强制消费、拍陌生人或打扰工作人员。
4. NPC、信件和对白只存在于App故事里，不承诺现场有人配合。真实历史、传说与虚构分清；未核实的铭文、展品和自然现象不能成为必需条件。
5. 能联网则查易变的开放、预约、交通信息并列实际来源；不能确认就写待核验，不猜坐标、地址或精确交通时间。遵守现场安全及禁拍规定。
6. 跳过或关闭时用明确的剧情补叙继续，不假称玩家已到访。所有线索与结局放在下面正文内，不另写一份重复攻略。
7. 按可用时间设计适量地点，默认3–6处、全文约1500–3000字；这不是硬性数量，用户明确要求的地点不能为了限字删除。少而完整，不用省略号代替内容。

只按下面的短标签模板输出中文正文，不输出JSON、Schema、ID或字段说明。每处重复一个“地点”块；标签独占行或位于行首，内容可以换行。来源和提醒没有内容可省略。`;

function specified(value: string): string {
  return value.trim() ? value : '未指定';
}

export function createGenerationPrompt(input: TripInput): string {
  return [
    '请根据以下需求，设计一场在真实地点亲身游玩的 RPG 故事，不是景点打卡清单。',
    '',
    `目的地：${input.destination}`,
    `日期：${input.startDate} ～ ${input.endDate}`,
    `游戏风格：${specified(input.gameStyle)}`,
    `兴趣：${specified(input.interests)}`,
    `旅行限制：${specified(input.constraints)}`,
    '',
    RULES,
    '',
    STORY_TEMPLATE,
  ].join('\n');
}

function issueSummary(errors: Issue[]): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const error of errors) {
    const line = error.message.replace(/\s+/g, ' ').trim();
    if (!line || seen.has(line)) continue;
    seen.add(line);
    lines.push(line);
    if (lines.length === 5) break;
  }
  return lines;
}

function isPrivateBackup(raw: string): boolean {
  return raw.includes('"RPG_TRIP_SAVE"') || raw.includes('data:image/');
}

export function createRepairPrompt(
  raw: string,
  errors: Issue[],
  originalInput?: TripInput,
  options?: { includeOriginal?: boolean },
): string {
  const issues = issueSummary(errors);
  const parts = [
    '请把你上一条旅章故事整理成下面的短标签正文，保留原目的地、日期、地点、行动、线索和结局，不新增路线、不重复输出JSON。',
    `需要检查：${issues.length ? issues.join('；') : '格式未能导入。'}`,
    '只修格式；确实缺失的剧情不能假称原文已有。原会话找不到原文时请说明，不凭空另写一趟旅行。',
    '每个地点独立可玩，NPC只存在于App故事中。',
    STORY_TEMPLATE,
  ];
  if (originalInput) {
    parts.push(
      `关联的旅行需求仅作背景：目的地 ${originalInput.destination || '未指定'}；日期 ${originalInput.startDate || '未指定'} ～ ${originalInput.endDate || '未指定'}。不要改用另一份表单。`,
    );
  }
  if (options?.includeOriginal) {
    if (isPrivateBackup(raw)) {
      parts.push(
        '识别到私人备份。不要把照片、进度或日志放进修复内容，请在本机用原文件恢复。',
      );
    } else if (new TextEncoder().encode(raw).length > 100_000) {
      parts.push(
        '原文较长。请回到原会话修复，或自行附上完整原文；这里不截断、也不另写一趟旅行。',
      );
    } else {
      parts.push('【待整理的原文】', raw);
    }
  }
  return parts.join('\n\n');
}

export function applyRequestSnapshot(trip: RPGTrip, snapshot: TripInput): RPGTrip {
  const next = structuredClone(trip);
  if (
    (!next.adventure.destination || next.adventure.destination === '未提供目的地') &&
    snapshot.destination.trim()
  )
    next.adventure.destination = snapshot.destination.trim();
  if (!next.adventure.startDate && isCalendarDate(snapshot.startDate))
    next.adventure.startDate = snapshot.startDate;
  if (!next.adventure.endDate && isCalendarDate(snapshot.endDate))
    next.adventure.endDate = snapshot.endDate;
  if (
    next.adventure.startDate &&
    next.adventure.endDate &&
    next.adventure.endDate < next.adventure.startDate
  )
    next.adventure.endDate = null;
  return next;
}

export function repairPromptFixedLength(): number {
  return createRepairPrompt('', []).length;
}

export function validateTripInput(input: TripInput): Issue[] {
  const errors: Issue[] = [];
  const add = (path: keyof TripInput, message: string) =>
    errors.push({ code: 'INVALID_INPUT', path: `$.${path}`, message });
  if (!input.destination.trim())
    add('destination', '请填写目的地或明确游览范围。');
  for (const field of ['startDate', 'endDate'] as const) {
    if (!isCalendarDate(input[field]))
      add(
        field,
        `请填写有效的${field === 'startDate' ? '开始' : '结束'}日期。`,
      );
  }
  if (
    isCalendarDate(input.startDate) &&
    isCalendarDate(input.endDate) &&
    input.endDate < input.startDate
  )
    add('endDate', '结束日期不能早于开始日期。');
  for (const field of [
    'destination',
    'gameStyle',
    'interests',
    'constraints',
  ] as const) {
    const limit = field === 'constraints' ? 20_000 : 1000;
    if (input[field].length > limit)
      add(field, `这项输入超过 ${limit} 字符，请缩短后复制 Prompt。`);
  }
  return errors;
}
