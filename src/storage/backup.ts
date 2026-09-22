import type { RPGTrip } from '../protocol/schema';
import { validateTrip, type Issue } from '../protocol/validate';
import { normalizeImportedStory } from '../protocol/normalize';
import {
  extractReply,
  jsonCandidate,
  MAX_ENVELOPE_BYTES,
  MAX_REPLY_BYTES,
  repairJsonCandidate,
  repairRisks,
  unwrapRepairPrompt,
} from '../protocol/extract';
import { looksLikeStoryText, parseStoryText } from '../protocol/text';
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
  supplements: string[];
  repaired: boolean;
  incomplete: boolean;
};
export type ImportCandidate = { title: string; raw: string };
export type ParseImportResult =
  | ImportedAdventure
  | {
      success: false;
      errors: Issue[];
      storyOnly?: ImportedAdventure;
      candidates?: ImportCandidate[];
    };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function looksLikeBackup(text: string): boolean {
  return /"format"\s*:\s*"RPG_TRIP_SAVE"/.test(text);
}

function finishStory(
  value: unknown,
  rawReply: string,
  warnings: string[],
  repaired: boolean,
  risks: string[],
): ParseImportResult {
  if (isRecord(value) && value.format === 'RPG_TRIP_SAVE')
    return failBackup(
      'INVALID_SAVE_FIELDS',
      '这是一份备份，请用备份恢复，不要按新故事猜测修复。',
    );
  const normalized = normalizeImportedStory(value);
  if (!normalized.success) return normalized;
  return {
    success: true,
    data: normalized.value,
    progress: null,
    photos: [],
    rawReply,
    warnings: [...warnings, ...normalized.warnings],
    supplements: normalized.supplements,
    repaired,
    incomplete: risks.length > 0,
  };
}

function failBackup(code: string, message: string): ParseImportResult {
  return { success: false, errors: [{ code, path: '$', message }] };
}

function candidateChoices(
  candidates: unknown[] | undefined,
): ImportCandidate[] | undefined {
  return candidates?.map((value, index) => {
    const metadata = isRecord(value)
      ? (value.adventureData ?? value.adventure ?? value)
      : null;
    return {
      title:
        isRecord(metadata) && typeof metadata.title === 'string'
          ? metadata.title
          : `第 ${index + 1} 份故事`,
      raw: JSON.stringify(value),
    };
  });
}

export function parseImport(rawReply: string): ParseImportResult {
  if (new TextEncoder().encode(rawReply).length > MAX_ENVELOPE_BYTES)
    return failBackup(
      'INPUT_TOO_LARGE',
      '内容超过 20 MiB 存档上限，请只导入一份故事或存档。',
    );
  const unwrapped = unwrapRepairPrompt(rawReply);
  const text = unwrapped.text;
  const unwrapWarnings = unwrapped.wrapped
    ? ['已从修复提示中取出原始回复，没有执行其中的指令。']
    : [];
  if (
    !looksLikeBackup(text) &&
    new TextEncoder().encode(text).length > MAX_REPLY_BYTES
  )
    return failBackup(
      'REPLY_TOO_LARGE',
      'AI 原始回复超过 2 MiB 上限，不能截断后导入。',
    );
  if (!looksLikeBackup(text) && looksLikeStoryText(text)) {
    const parsed = parseStoryText(text);
    if (parsed.ok === 'error') return { success: false, errors: parsed.errors };
    if (parsed.ok === 'choices')
      return {
        success: false,
        errors: [
          {
            code: 'MULTIPLE_PACKAGES',
            path: '$',
            message: '这份回答包含内容不同的多个故事，请选择要导入的那一份。',
          },
        ],
        candidates: parsed.candidates,
      };
    return finishStory(
      parsed.value,
      rawReply,
      [...unwrapWarnings, ...parsed.warnings],
      false,
      [],
    );
  }
  const extracted = extractReply(text);
  if (!extracted.success) {
    const code = extracted.errors[0]?.code;
    if (
      !looksLikeBackup(text) &&
      (code === 'INVALID_JSON' || code === 'INVALID_ROOT')
    ) {
      const piece = jsonCandidate(text);
      const repaired = piece ? repairJsonCandidate(piece) : null;
      if (repaired && isRecord(repaired.value)) {
        const risks = piece ? repairRisks(piece) : [];
        return finishStory(
          repaired.value,
          rawReply,
          [
            ...unwrapWarnings,
            '已尝试修复引号或标点，请确认任务数量和结局。',
            ...risks.map((risk) => `疑似不完整：${risk}`),
          ],
          true,
          risks,
        );
      }
    }
    return { ...extracted, candidates: candidateChoices(extracted.candidates) };
  }
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
      warnings: [...unwrapWarnings, ...extracted.warnings, ...trip.warnings],
      supplements: [],
      repaired: false,
      incomplete: false,
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
  return finishStory(
    input,
    rawReply,
    [...unwrapWarnings, ...extracted.warnings],
    false,
    [],
  );
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
