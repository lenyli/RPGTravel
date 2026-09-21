import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import fixture from '../fixtures/valid-trip.json';
import type { RPGTrip } from '../../src/protocol/schema';
import {
  MAX_ADVENTURE_PHOTO_BYTES,
  MAX_PHOTO_BYTES,
  MAX_PHOTO_INPUT_BYTES,
  MAX_PHOTOS_PER_ADVENTURE,
  photoByteSize,
  preparePhoto,
  validatePhotos,
  type PhotoAttachment,
} from '../../src/domain/photos';

const trip = fixture as RPGTrip;
const jpeg = readFileSync(
  new URL('../fixtures/photo-valid.jpg', import.meta.url),
);
const url = (bytes: Uint8Array = jpeg) =>
  `data:image/jpeg;base64,${Buffer.from(bytes).toString('base64')}`;
const photo = (changes: Partial<PhotoAttachment> = {}): PhotoAttachment => ({
  id: 'photo_01',
  questId: 'quest_01',
  createdAt: '2026-09-20T00:00:00Z',
  caption: '石阶边的青苔',
  width: 2,
  height: 2,
  dataUrl: url(),
  ...changes,
});
const codes = (input: unknown) => {
  const result = validatePhotos(trip, input);
  return result.success ? [] : result.errors.map((issue) => issue.code);
};

afterEach(() => vi.unstubAllGlobals());

describe('本地照片存档校验', () => {
  it('接受空列表与真实 JPEG，独立复制字段并按压缩字节计容量', () => {
    expect(validatePhotos(trip, [])).toEqual({ success: true, data: [] });
    const original = photo();
    const result = validatePhotos(trip, [original]);
    expect(result).toEqual({ success: true, data: [original] });
    if (result.success) expect(result.data[0]).not.toBe(original);
    expect(photoByteSize(original)).toBe(jpeg.length);
    expect(photoByteSize({ dataUrl: 'https://example.com/a.jpg' })).toBe(0);
  });

  it.each([
    [null, 'INVALID_PHOTOS'],
    [[{ ...photo(), sourceUrl: 'https://example.com' }], 'INVALID_PHOTO'],
    [[{ ...photo(), caption: undefined }], 'INVALID_PHOTO_CAPTION'],
    [[photo({ id: '__proto__' })], 'INVALID_PHOTO_ID'],
    [[photo({ id: 'constructor' })], 'INVALID_PHOTO_ID'],
    [[photo({ id: 'photo/path' })], 'INVALID_PHOTO_ID'],
    [[photo(), photo()], 'INVALID_PHOTO_ID'],
    [[photo({ questId: 'quest_missing' })], 'UNKNOWN_PHOTO_QUEST'],
    [[photo({ createdAt: '2026-02-30T00:00:00Z' })], 'INVALID_PHOTO_TIME'],
    [[photo({ createdAt: '2026-09-20' })], 'INVALID_PHOTO_TIME'],
    [[photo({ caption: '字'.repeat(501) })], 'INVALID_PHOTO_CAPTION'],
    [[photo({ width: 1601 })], 'INVALID_PHOTO_DIMENSIONS'],
    [[photo({ height: 0 })], 'INVALID_PHOTO_DIMENSIONS'],
    [[photo({ width: 1.5 })], 'INVALID_PHOTO_DIMENSIONS'],
    [[photo({ width: 1 })], 'PHOTO_DIMENSION_MISMATCH'],
  ])('拒绝无效记录（案例 %#）', (input, code) => {
    expect(codes(input)).toContain(code);
  });

  it.each([
    'https://example.com/photo.jpg',
    'data:image/svg+xml;base64,PHN2Zz4=',
    'data:image/png;base64,iVBORw0KGgo=',
    'data:image/jpeg;base64,/9j/2Q==',
    url().replace('base64,', 'base64,\n'),
    url().replace('base64,', 'base64,='),
    url().slice(0, -1),
    url(jpeg.subarray(0, -2)),
    url(Buffer.concat([jpeg, Buffer.from([0])])),
    `data:image/jpeg;base64,${'A'.repeat(4 * Math.ceil((MAX_PHOTO_BYTES + 3) / 3))}`,
  ])('拒绝伪装、损坏、外链与超大图像数据', (dataUrl) => {
    expect(codes([photo({ dataUrl })])).toContain('INVALID_PHOTO_DATA');
  });

  it('拒绝非规范 base64 填充位，不能通过同字节的替代编码绕过', () => {
    const padded = jpeg.toString('base64');
    expect(padded.endsWith('=')).toBe(true);
    const alphabet =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const padding = padded.endsWith('==') ? 2 : 1;
    const position = padded.length - padding - 1;
    const altered =
      padded.slice(0, position) +
      alphabet[alphabet.indexOf(padded[position]) | 1] +
      padded.slice(position + 1);
    expect(
      codes([photo({ dataUrl: `data:image/jpeg;base64,${altered}` })]),
    ).toContain('INVALID_PHOTO_DATA');
  });

  it('拒绝 JPEG APP1 中的 EXIF 元信息与非法分段长度', () => {
    const exif = Buffer.from([0xff, 0xe1, 0, 8, 69, 120, 105, 102, 0, 0]);
    expect(
      codes([
        photo({
          dataUrl: url(
            Buffer.concat([jpeg.subarray(0, 2), exif, jpeg.subarray(2)]),
          ),
        }),
      ]),
    ).toContain('INVALID_PHOTO_DATA');
    const invalid = Buffer.from(jpeg);
    invalid[4] = 0xff;
    invalid[5] = 0xff;
    expect(codes([photo({ dataUrl: url(invalid) })])).toContain(
      'INVALID_PHOTO_DATA',
    );
  });

  it('按任务和全局分别限制数量，已知任务之外的 ID 不计作新位置', () => {
    const seven = Array.from({ length: 7 }, (_, index) =>
      photo({ id: `photo_${index}` }),
    );
    expect(codes(seven)).toContain('TOO_MANY_QUEST_PHOTOS');
    expect(
      codes(
        Array.from({ length: MAX_PHOTOS_PER_ADVENTURE + 1 }, (_, index) =>
          photo({ id: `photo_${index}` }),
        ),
      ),
    ).toContain('INVALID_PHOTOS');
    expect(validatePhotos(trip, seven.slice(0, 6)).success).toBe(true);
  });

  it('按实际 JPEG 字节累计总量，超过 12 MiB 时拒绝整份照片列表', () => {
    // Legal COM segments make a bounded large JPEG without allocating huge pixels.
    const comment = Buffer.alloc(65_537);
    comment.set([0xff, 0xfe, 0xff, 0xff]);
    const large = Buffer.concat([
      jpeg.subarray(0, 2),
      ...Array(15).fill(comment),
      jpeg.subarray(2),
    ]);
    expect(large.length).toBeLessThan(MAX_PHOTO_BYTES);
    const many = Array.from({ length: 15 }, (_, index) =>
      photo({
        id: `photo_${index}`,
        questId: trip.quests[Math.floor(index / 5)].id,
        dataUrl: url(large),
      }),
    );
    expect(large.length * many.length).toBeGreaterThan(
      MAX_ADVENTURE_PHOTO_BYTES,
    );
    expect(codes(many)).toEqual(['PHOTOS_TOO_LARGE']);
  });
});

function browserImage(
  options: {
    width?: number;
    height?: number;
    decodeError?: boolean;
    encodeError?: boolean;
    tooLargeCount?: number;
    encodedBytes?: (bytes: Buffer) => Buffer | Promise<Buffer>;
  } = {},
) {
  const revoked = vi.fn();
  const created = vi.fn(() => 'blob:photo-test');
  vi.stubGlobal('URL', { createObjectURL: created, revokeObjectURL: revoked });
  vi.stubGlobal(
    'Image',
    class {
      naturalWidth = options.width ?? 2;
      naturalHeight = options.height ?? 2;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) {
        queueMicrotask(() =>
          options.decodeError ? this.onerror?.() : this.onload?.(),
        );
      }
    },
  );
  const draw = vi.fn();
  const qualities: number[] = [];
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({ fillStyle: '', fillRect: vi.fn(), drawImage: draw }),
    toBlob(
      callback: (blob: Blob | null) => void,
      type: string,
      quality: number,
    ) {
      qualities.push(quality);
      if (options.encodeError) return callback(null);
      if (qualities.length <= (options.tooLargeCount ?? 0))
        return callback(
          new Blob([new Uint8Array(MAX_PHOTO_BYTES + 1)], { type }),
        );
      void sharp({
        create: {
          width: canvas.width,
          height: canvas.height,
          channels: 3,
          background: '#56856e',
        },
      })
        .jpeg({ quality: 82 })
        .toBuffer()
        .then((buffer) => options.encodedBytes?.(buffer) ?? buffer)
        .then((buffer) =>
          callback(new Blob([new Uint8Array(buffer)], { type })),
        );
    },
  };
  vi.stubGlobal('document', { createElement: () => canvas });
  return { revoked, created, draw, qualities, canvas };
}

describe('浏览器照片处理', () => {
  it('移除 WebKit canvas 新生成的 EXIF、Photoshop 和私有注释，保留 JFIF、ICC 与 Adobe 色彩段', async () => {
    const segment = (marker: number, data: Buffer) => {
      const header = Buffer.from([0xff, marker, 0, 0]);
      header.writeUInt16BE(data.length + 2, 2);
      return Buffer.concat([header, data]);
    };
    const exif = segment(0xe1, Buffer.from('Exif\0\0fresh-webkit-exif'));
    const photoshop = segment(
      0xed,
      Buffer.from('Photoshop 3.0\0fresh-webkit-metadata'),
    );
    const privateData = segment(0xe3, Buffer.from('private-metadata'));
    const comment = segment(0xfe, Buffer.from('private-comment'));
    const jfif = segment(
      0xe0,
      Buffer.from([74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]),
    );
    const adobe = segment(
      0xee,
      Buffer.from([65, 100, 111, 98, 101, 0, 100, 0, 0, 0, 0, 1]),
    );
    let encoded: Buffer | undefined;
    const browser = browserImage({
      encodedBytes: async (bytes) => {
        const withColor = await sharp(bytes)
          .withIccProfile('srgb')
          .jpeg()
          .toBuffer();
        encoded = Buffer.concat([
          withColor.subarray(0, 2),
          jfif,
          exif,
          photoshop,
          privateData,
          comment,
          adobe,
          withColor.subarray(2),
        ]);
        return encoded;
      },
    });
    const result = await preparePhoto(
      new File([jpeg], 'photo.jpg'),
      'quest_01',
    );
    const cleaned = Buffer.from(result.dataUrl.split(',')[1], 'base64');
    expect(validatePhotos(trip, [result]).success).toBe(true);
    // Import remains strict: EXIF in a supplied backup is never silently removed.
    expect(codes([photo({ dataUrl: url(encoded!) })])).toContain(
      'INVALID_PHOTO_DATA',
    );
    for (const removed of [exif, photoshop, privateData, comment])
      expect(cleaned.includes(removed)).toBe(false);
    for (const retained of [jfif, adobe, Buffer.from('ICC_PROFILE\0')])
      expect(cleaned.includes(retained)).toBe(true);
    expect(await sharp(cleaned).metadata()).toMatchObject({
      format: 'jpeg',
      width: 2,
      height: 2,
    });
    expect(await sharp(cleaned).raw().toBuffer()).toEqual(
      await sharp(encoded!).raw().toBuffer(),
    );
    expect(browser.revoked).toHaveBeenCalledOnce();
  });

  it('元信息长度损坏时不通过剥离来修复坏 JPEG，仍报错并释放资源', async () => {
    const browser = browserImage({
      encodedBytes: (bytes) =>
        Buffer.concat([
          bytes.subarray(0, 2),
          Buffer.from([0xff, 0xe1, 0xff, 0xff]),
          bytes.subarray(2),
        ]),
    });
    await expect(
      preparePhoto(new File([jpeg], 'photo.jpg'), 'quest_01'),
    ).rejects.toThrow('浏览器生成的照片无效');
    expect(browser.revoked).toHaveBeenCalledOnce();
    expect(browser.canvas.width).toBe(0);
  });

  it('重编码后只保留 JPEG，长边缩到 1600，释放 URL 与 canvas', async () => {
    const browser = browserImage({ width: 4000, height: 2000 });
    const result = await preparePhoto(
      new File([jpeg], 'photo.jpg', { type: 'image/jpeg' }),
      'quest_01',
      '  山路  ',
    );
    expect(result).toMatchObject({
      width: 1600,
      height: 800,
      caption: '山路',
      questId: 'quest_01',
    });
    expect(result.id).toMatch(/^photo_[a-f\d]{32}$/);
    expect(validatePhotos(trip, [result]).success).toBe(true);
    expect(browser.draw).toHaveBeenCalledWith(
      expect.anything(),
      0,
      0,
      1600,
      800,
    );
    expect(browser.revoked).toHaveBeenCalledWith('blob:photo-test');
    expect(browser.canvas.width).toBe(0);
  });

  it('超过 1 MiB 时降质，仍过大再缩尺寸，最终产物仍可校验', async () => {
    const browser = browserImage({
      width: 1600,
      height: 800,
      tooLargeCount: 4,
    });
    const result = await preparePhoto(
      new File([jpeg], 'large.jpg'),
      'quest_01',
    );
    expect(browser.qualities).toEqual([0.82, 0.7, 0.58, 0.46, 0.82]);
    expect(result).toMatchObject({ width: 1200, height: 600 });
    expect(validatePhotos(trip, [result]).success).toBe(true);
  });

  it.each([
    [{ decodeError: true }, '无法读取这张照片'],
    [{ encodeError: true }, '浏览器未能处理照片'],
    [{ tooLargeCount: 30 }, '照片压缩后仍超过'],
    [{ width: 50_000, height: 50_000 }, '照片像素过大'],
  ])('处理失败会释放对象 URL，并给出中文原因', async (options, message) => {
    const browser = browserImage(options);
    await expect(
      preparePhoto(new File([jpeg], 'photo.jpg'), 'quest_01'),
    ).rejects.toThrow(message);
    expect(browser.revoked).toHaveBeenCalledExactlyOnceWith('blob:photo-test');
  });

  it('拒绝空文件、SVG、伪装图片及原始超限，在创建 URL 前终止', async () => {
    const browser = browserImage();
    await expect(
      preparePhoto(new File([], 'empty.jpg'), 'quest_01'),
    ).rejects.toThrow('文件为空');
    await expect(
      preparePhoto(
        new File(['<svg/>'], 'photo.svg', { type: 'image/svg+xml' }),
        'quest_01',
      ),
    ).rejects.toThrow('不支持 SVG');
    await expect(
      preparePhoto(
        new File(['<svg/>'], 'photo.jpg', { type: 'image/jpeg' }),
        'quest_01',
      ),
    ).rejects.toThrow('格式不支持');
    await expect(
      preparePhoto(
        new File([new Uint8Array(MAX_PHOTO_INPUT_BYTES + 1)], 'photo.jpg'),
        'quest_01',
      ),
    ).rejects.toThrow('20 MiB');
    expect(browser.created).not.toHaveBeenCalled();
  });

  it('PNG 头声明的过大像素在浏览器解码前即被拒绝', async () => {
    const browser = browserImage();
    const png = Buffer.alloc(24);
    png.set([137, 80, 78, 71, 13, 10, 26, 10]);
    png.writeUInt32BE(100_000, 16);
    png.writeUInt32BE(100_000, 20);
    await expect(
      preparePhoto(new File([png], 'large.png'), 'quest_01'),
    ).rejects.toThrow('4000 万像素');
    expect(browser.created).not.toHaveBeenCalled();
  });

  it('无法解码 HEIC 时明确提示转换格式，仍释放对象 URL', async () => {
    const browser = browserImage({ decodeError: true });
    const heic = Buffer.from([
      0,
      0,
      0,
      16,
      ...Buffer.from('ftypheic'),
      0,
      0,
      0,
      0,
    ]);
    await expect(
      preparePhoto(
        new File([heic], 'photo.heic', { type: 'image/heic' }),
        'quest_01',
      ),
    ).rejects.toThrow('HEIC/HEIF');
    expect(browser.revoked).toHaveBeenCalledOnce();
  });
});
