import { z } from 'zod';

// Keep this schema structural: the same object validates imports and is sent to AI.
const id = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,63}$/)
  .describe('全冒险唯一的小写字母、数字及下划线 ID');
const title = z
  .string()
  .min(1)
  .max(160)
  .regex(/\S/)
  .describe('非空标题，最多 160 字符');
const text = z
  .string()
  .min(1)
  .max(20_000)
  .regex(/\S/)
  .describe('完整非空文本，最多 20000 字符');
const optionalText = z.string().max(20_000);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe('目的地本地日历日期 YYYY-MM-DD');
const references = (max: number) => z.array(id).max(max);

export const sourceSchema = z.strictObject({
  id,
  title,
  url: z
    .string()
    .min(1)
    .max(2048)
    .regex(/^https?:\/\/[^\s]+$/)
    .describe('实际查阅的 http/https 来源页面'),
  checkedOn: date.describe('生成 AI 实际查阅的日期，不是提示生成日期'),
});

export const adventureSchema = z.strictObject({
  id,
  title,
  subtitle: z.string().max(160),
  destination: title.describe('目的地和明确游览范围'),
  startDate: date,
  endDate: date,
  timeZone: z
    .string()
    .min(1)
    .max(100)
    .nullable()
    .describe('目的地 IANA 时区；不确定为 null'),
  gameStyle: z.array(title).max(20),
  premise: text.describe('不泄露最终答案的故事开场'),
  mainMystery: text.describe('贯穿旅程的主要疑问'),
  finalGoal: text,
  endingTitle: title,
  endingText: text.describe(
    '所有地点完成或跳过后展示的完整结局，与访问顺序无关',
  ),
  practicalNotes: z.array(text).max(100),
  verificationNotes: z
    .array(text)
    .max(100)
    .describe('未能核验的真实出行信息及限制'),
  sources: z.array(sourceSchema).max(100),
});

export const chapterSchema = z.strictObject({
  id,
  order: z.number().int().min(1).max(60),
  title,
  area: title.describe('按地点区域分组，不是固定日程'),
  intro: text,
  questIds: references(60)
    .min(1)
    .describe('本区域任务的展示顺序，不限制到访顺序'),
});

export const questSchema = z.strictObject({
  id,
  chapterId: id,
  order: z
    .number()
    .int()
    .min(1)
    .max(60)
    .describe('全旅程连续展示序号 1..N，不是完成依赖'),
  title,
  location: z.strictObject({
    name: title,
    address: text.describe('游客可辨认的完整真实地点范围，不编造门牌'),
    query: z
      .string()
      .min(1)
      .max(1000)
      .regex(/\S/)
      .describe('地点名称加地区的地图搜索词'),
    latitude: z.number().min(-90).max(90).nullable(),
    longitude: z.number().min(-180).max(180).nullable(),
    coordinateSystem: z.literal('WGS84'),
    coordinateSourceId: id
      .nullable()
      .describe('可靠 WGS84 坐标来源 ID，无坐标时为 null'),
  }),
  visit: z.strictObject({
    recommendedDate: date
      .nullable()
      .describe('可选出行提示日期，不构成任务门禁；没有明确需要时为 null'),
    recommendedTime: title
      .nullable()
      .describe('建议时段，不保证实际开放；未知为 null'),
    estimatedMinutes: z.number().int().min(1).max(720),
    transportNote: optionalText,
    accessNote: optionalText.describe(
      '开放、预约、门票；无法确认时明确写待核验',
    ),
    safetyNote: optionalText,
    fallbackText: text.describe(
      '跳过现场行动时仍可推进的剧情补叙，不冒称已完成',
    ),
  }),
  story: z.strictObject({
    scene: text.describe(
      '本地点独立调查所需的完整情景与背景，不预设访问过其他地点',
    ),
    currentMystery: text,
  }),
  npcIds: references(60),
  objectives: z.array(z.strictObject({ id, text })).min(3).max(5),
  completionText: text,
  rewardClueIds: references(3).min(1),
  sourceIds: references(100),
});

export const clueSchema = z.strictObject({
  id,
  title,
  content: text,
  sourceQuestId: id,
});
export const npcSchema = z.strictObject({
  id,
  name: title,
  role: title,
  description: text,
  motivation: text.describe('故事设计内部动机，不在初见时剧透'),
  fictional: z.literal(true),
});

export const tripSchema = z.strictObject({
  schemaVersion: z.literal('1.1'),
  adventure: adventureSchema,
  chapters: z.array(chapterSchema).min(1).max(60),
  quests: z.array(questSchema).min(1).max(60),
  clues: z.array(clueSchema).min(1).max(180),
  npcs: z.array(npcSchema).max(60),
});

export type RPGTrip = z.infer<typeof tripSchema>;
export type Adventure = z.infer<typeof adventureSchema>;
export type Quest = z.infer<typeof questSchema>;
export type Chapter = z.infer<typeof chapterSchema>;
export type Clue = z.infer<typeof clueSchema>;
export type NPC = z.infer<typeof npcSchema>;
export type Source = z.infer<typeof sourceSchema>;

export const tripJsonSchema = z.toJSONSchema(tripSchema, {
  target: 'draft-2020-12',
});
