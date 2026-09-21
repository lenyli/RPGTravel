import type { RPGTrip } from '../protocol/schema';
import type { Issue } from '../protocol/validate';
import { isIsoInstant } from './progress';

export type PhotoAttachment = {
  id: string;
  questId: string;
  createdAt: string;
  caption: string;
  width: number;
  height: number;
  dataUrl: string;
};

export const MAX_PHOTOS_PER_QUEST = 6;
export const MAX_PHOTOS_PER_ADVENTURE = 30;
export const MAX_PHOTO_BYTES = 1024 * 1024;
export const MAX_ADVENTURE_PHOTO_BYTES = 12 * 1024 * 1024;
export const MAX_PHOTO_INPUT_BYTES = 20 * 1024 * 1024;
export const MAX_PHOTO_EDGE = 1600;
export const MAX_PHOTO_CAPTION = 500;
const MAX_INPUT_PIXELS = 40_000_000;
const JPEG_PREFIX = 'data:image/jpeg;base64,';
const photoKeys = [
  'id',
  'questId',
  'createdAt',
  'caption',
  'width',
  'height',
  'dataUrl',
];
const safeId = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[a-z][a-z0-9_]{0,63}$/.test(value) &&
  !['__proto__', 'prototype', 'constructor'].includes(value);
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** The compressed JPEG bytes, rather than the larger base64 text size. */
export function photoByteSize(photo: Pick<PhotoAttachment, 'dataUrl'>): number {
  if (
    typeof photo.dataUrl !== 'string' ||
    !photo.dataUrl.startsWith(JPEG_PREFIX)
  )
    return 0;
  const length = photo.dataUrl.length - JPEG_PREFIX.length;
  if (length === 0 || length % 4 !== 0) return 0;
  return (
    (length / 4) * 3 -
    (photo.dataUrl.endsWith('==') ? 2 : photo.dataUrl.endsWith('=') ? 1 : 0)
  );
}

function decodeJpeg(dataUrl: unknown): Uint8Array | null {
  if (
    typeof dataUrl !== 'string' ||
    !dataUrl.startsWith(JPEG_PREFIX) ||
    dataUrl.length > JPEG_PREFIX.length + 4 * Math.ceil(MAX_PHOTO_BYTES / 3)
  )
    return null;
  const size = photoByteSize({ dataUrl });
  if (size < 4 || size > MAX_PHOTO_BYTES) return null;
  const encoded = dataUrl.slice(JPEG_PREFIX.length);
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
  // A loop avoids a large repeated regex group and bounds work before decoding.
  for (let index = 0; index < encoded.length - padding; index++) {
    const code = encoded.charCodeAt(index);
    if (
      !(
        (code >= 65 && code <= 90) ||
        (code >= 97 && code <= 122) ||
        (code >= 48 && code <= 57) ||
        code === 43 ||
        code === 47
      )
    )
      return null;
  }
  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const last = alphabet.indexOf(encoded[encoded.length - padding - 1]);
  if (
    (padding === 2 && (last & 15) !== 0) ||
    (padding === 1 && (last & 3) !== 0)
  )
    return null;
  try {
    const binary = atob(encoded);
    if (binary.length !== size) return null;
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

/** Inspect JPEG marker lengths, frame dimensions, scans and the final EOI. */
function jpegDimensions(
  bytes: Uint8Array,
  metadataToRemove?: Array<{ start: number; end: number }>,
): { width: number; height: number } | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  let frame: { width: number; height: number } | null = null;
  let inScan = false;
  let scanned = false;
  let quantized = false;
  let huffman = false;
  while (offset < bytes.length) {
    if (inScan) {
      while (offset < bytes.length) {
        if (bytes[offset++] !== 0xff) continue;
        const markerStart = offset - 1;
        while (bytes[offset] === 0xff) offset++;
        if (
          bytes[offset] === 0 ||
          (bytes[offset] >= 0xd0 && bytes[offset] <= 0xd7)
        ) {
          offset++;
          continue;
        }
        offset = markerStart;
        inScan = false;
        break;
      }
    }
    const markerStart = offset;
    if (bytes[offset++] !== 0xff) return null;
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xd9)
      return offset === bytes.length && scanned && quantized && huffman
        ? frame
        : null;
    if (
      marker === 0xd8 ||
      marker === 0 ||
      marker === undefined ||
      (marker >= 0xd0 && marker <= 0xd7)
    )
      return null;
    if (marker === 0x01) continue;
    if (offset + 2 > bytes.length) return null;
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length) return null;
    if (marker === 0xe1 && !metadataToRemove) return null; // Imports must not carry EXIF/GPS.
    if (
      metadataToRemove &&
      (marker === 0xe1 ||
        (marker >= 0xe3 && marker <= 0xed) ||
        marker === 0xef ||
        marker === 0xfe)
    )
      metadataToRemove.push({ start: markerStart, end: offset + length });
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      const components = bytes[offset + 7];
      if (
        frame ||
        length !== 8 + 3 * components ||
        bytes[offset + 2] !== 8 ||
        components < 1 ||
        components > 4
      )
        return null;
      frame = {
        height: (bytes[offset + 3] << 8) | bytes[offset + 4],
        width: (bytes[offset + 5] << 8) | bytes[offset + 6],
      };
      if (!frame.width || !frame.height) return null;
    } else if (marker === 0xdb) {
      let position = offset + 2;
      while (position < offset + length) {
        const info = bytes[position++];
        if (info >> 4 > 1 || (info & 15) > 3) return null;
        position += 64 * ((info >> 4) + 1);
      }
      if (position !== offset + length) return null;
      quantized = true;
    } else if (marker === 0xc4) {
      let position = offset + 2;
      while (position < offset + length) {
        const info = bytes[position++];
        if (info >> 4 > 1 || (info & 15) > 3 || position + 16 > offset + length)
          return null;
        let symbols = 0;
        for (let index = 0; index < 16; index++) symbols += bytes[position++];
        if (symbols > 256) return null;
        position += symbols;
      }
      if (position !== offset + length) return null;
      huffman = true;
    } else if (marker === 0xda) {
      const components = bytes[offset + 2];
      if (
        !frame ||
        !quantized ||
        !huffman ||
        components < 1 ||
        components > 4 ||
        length !== 6 + 2 * components
      )
        return null;
      inScan = true;
      scanned = true;
    } else if (
      !(
        (marker >= 0xe0 && marker <= 0xef) ||
        marker === 0xfe ||
        marker === 0xdd
      )
    ) {
      return null;
    }
    offset += length;
  }
  return null;
}

/** WebKit adds fresh EXIF/Photoshop blocks even to a blank canvas JPEG. */
function cleanEncodedJpeg(bytes: Uint8Array): Uint8Array | null {
  const ranges: Array<{ start: number; end: number }> = [];
  if (!jpegDimensions(bytes, ranges)) return null;
  if (ranges.length === 0) return bytes;
  // Keep JFIF (APP0), ICC color profiles (APP2), and Adobe color transforms
  // (APP14). Pixel data, coding tables, scans and restart markers stay intact.
  const cleaned = new Uint8Array(
    bytes.length -
      ranges.reduce((size, range) => size + range.end - range.start, 0),
  );
  let source = 0;
  let target = 0;
  for (const range of ranges) {
    cleaned.set(bytes.subarray(source, range.start), target);
    target += range.start - source;
    source = range.end;
  }
  cleaned.set(bytes.subarray(source), target);
  return cleaned;
}

export function validatePhotos(
  trip: RPGTrip,
  input: unknown,
):
  | { success: true; data: PhotoAttachment[] }
  | { success: false; errors: Issue[] } {
  const errors: Issue[] = [];
  const add = (code: string, path: string, message: string) =>
    errors.push({ code, path, message });
  if (!Array.isArray(input) || input.length > MAX_PHOTOS_PER_ADVENTURE)
    return {
      success: false,
      errors: [
        {
          code: 'INVALID_PHOTOS',
          path: '$.photos',
          message: `照片必须为列表，每份冒险最多保存 ${MAX_PHOTOS_PER_ADVENTURE} 张。`,
        },
      ],
    };
  const questIds = new Set(trip.quests.map((quest) => quest.id));
  const ids = new Set<string>();
  const counts = new Map<string, number>();
  const photos: PhotoAttachment[] = [];
  let totalBytes = 0;
  input.forEach((photo: unknown, index: number) => {
    const path = `$.photos[${index}]`;
    if (
      !record(photo) ||
      Object.keys(photo).length !== photoKeys.length ||
      !photoKeys.every((key) => Object.hasOwn(photo, key))
    ) {
      add('INVALID_PHOTO', path, '照片字段缺失或含有未知字段。');
      return;
    }
    if (!safeId(photo.id) || ids.has(photo.id))
      add('INVALID_PHOTO_ID', `${path}.id`, '照片 ID 不安全或重复。');
    else ids.add(photo.id);
    if (!safeId(photo.questId) || !questIds.has(photo.questId))
      add(
        'UNKNOWN_PHOTO_QUEST',
        `${path}.questId`,
        '照片引用了不存在或不安全的任务。',
      );
    else counts.set(photo.questId, (counts.get(photo.questId) ?? 0) + 1);
    if (!isIsoInstant(photo.createdAt))
      add(
        'INVALID_PHOTO_TIME',
        `${path}.createdAt`,
        '照片保存时间不是有效的 ISO 时间。',
      );
    if (
      typeof photo.caption !== 'string' ||
      photo.caption.length > MAX_PHOTO_CAPTION
    )
      add(
        'INVALID_PHOTO_CAPTION',
        `${path}.caption`,
        `照片说明最多 ${MAX_PHOTO_CAPTION} 字。`,
      );
    const dimensionsValid =
      typeof photo.width === 'number' &&
      typeof photo.height === 'number' &&
      Number.isInteger(photo.width) &&
      Number.isInteger(photo.height) &&
      photo.width > 0 &&
      photo.height > 0 &&
      photo.width <= MAX_PHOTO_EDGE &&
      photo.height <= MAX_PHOTO_EDGE;
    if (!dimensionsValid)
      add(
        'INVALID_PHOTO_DIMENSIONS',
        path,
        `照片长边须不超过 ${MAX_PHOTO_EDGE} 像素。`,
      );
    const bytes = decodeJpeg(photo.dataUrl);
    const dimensions = bytes && jpegDimensions(bytes);
    if (!dimensions)
      add(
        'INVALID_PHOTO_DATA',
        `${path}.dataUrl`,
        '照片必须为不含 EXIF 定位元信息的有效 JPEG 数据，单张不超过 1 MiB；不允许外部链接。',
      );
    else {
      totalBytes += bytes!.length;
      if (
        dimensions.width !== photo.width ||
        dimensions.height !== photo.height
      )
        add(
          'PHOTO_DIMENSION_MISMATCH',
          path,
          '照片像素尺寸与实际 JPEG 不一致。',
        );
    }
    photos.push({
      id: photo.id as string,
      questId: photo.questId as string,
      createdAt: photo.createdAt as string,
      caption: photo.caption as string,
      width: photo.width as number,
      height: photo.height as number,
      dataUrl: photo.dataUrl as string,
    });
  });
  for (const [questId, count] of counts)
    if (count > MAX_PHOTOS_PER_QUEST)
      add(
        'TOO_MANY_QUEST_PHOTOS',
        '$.photos',
        `任务 ${questId} 最多保存 ${MAX_PHOTOS_PER_QUEST} 张照片。`,
      );
  if (totalBytes > MAX_ADVENTURE_PHOTO_BYTES)
    add(
      'PHOTOS_TOO_LARGE',
      '$.photos',
      '这份冒险的照片总容量不能超过 12 MiB，请先删除部分照片。',
    );
  return errors.length
    ? { success: false, errors }
    : { success: true, data: photos };
}

function inspectInput(bytes: Uint8Array): {
  kind: 'jpeg' | 'png' | 'webp' | 'heif';
  width?: number;
  height?: number;
} | null {
  const text = (start: number, end: number) =>
    String.fromCharCode(...bytes.subarray(start, end));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    let offset = 2;
    while (offset + 9 < bytes.length && bytes[offset] === 0xff) {
      const marker = bytes[offset + 1];
      const length = view.getUint16(offset + 2);
      if (length < 2 || marker === 0xda) break;
      if ([0xc0, 0xc1, 0xc2].includes(marker))
        return {
          kind: 'jpeg',
          width: view.getUint16(offset + 7),
          height: view.getUint16(offset + 5),
        };
      offset += 2 + length;
    }
    return { kind: 'jpeg' };
  }
  if (bytes.length >= 24 && bytes[0] === 137 && text(1, 8) === 'PNG\r\n\x1a\n')
    return {
      kind: 'png',
      width: view.getUint32(16),
      height: view.getUint32(20),
    };
  if (bytes.length >= 30 && text(0, 4) === 'RIFF' && text(8, 12) === 'WEBP') {
    const chunk = text(12, 16);
    if (chunk === 'VP8X')
      return {
        kind: 'webp',
        width: 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16),
        height: 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16),
      };
    if (chunk === 'VP8 ')
      return {
        kind: 'webp',
        width: view.getUint16(26, true) & 0x3fff,
        height: view.getUint16(28, true) & 0x3fff,
      };
    if (chunk === 'VP8L' && bytes[20] === 0x2f)
      return {
        kind: 'webp',
        width: 1 + bytes[21] + ((bytes[22] & 63) << 8),
        height:
          1 + (bytes[22] >> 6) + (bytes[23] << 2) + ((bytes[24] & 15) << 10),
      };
    return { kind: 'webp' };
  }
  if (bytes.length >= 16 && text(4, 8) === 'ftyp') {
    const boxSize = Math.min(view.getUint32(0), bytes.length, 256);
    for (let offset = 8; offset + 4 <= boxSize; offset += 4)
      if (
        ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].includes(
          text(offset, offset + 4),
        )
      )
        return { kind: 'heif' };
  }
  return null;
}

function checkInputDimensions(width: number, height: number): void {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width * height > MAX_INPUT_PIXELS ||
    Math.max(width, height) > 32_768
  )
    throw new Error(
      '照片像素过大或尺寸无效，请先缩小到 4000 万像素以内再添加。',
    );
}

function loadImage(url: string, heif: boolean): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      image.onload = null;
      image.onerror = null;
      resolve(image);
    };
    image.onerror = () => {
      image.onload = null;
      image.onerror = null;
      reject(
        new Error(
          heif
            ? '当前浏览器无法读取这张 HEIC/HEIF 照片，请先转换为 JPEG 再添加。'
            : '无法读取这张照片，文件可能损坏。请改用 JPEG、PNG 或 WebP。',
        ),
      );
    };
    image.src = url;
  });
}

function encodeCanvas(
  canvas: HTMLCanvasElement,
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob || blob.type !== 'image/jpeg')
          reject(new Error('浏览器未能处理照片，请更换照片或浏览器后重试。'));
        else resolve(blob);
      },
      'image/jpeg',
      quality,
    );
  });
}

export async function preparePhoto(
  file: File,
  questId: string,
  caption = '',
): Promise<PhotoAttachment> {
  if (!safeId(questId)) throw new Error('任务 ID 无效，无法添加照片。');
  if (typeof caption !== 'string' || caption.length > MAX_PHOTO_CAPTION)
    throw new Error(`照片说明最多 ${MAX_PHOTO_CAPTION} 字。`);
  if (file.size === 0) throw new Error('照片文件为空，请重新选择。');
  if (file.size > MAX_PHOTO_INPUT_BYTES)
    throw new Error('原始照片不能超过 20 MiB，请先缩小照片再添加。');
  if (file.type === 'image/svg+xml' || /\.svgz?$/i.test(file.name))
    throw new Error(
      '不支持 SVG 照片，请选择 JPEG、PNG、WebP，或浏览器可读取的 HEIC/HEIF。',
    );
  const header = new Uint8Array(await file.slice(0, 65_536).arrayBuffer());
  const input = inspectInput(header);
  if (!input)
    throw new Error(
      '照片格式不支持或文件损坏，请选择 JPEG、PNG、WebP，或浏览器可读取的 HEIC/HEIF。',
    );
  if (input.width !== undefined && input.height !== undefined)
    checkInputDimensions(input.width, input.height);
  const url = URL.createObjectURL(file);
  let canvas: HTMLCanvasElement | undefined;
  try {
    const image = await loadImage(url, input.kind === 'heif');
    checkInputDimensions(image.naturalWidth, image.naturalHeight);
    const scale = Math.min(
      1,
      MAX_PHOTO_EDGE / Math.max(image.naturalWidth, image.naturalHeight),
    );
    let width = Math.max(1, Math.round(image.naturalWidth * scale));
    let height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('浏览器无法处理照片，请更换浏览器后重试。');
    let blob: Blob | undefined;
    for (let resize = 0; resize < 5; resize++) {
      canvas.width = width;
      canvas.height = height;
      context.fillStyle = '#fff';
      context.fillRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);
      for (const quality of [0.82, 0.7, 0.58, 0.46]) {
        blob = await encodeCanvas(canvas, quality);
        if (blob.size <= MAX_PHOTO_BYTES) break;
      }
      if (blob && blob.size <= MAX_PHOTO_BYTES) break;
      width = Math.max(1, Math.floor(width * 0.75));
      height = Math.max(1, Math.floor(height * 0.75));
    }
    if (!blob || blob.size === 0 || blob.size > MAX_PHOTO_BYTES)
      throw new Error('照片压缩后仍超过 1 MiB，请先缩小照片再添加。');
    const bytes = cleanEncodedJpeg(new Uint8Array(await blob.arrayBuffer()));
    const dimensions = bytes && jpegDimensions(bytes);
    if (
      !bytes ||
      !dimensions ||
      dimensions.width !== canvas.width ||
      dimensions.height !== canvas.height
    )
      throw new Error('浏览器生成的照片无效，请更换照片或浏览器后重试。');
    const chunks: string[] = [];
    for (let offset = 0; offset < bytes.length; offset += 32_768)
      chunks.push(
        String.fromCharCode(...bytes.subarray(offset, offset + 32_768)),
      );
    return {
      id: `photo_${crypto.randomUUID().replaceAll('-', '')}`,
      questId,
      createdAt: new Date().toISOString(),
      caption: caption.trim(),
      width: canvas.width,
      height: canvas.height,
      dataUrl: JPEG_PREFIX + btoa(chunks.join('')),
    };
  } finally {
    URL.revokeObjectURL(url);
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
}
