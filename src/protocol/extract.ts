import type { Issue } from './validate';

export const MAX_REPLY_BYTES = 2 * 1024 * 1024;
export const MAX_ENVELOPE_BYTES = 4 * 1024 * 1024;
const forbiddenKeys = new Set(['__proto__', 'prototype', 'constructor']);
export const isReservedId = (id: string): boolean => forbiddenKeys.has(id);

export function unsafeStructureIssue(value: unknown): Issue | null {
  const pending: { value: unknown; path: string }[] = [{ value, path: '$' }];
  const seen = new Set<object>();
  let nodes = 0;
  while (pending.length) {
    const current = pending.pop()!;
    if (!current.value || typeof current.value !== 'object') continue;
    if (seen.has(current.value))
      return {
        code: 'INVALID_STRUCTURE',
        path: current.path,
        message: '输入包含循环或重复对象引用，请使用完整 JSON 数据。',
      };
    seen.add(current.value);
    if (++nodes > 20_000)
      return {
        code: 'INPUT_TOO_COMPLEX',
        path: '$',
        message: '输入层级或对象数量过多，请只保留一份冒险数据。',
      };
    for (const key of Object.keys(current.value)) {
      const path = Array.isArray(current.value)
        ? `${current.path}[${key}]`
        : `${current.path}.${key}`;
      if (forbiddenKeys.has(key))
        return {
          code: 'UNSAFE_KEY',
          path,
          message: `不允许使用对象键“${key}”，请让 AI 按协议重新输出。`,
        };
      pending.push({
        value: (current.value as Record<string, unknown>)[key],
        path,
      });
    }
  }
  return null;
}

type Extraction =
  | { success: true; value: unknown; warnings: string[] }
  | { success: false; errors: Issue[] };
const fail = (code: string, message: string): Extraction => ({
  success: false,
  errors: [{ code, path: '$', message }],
});

// This scanner only identifies ambiguous extra objects. It never rescues or
// selects a substring for import; accepted candidates still use JSON.parse.
function countJsonObjects(text: string): number {
  let count = 0;
  let start = -1;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (start === -1) {
      if (char === '{') {
        start = index;
        depth = 1;
      }
      continue;
    }
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) {
      try {
        JSON.parse(text.slice(start, index + 1));
        count++;
      } catch {
        /* Invalid prose is not another JSON candidate. */
      }
      start = -1;
      if (count > 1) return count;
    }
  }
  return count;
}

export function extractReply(raw: string): Extraction {
  const bytes = new TextEncoder().encode(raw).length;
  if (bytes > MAX_ENVELOPE_BYTES)
    return fail(
      'INPUT_TOO_LARGE',
      '内容超过 4 MiB 绝对上限，请只导入一份故事或存档。',
    );
  const warnings: string[] = [];
  const withoutBom = raw.replace(/^(\s*)\uFEFF/, '$1');
  if (withoutBom !== raw) warnings.push('已移除开头的 BOM。');
  const content = withoutBom.trim();
  if (content !== withoutBom) warnings.push('已移除内容最外层的空白。');
  if (!content)
    return fail('EMPTY_REPLY', '请先粘贴 AI 的完整回答或存档内容。');

  let candidate = content;
  if (content.includes('<RPG_TRIP') || content.includes('</RPG_TRIP')) {
    const markers = [...content.matchAll(/<\/?RPG_TRIP[^>]*>/g)];
    if (
      markers.some(
        ([tag]) => tag !== '<RPG_TRIP_V1>' && tag !== '</RPG_TRIP_V1>',
      )
    )
      return fail(
        'UNSUPPORTED_PROTOCOL',
        '这份回复使用了不支持的 RPG_TRIP 协议版本；当前只支持 V1。',
      );
    const starts = markers.filter(([tag]) => tag === '<RPG_TRIP_V1>');
    const ends = markers.filter(([tag]) => tag === '</RPG_TRIP_V1>');
    if (starts.length > 1 || ends.length > 1)
      return fail(
        'MULTIPLE_PACKAGES',
        '发现多个冒险包，请只保留一份完整回答后重试。',
      );
    if (starts.length === 1 && ends.length === 0)
      return fail(
        'INCOMPLETE_REPLY',
        '这份回复缺少结尾，可能复制不完整。请重新复制完整回复。',
      );
    if (
      starts.length !== 1 ||
      ends.length !== 1 ||
      starts[0].index! >= ends[0].index!
    )
      return fail(
        'INVALID_MARKERS',
        '协议标记缺失、顺序错误或不完整，请复制从开始到结尾的完整回答。',
      );
    const start = starts[0].index!;
    const end = ends[0].index!;
    candidate = content.slice(start + '<RPG_TRIP_V1>'.length, end).trim();
    const outside =
      content.slice(0, start) + content.slice(end + '</RPG_TRIP_V1>'.length);
    if (countJsonObjects(outside) > 0)
      return fail(
        'MULTIPLE_PACKAGES',
        '协议标记外还有另一份 JSON 候选内容，请只保留一份冒险包。',
      );
    if (outside.trim()) warnings.push('已忽略协议标记外的说明文字。');
  } else if (!content.startsWith('{')) {
    const fences = [
      ...content.matchAll(/```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n?[ \t]*```/gi),
    ];
    const fenceCount = (content.match(/```/g) ?? []).length;
    if (fences.length > 1 || fenceCount > 2)
      return fail(
        'MULTIPLE_PACKAGES',
        '发现多个代码围栏或候选包，请只保留一份 JSON 冒险包。',
      );
    if (fences.length === 1 && fenceCount === 2) {
      candidate = fences[0][1].trim();
      const outside =
        content.slice(0, fences[0].index!) +
        content.slice(fences[0].index! + fences[0][0].length);
      if (countJsonObjects(outside) > 0)
        return fail(
          'MULTIPLE_PACKAGES',
          '代码围栏外还有另一份 JSON 候选内容，请只保留一份冒险包。',
        );
      warnings.push('已提取唯一代码围栏中的 JSON。');
    } else if (fenceCount) {
      return fail(
        'INCOMPLETE_REPLY',
        '代码围栏不完整或不是 JSON，请重新复制完整回答。',
      );
    }
  }

  let value: unknown;
  try {
    value = JSON.parse(candidate);
  } catch {
    if (bytes > MAX_REPLY_BYTES)
      return fail(
        'REPLY_TOO_LARGE',
        'AI 原始回复超过 2 MiB 上限，不能截断后导入。',
      );
    if (countJsonObjects(candidate) > 1)
      return fail(
        'MULTIPLE_PACKAGES',
        '发现多个 JSON 候选包，请只保留一份完整冒险包。',
      );
    return fail(
      'INVALID_JSON',
      'JSON 无法解析，可能被截断或含非法标点。请复制修复提示，让 AI 返回完整包。',
    );
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return fail('INVALID_ROOT', '冒险或存档必须是一个完整 JSON 对象。');
  const isBackup =
    Object.hasOwn(value, 'format') &&
    (value as Record<string, unknown>).format === 'RPG_TRIP_SAVE';
  if (!isBackup && bytes > MAX_REPLY_BYTES)
    return fail(
      'REPLY_TOO_LARGE',
      'AI 原始回复超过 2 MiB 上限（包括外层说明文字），不能截断后导入。',
    );
  const unsafe = unsafeStructureIssue(value);
  if (unsafe) return { success: false, errors: [unsafe] };
  return { success: true, value, warnings };
}
