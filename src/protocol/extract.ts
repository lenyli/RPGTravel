import type { Issue } from './validate';

export const MAX_REPLY_BYTES = 2 * 1024 * 1024;
export const MAX_ENVELOPE_BYTES = 20 * 1024 * 1024;
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
  | { success: false; errors: Issue[]; candidates?: unknown[] };
const fail = (code: string, message: string): Extraction => ({
  success: false,
  errors: [{ code, path: '$', message }],
});

// Read complete top-level containers without treating markers or braces inside
// JSON strings as reply delimiters. Never repair truncated or malformed JSON.
function scanJsonContainers(text: string): {
  values: unknown[];
  malformed: boolean;
} {
  const values: unknown[] = [];
  let start = -1;
  const closers: string[] = [];
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (start === -1) {
      if (char === '{' || char === '[') {
        start = index;
        closers.push(char === '{' ? '}' : ']');
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
    else if (char === '{' || char === '[')
      closers.push(char === '{' ? '}' : ']');
    else if (char === '}' || char === ']') {
      if (char !== closers.pop()) return { values, malformed: true };
      if (closers.length) continue;
      const candidate = text.slice(start, index + 1);
      try {
        values.push(JSON.parse(candidate));
      } catch {
        // Ordinary prose such as [说明] is not a JSON candidate. A JSON-like
        // fragment that fails parsing must not be silently dropped.
        if (
          (candidate.startsWith('{') &&
            /[":“”'}]/.test(candidate.slice(1, -1))) ||
          /^\[\s*(?:[[{"\d\]\-]|true|false|null)/.test(candidate)
        )
          return { values, malformed: true };
      }
      start = -1;
    }
  }
  return { values, malformed: start !== -1 };
}

function hasPackageFields(value: unknown): boolean {
  const pending = [value];
  while (pending.length) {
    const current = pending.pop();
    if (!current || typeof current !== 'object') continue;
    if (Array.isArray(current)) {
      for (const child of current) pending.push(child);
    } else if (
      ['adventure', 'quests', 'chapters', 'adventureData'].some((key) =>
        Object.hasOwn(current, key),
      ) ||
      (current as Record<string, unknown>).format === 'RPG_TRIP_SAVE'
    )
      return true;
  }
  return false;
}

function isBackupEnvelope(value: unknown): boolean {
  return (
    !!value &&
    typeof value === 'object' &&
    Object.hasOwn(value, 'format') &&
    (value as Record<string, unknown>).format === 'RPG_TRIP_SAVE'
  );
}

// Object key order and formatting do not make a second copy a different story.
function sameJson(left: unknown, right: unknown): boolean {
  const pending: [unknown, unknown][] = [[left, right]];
  while (pending.length) {
    const [a, b] = pending.pop()!;
    if (a === b) continue;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object')
      return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    const keys = Object.keys(a);
    if (keys.length !== Object.keys(b).length) return false;
    for (const key of keys) {
      if (!Object.hasOwn(b, key)) return false;
      pending.push([
        (a as Record<string, unknown>)[key],
        (b as Record<string, unknown>)[key],
      ]);
    }
  }
  return true;
}

export function extractReply(raw: string): Extraction {
  const bytes = new TextEncoder().encode(raw).length;
  if (bytes > MAX_ENVELOPE_BYTES)
    return fail(
      'INPUT_TOO_LARGE',
      '内容超过 20 MiB 存档上限，请只导入一份故事或存档。AI 原始回复仍限 2 MiB。',
    );
  const warnings: string[] = [];
  const withoutBom = raw.replace(/^(\s*)\uFEFF/, '$1');
  if (withoutBom !== raw) warnings.push('已移除开头的 BOM。');
  const content = withoutBom.trim();
  if (content !== withoutBom) warnings.push('已移除内容最外层的空白。');
  if (!content)
    return fail('EMPTY_REPLY', '请先粘贴 AI 的完整回答或存档内容。');

  let value: unknown;
  try {
    // The normal protocol envelope is not a warning. Parse its entire body;
    // repeated or mixed wrappers fall back to complete-container extraction.
    value = JSON.parse(
      content.startsWith('<RPG_TRIP_V1>') && content.endsWith('</RPG_TRIP_V1>')
        ? content.slice('<RPG_TRIP_V1>'.length, -'</RPG_TRIP_V1>'.length)
        : content,
    );
  } catch {
    const scanned = scanJsonContainers(content);
    if (scanned.malformed || scanned.values.length === 0) {
      if (bytes > MAX_REPLY_BYTES)
        return fail(
          'REPLY_TOO_LARGE',
          'AI 原始回复超过 2 MiB 上限，不能截断后导入。',
        );
      return fail(
        'INVALID_JSON',
        'JSON 无法解析，可能被截断或含非法标点。请复制修复提示，让 AI 返回完整包。',
      );
    }
    const packages = scanned.values.filter(hasPackageFields);
    const candidates = packages.length ? packages : scanned.values;
    if (bytes > MAX_REPLY_BYTES && !candidates.every(isBackupEnvelope))
      return fail(
        'REPLY_TOO_LARGE',
        'AI 原始回复超过 2 MiB 上限（包括外层说明文字），不能截断后导入。',
      );
    for (const candidate of candidates) {
      const unsafe = unsafeStructureIssue(candidate);
      if (unsafe) return { success: false, errors: [unsafe] };
    }
    const unique: unknown[] = [];
    for (const candidate of candidates)
      if (!unique.some((existing) => sameJson(existing, candidate)))
        unique.push(candidate);
    if (unique.length > 1)
      return {
        success: false,
        errors: [
          {
            code: 'MULTIPLE_PACKAGES',
            path: '$',
            message:
              '这份回答包含内容不同的多个故事或存档，请选择要导入的那一份；无需让 AI 再改写故事。',
          },
        ],
        candidates: unique,
      };
    value = unique[0];
    warnings.push('已忽略 JSON 对象外的标记、围栏或说明文字。');
    if (packages.length && packages.length < scanned.values.length)
      warnings.push('已忽略故事数据之外的 JSON 示例。');
    if (candidates.length > 1)
      warnings.push('已合并内容相同的重复故事或存档，保留一份完整数据。');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return fail('INVALID_ROOT', '冒险或存档必须是一个完整 JSON 对象。');
  if (!isBackupEnvelope(value) && bytes > MAX_REPLY_BYTES)
    return fail(
      'REPLY_TOO_LARGE',
      'AI 原始回复超过 2 MiB 上限（包括外层说明文字），不能截断后导入。',
    );
  const unsafe = unsafeStructureIssue(value);
  if (unsafe) return { success: false, errors: [unsafe] };
  return { success: true, value, warnings };
}
