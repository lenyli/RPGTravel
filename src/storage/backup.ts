import type { RPGTrip } from '../protocol/schema';
import { validateTrip, type Issue } from '../protocol/validate';
import { extractReply } from '../protocol/extract';
import {
  isIsoInstant,
  validateProgress,
  type Progress,
} from '../domain/progress';

export type SaveFile = {
  format: 'RPG_TRIP_SAVE';
  saveVersion: 1;
  exportedAt: string;
  adventureData: RPGTrip;
  progress: Progress | null;
};
export type ImportedAdventure = {
  success: true;
  data: RPGTrip;
  progress: Progress | null;
  rawReply: string;
  warnings: string[];
};
export type ParseImportResult =
  | ImportedAdventure
  | { success: false; errors: Issue[]; storyOnly?: ImportedAdventure };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function parseImport(rawReply: string): ParseImportResult {
  const extracted = extractReply(rawReply);
  if (!extracted.success) return extracted;
  const input = extracted.value;
  if (isRecord(input) && input.format === 'RPG_TRIP_SAVE') {
    const keys = [
      'format',
      'saveVersion',
      'exportedAt',
      'adventureData',
      'progress',
    ];
    if (
      Object.keys(input).length !== keys.length ||
      !keys.every((key) => Object.hasOwn(input, key))
    )
      return {
        success: false,
        errors: [
          {
            code: 'INVALID_SAVE_FIELDS',
            path: '$',
            message: '备份文件字段缺失或包含未知字段。',
          },
        ],
      };
    if (input.saveVersion !== 1)
      return {
        success: false,
        errors: [
          {
            code: 'UNSUPPORTED_SAVE_VERSION',
            path: '$.saveVersion',
            message: '暂不支持这个备份版本，请使用生成该存档的应用版本。',
          },
        ],
      };
    if (!isIsoInstant(input.exportedAt))
      return {
        success: false,
        errors: [
          {
            code: 'INVALID_SAVE_TIME',
            path: '$.exportedAt',
            message: '备份导出时间不是有效的 ISO 时间。',
          },
        ],
      };
    const trip = validateTrip(input.adventureData);
    if (!trip.success) return trip;
    // Original reply is deliberately not carried in an exported envelope.
    const storyOnly: ImportedAdventure = {
      success: true,
      data: trip.data,
      progress: null,
      rawReply,
      warnings: [...extracted.warnings, ...trip.warnings],
    };
    if (input.progress === null) return storyOnly;
    const progress = validateProgress(trip.data, input.progress);
    if (!progress.success)
      return {
        success: false,
        errors: progress.errors,
        storyOnly: {
          ...storyOnly,
          warnings: [
            ...storyOnly.warnings,
            '原备份进度无效；仅在你明确确认后导入故事并重新开始。',
          ],
        },
      };
    return { ...storyOnly, progress: progress.data };
  }
  const trip = validateTrip(input);
  if (!trip.success) return trip;
  return {
    success: true,
    data: trip.data,
    progress: null,
    rawReply,
    warnings: [...extracted.warnings, ...trip.warnings],
  };
}

export function createSave(
  data: RPGTrip,
  progress: Progress | null,
  now = new Date().toISOString(),
): SaveFile {
  if (!isIsoInstant(now)) throw new Error('导出时间无效，请检查设备时间。');
  const trip = validateTrip(data);
  if (!trip.success)
    throw new Error(`故事数据未通过导出检查：${trip.errors[0].message}`);
  const checked =
    progress === null ? null : validateProgress(trip.data, progress);
  if (checked && !checked.success)
    throw new Error(`进度未通过导出检查：${checked.errors[0].message}`);
  return {
    format: 'RPG_TRIP_SAVE',
    saveVersion: 1,
    exportedAt: now,
    adventureData: trip.data,
    progress: checked?.success ? checked.data : null,
  };
}

export function saveFilename(
  data: RPGTrip,
  now = new Date().toISOString(),
): string {
  const title =
    data.adventure.title
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
      .trim()
      .slice(0, 100) || '冒险';
  return `${title}_存档_${now.slice(0, 10)}.rpgtrip.json`;
}
