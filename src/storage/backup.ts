import type { RPGTrip } from '../protocol/schema';
import { validateTrip, type Issue } from '../protocol/validate';
import { extractReply, MAX_ENVELOPE_BYTES } from '../protocol/extract';
import { validatePhotos, type PhotoAttachment } from '../domain/photos';
import {
  isIsoInstant,
  validateProgress,
  type Progress,
} from '../domain/progress';

type SaveContents = {
  format: 'RPG_TRIP_SAVE';
  exportedAt: string;
  adventureData: RPGTrip;
  progress: Progress | null;
};
export type SaveFile = SaveContents &
  ({ saveVersion: 1 } | { saveVersion: 2; photos: PhotoAttachment[] });
export type ImportedAdventure = {
  success: true;
  data: RPGTrip;
  progress: Progress | null;
  photos: PhotoAttachment[];
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
    if (input.saveVersion !== 1 && input.saveVersion !== 2)
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
    const keys = [
      'format',
      'saveVersion',
      'exportedAt',
      'adventureData',
      'progress',
      ...(input.saveVersion === 2 ? ['photos'] : []),
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
    // Keep only the story as the import source: attachment base64 already lives
    // in the photos field and must not be duplicated in rawReply on disk.
    const storyOnly: ImportedAdventure = {
      success: true,
      data: trip.data,
      progress: null,
      photos: [],
      rawReply: `<RPG_TRIP_V1>\n${JSON.stringify(trip.data)}\n</RPG_TRIP_V1>`,
      warnings: [...extracted.warnings, ...trip.warnings],
    };
    const progress =
      input.progress === null
        ? null
        : validateProgress(trip.data, input.progress);
    const photos = validatePhotos(
      trip.data,
      input.saveVersion === 2 ? input.photos : [],
    );
    const errors = [
      ...(progress && !progress.success ? progress.errors : []),
      ...(!photos.success ? photos.errors : []),
    ];
    if (input.progress === null && photos.success && photos.data.length > 0)
      errors.push({
        code: 'PHOTOS_WITHOUT_PROGRESS',
        path: '$.photos',
        message: '照片存档缺少对应进度；不能把私人照片混入仅故事分享包。',
      });
    if (errors.length > 0)
      return {
        success: false,
        errors,
        storyOnly: {
          ...storyOnly,
          warnings: [
            ...storyOnly.warnings,
            '原备份进度或照片无效；仅在你明确确认后导入故事并重新开始，不恢复原进度和照片。',
          ],
        },
      };
    return {
      ...storyOnly,
      progress: progress?.success ? progress.data : null,
      photos: photos.success ? photos.data : [],
    };
  }
  const trip = validateTrip(input);
  if (!trip.success) return trip;
  return {
    success: true,
    data: trip.data,
    progress: null,
    photos: [],
    rawReply,
    warnings: [...extracted.warnings, ...trip.warnings],
  };
}

export function createSave(
  data: RPGTrip,
  progress: Progress | null,
  now = new Date().toISOString(),
  photos: PhotoAttachment[] = [],
): SaveFile {
  if (!isIsoInstant(now)) throw new Error('导出时间无效，请检查设备时间。');
  const trip = validateTrip(data);
  if (!trip.success)
    throw new Error(`故事数据未通过导出检查：${trip.errors[0].message}`);
  const checked =
    progress === null ? null : validateProgress(trip.data, progress);
  if (checked && !checked.success)
    throw new Error(`进度未通过导出检查：${checked.errors[0].message}`);
  // Story sharing intentionally excludes every attachment, even if the caller
  // passes the current adventure's photo collection.
  const checkedPhotos = validatePhotos(
    trip.data,
    progress === null ? [] : photos,
  );
  if (!checkedPhotos.success)
    throw new Error(`照片未通过导出检查：${checkedPhotos.errors[0].message}`);
  const contents: Omit<SaveContents, 'format'> = {
    exportedAt: now,
    adventureData: trip.data,
    progress: checked?.success ? checked.data : null,
  };
  const save: SaveFile = checkedPhotos.data.length
    ? {
        format: 'RPG_TRIP_SAVE',
        saveVersion: 2,
        ...contents,
        photos: checkedPhotos.data,
      }
    : { format: 'RPG_TRIP_SAVE', saveVersion: 1, ...contents };
  // The UI exports pretty JSON. Check that exact representation so an export
  // produced here always fits the import envelope limit.
  if (
    new TextEncoder().encode(JSON.stringify(save, null, 2)).length >
    MAX_ENVELOPE_BYTES
  )
    throw new Error(
      '完整存档超过 20 MiB，请先减少照片后重试；现有照片未被删除。',
    );
  return save;
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
