import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDB } from 'idb';
import { readFileSync } from 'node:fs';
import fixture from '../fixtures/valid-trip.json';
import type { RPGTrip } from '../../src/protocol/schema';
import { initialProgress, transitionProgress } from '../../src/domain/progress';
import { createSave, parseImport } from '../../src/storage/backup';
import type { PhotoAttachment } from '../../src/domain/photos';

const trip = fixture as RPGTrip;
const photo: PhotoAttachment = {
  id: 'photo_01',
  questId: 'quest_01',
  createdAt: '2026-09-20T00:00:00Z',
  caption: '山间石阶',
  width: 2,
  height: 2,
  dataUrl: `data:image/jpeg;base64,${readFileSync(new URL('../fixtures/photo-valid.jpg', import.meta.url)).toString('base64')}`,
};
let storage: typeof import('../../src/storage/db');

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal('indexedDB', new IDBFactory());
  storage = await import('../../src/storage/db');
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('真实 IndexedDB 事务语义（fake-indexeddb）', () => {
  it('旧数据库没有照片字段时读取为空且不迁移或重建数据库', async () => {
    const adventure = await storage.createAdventure(trip, 'legacy');
    const db = await openDB('rpg-travel', 1);
    await db.put('progress', {
      instanceId: adventure.instanceId,
      progress: adventure.progress,
      revision: 0,
    });
    const upgrade = vi.spyOn(indexedDB, 'deleteDatabase');
    expect(await storage.getAdventure(adventure.instanceId)).toMatchObject({
      photos: [],
      revision: 0,
    });
    expect(db.version).toBe(1);
    expect(upgrade).not.toHaveBeenCalled();
    db.close();
  });

  it('照片与进度原子恢复；只在photos保存附件，不在原始回复复制照片', async () => {
    const selected = transitionProgress(trip, initialProgress(trip), {
      type: 'select',
      questId: 'quest_03',
    });
    const progress = transitionProgress(trip, selected, {
      type: 'skip',
      questId: 'quest_03',
    });
    const parsed = parseImport(
      JSON.stringify(createSave(trip, progress, undefined, [photo])),
    );
    if (!parsed.success) throw new Error('Photo backup fixture failed');
    const adventure = await storage.createAdventure(
      parsed.data,
      parsed.rawReply,
      parsed.progress,
      parsed.photos,
    );
    expect(adventure.photos).toEqual([photo]);
    expect(adventure.progress).toEqual(progress);
    expect(adventure.rawReply).not.toContain(photo.dataUrl);
    const readBack = await storage.getAdventure(adventure.instanceId);
    expect(readBack?.photos).toEqual([photo]);
    expect((await storage.listAdventures())[0].photos).toEqual([photo]);
  });

  it('照片保存捕获入队快照，后续进度写入和重开保留照片，删除连带照片', async () => {
    const adventure = await storage.createAdventure(trip, 'raw');
    const photos = [structuredClone(photo)];
    const writing = storage.savePhotos(adventure.instanceId, photos, 0);
    photos[0].caption = '后来编辑不得串入在途保存';
    const saved = await writing;
    expect(saved.photos).toEqual([photo]);
    expect(saved.progress).toEqual(adventure.progress);
    expect(saved.revision).toBe(1);
    const progress = transitionProgress(trip, saved.progress, {
      type: 'skip',
      questId: 'quest_01',
    });
    const progressed = await storage.saveProgress(
      adventure.instanceId,
      progress,
      1,
    );
    expect(progressed.photos).toEqual([photo]);
    const restarted = await storage.restartAdventure(adventure.instanceId, 2);
    expect(restarted.photos).toEqual([photo]);
    expect(restarted.progress.quests.quest_01.status).toBe('available');
    await storage.deleteAdventure(adventure.instanceId);
    const db = await openDB('rpg-travel', 1);
    expect(await db.get('progress', adventure.instanceId)).toBeUndefined();
    expect(await storage.getAdventure(adventure.instanceId)).toBeUndefined();
    db.close();
  });

  it('照片和行动进度共享并发版本，旧页面不能覆盖另一个页面的新照片', async () => {
    const adventure = await storage.createAdventure(trip, 'raw');
    const progress = transitionProgress(trip, adventure.progress, {
      type: 'start',
      questId: 'quest_01',
    });
    const [photoResult, progressResult] = await Promise.allSettled([
      storage.savePhotos(adventure.instanceId, [photo], 0),
      storage.saveProgress(adventure.instanceId, progress, 0),
    ]);
    expect(photoResult.status).toBe('fulfilled');
    expect(progressResult.status).toBe('rejected');
    if (progressResult.status === 'rejected')
      expect(progressResult.reason.code).toBe('STALE_PROGRESS');
    expect((await storage.getAdventure(adventure.instanceId))?.photos).toEqual([
      photo,
    ]);
    await expect(
      storage.savePhotos(adventure.instanceId, [], 0),
    ).rejects.toMatchObject({ code: 'STALE_PROGRESS' });
    await storage.saveProgress(adventure.instanceId, progress, 1);
    await expect(
      storage.savePhotos(adventure.instanceId, [], 1),
    ).rejects.toMatchObject({ code: 'STALE_PROGRESS' });
    expect((await storage.getAdventure(adventure.instanceId))?.photos).toEqual([
      photo,
    ]);
  });

  it('照片事务后半段写入失败时保留旧照片和版本，重试可以保存', async () => {
    const adventure = await storage.createAdventure(trip, 'raw', null, [photo]);
    const changed = { ...photo, caption: '另一条记录' };
    const original = IDBObjectStore.prototype.put;
    const failing = vi
      .spyOn(IDBObjectStore.prototype, 'put')
      .mockImplementation(function (
        this: IDBObjectStore,
        value: unknown,
        key?: IDBValidKey,
      ) {
        if (this.name === 'adventures')
          throw new DOMException('Photo quota test', 'QuotaExceededError');
        return key === undefined
          ? original.call(this, value)
          : original.call(this, value, key);
      });
    await expect(
      storage.savePhotos(adventure.instanceId, [changed], 0),
    ).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED' });
    failing.mockRestore();
    expect(await storage.getAdventure(adventure.instanceId)).toMatchObject({
      photos: [photo],
      revision: 0,
      progress: adventure.progress,
    });
    await expect(
      storage.savePhotos(adventure.instanceId, [changed], 0),
    ).resolves.toMatchObject({ photos: [changed], revision: 1 });
  });

  it('坏照片拒绝创建或写入，本机损坏明确报错且不清空原字段', async () => {
    const invalid = { ...photo, questId: 'quest_missing' };
    await expect(
      storage.createAdventure(trip, 'raw', null, [invalid]),
    ).rejects.toMatchObject({ code: 'INVALID_PHOTOS' });
    expect(await storage.listAdventures()).toEqual([]);
    const adventure = await storage.createAdventure(trip, 'raw', null, [photo]);
    await expect(
      storage.savePhotos(adventure.instanceId, [invalid], 0),
    ).rejects.toMatchObject({ code: 'INVALID_PHOTOS' });
    expect((await storage.getAdventure(adventure.instanceId))?.photos).toEqual([
      photo,
    ]);
    const db = await openDB('rpg-travel', 1);
    const state = await db.get('progress', adventure.instanceId);
    await db.put('progress', { ...state, photos: [invalid] });
    await expect(
      storage.getAdventure(adventure.instanceId),
    ).rejects.toMatchObject({ code: 'CORRUPT_PHOTOS' });
    expect((await db.get('progress', adventure.instanceId)).photos).toEqual([
      invalid,
    ]);
    db.close();
  });

  it('相同故事 ID 仍生成独立 UUID，精确恢复勾选且不套用初始状态', async () => {
    const first = await storage.createAdventure(trip, 'raw first');
    const second = await storage.createAdventure(trip, 'raw second');
    expect(first.instanceId).not.toBe(second.instanceId);
    expect(first.instanceId).not.toBe(trip.adventure.id);
    let progress = transitionProgress(trip, first.progress, {
      type: 'start',
      questId: 'quest_01',
    });
    progress = transitionProgress(trip, progress, {
      type: 'check',
      questId: 'quest_01',
      objectiveId: 'objective_01',
      checked: true,
    });
    const saved = await storage.saveProgress(
      first.instanceId,
      progress,
      first.revision,
    );
    expect(saved.revision).toBe(1);
    expect((await storage.getAdventure(first.instanceId))?.progress).toEqual(
      progress,
    );
    expect(
      (await storage.getAdventure(second.instanceId))?.progress.quests.quest_01
        .status,
    ).toBe('available');
    expect(await storage.listAdventures()).toHaveLength(2);
    const reopened = await import('../../src/storage/db');
    expect(
      (await reopened.getAdventure(first.instanceId))?.progress.quests.quest_01
        .checkedObjectiveIds,
    ).toEqual(['objective_01']);
  });

  it('并发旧版本写入被拒绝，不覆写其他页较新状态，队列失败后仍可保存', async () => {
    const adventure = await storage.createAdventure(trip, 'raw');
    const active = transitionProgress(trip, adventure.progress, {
      type: 'start',
      questId: 'quest_01',
    });
    const skipped = transitionProgress(trip, adventure.progress, {
      type: 'skip',
      questId: 'quest_01',
    });
    const results = await Promise.allSettled([
      storage.saveProgress(adventure.instanceId, active, 0),
      storage.saveProgress(adventure.instanceId, skipped, 0),
    ]);
    expect(results[0].status).toBe('fulfilled');
    expect(results[1].status).toBe('rejected');
    if (results[1].status === 'rejected')
      expect(results[1].reason.code).toBe('STALE_PROGRESS');
    expect(
      (await storage.getAdventure(adventure.instanceId))?.progress.quests
        .quest_01.status,
    ).toBe('active');
    await expect(
      storage.saveProgress(adventure.instanceId, skipped, 1),
    ).resolves.toMatchObject({ revision: 2 });
  });

  it('切换地点保存多个进行中调查，重新读取及备份恢复不丢各自行动勾选', async () => {
    let record = await storage.createAdventure(trip, 'free-order test');
    const actions = [
      { type: 'start', questId: 'quest_01' },
      {
        type: 'check',
        questId: 'quest_01',
        objectiveId: 'objective_01',
        checked: true,
      },
      { type: 'select', questId: 'quest_03' },
      { type: 'start', questId: 'quest_03' },
      {
        type: 'check',
        questId: 'quest_03',
        objectiveId: 'objective_07',
        checked: true,
      },
      { type: 'select', questId: 'quest_01' },
    ] as const;
    for (const action of actions) {
      const next = transitionProgress(trip, record.progress, action);
      record = await storage.saveProgress(
        record.instanceId,
        next,
        record.revision,
      );
    }
    const reloaded = await storage.getAdventure(record.instanceId);
    expect(reloaded?.progress).toEqual(record.progress);
    expect(reloaded?.progress.quests.quest_01.checkedObjectiveIds).toEqual([
      'objective_01',
    ]);
    expect(reloaded?.progress.quests.quest_03.checkedObjectiveIds).toEqual([
      'objective_07',
    ]);
    expect(reloaded?.progress.quests.quest_01.status).toBe('active');
    expect(reloaded?.progress.quests.quest_03.status).toBe('active');
    const parsed = parseImport(
      JSON.stringify(createSave(trip, record.progress)),
    );
    if (!parsed.success) throw new Error('Fixture failed');
    const restored = await storage.createAdventure(
      parsed.data,
      parsed.rawReply,
      parsed.progress,
    );
    expect(restored.progress).toEqual(record.progress);
    expect(restored.instanceId).not.toBe(record.instanceId);
  });

  it('保存第二个 store 同步失败会回滚第一个 store，失败可重试', async () => {
    const adventure = await storage.createAdventure(trip, 'raw');
    const active = transitionProgress(trip, adventure.progress, {
      type: 'start',
      questId: 'quest_01',
    });
    const original = IDBObjectStore.prototype.put;
    const failing = vi
      .spyOn(IDBObjectStore.prototype, 'put')
      .mockImplementation(function (
        this: IDBObjectStore,
        value: unknown,
        key?: IDBValidKey,
      ) {
        if (this.name === 'adventures')
          throw new DOMException('Test quota', 'QuotaExceededError');
        return key === undefined
          ? original.call(this, value)
          : original.call(this, value, key);
      });
    await expect(
      storage.saveProgress(adventure.instanceId, active, 0),
    ).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED' });
    failing.mockRestore();
    expect((await storage.getAdventure(adventure.instanceId))?.revision).toBe(
      0,
    );
    expect(
      (await storage.getAdventure(adventure.instanceId))?.progress,
    ).toEqual(adventure.progress);
    await expect(
      storage.saveProgress(adventure.instanceId, active, 0),
    ).resolves.toMatchObject({ revision: 1 });
  });

  it('创建失败不留下半份冒险', async () => {
    const original = IDBObjectStore.prototype.add;
    const failing = vi
      .spyOn(IDBObjectStore.prototype, 'add')
      .mockImplementation(function (
        this: IDBObjectStore,
        value: unknown,
        key?: IDBValidKey,
      ) {
        if (this.name === 'progress')
          throw new DOMException('Test write abort', 'AbortError');
        return key === undefined
          ? original.call(this, value)
          : original.call(this, value, key);
      });
    await expect(storage.createAdventure(trip, 'raw')).rejects.toMatchObject({
      code: 'WRITE_ABORTED',
    });
    failing.mockRestore();
    expect(await storage.listAdventures()).toEqual([]);
    await expect(storage.createAdventure(trip, 'raw')).resolves.toMatchObject({
      revision: 0,
    });
  });

  it('重开与删除仅影响指定实例，备份恢复新实例继续原进度', async () => {
    const first = await storage.createAdventure(trip, 'raw');
    const second = await storage.createAdventure(trip, 'raw');
    const progress = transitionProgress(trip, first.progress, {
      type: 'skip',
      questId: 'quest_01',
    });
    const updated = await storage.saveProgress(first.instanceId, progress, 0);
    const imported = parseImport(
      JSON.stringify(createSave(trip, updated.progress)),
    );
    if (!imported.success) throw new Error('Fixture failed');
    const restored = await storage.createAdventure(
      imported.data,
      imported.rawReply,
      imported.progress,
    );
    expect(restored.instanceId).not.toBe(first.instanceId);
    expect(restored.progress).toEqual(updated.progress);
    await storage.restartAdventure(first.instanceId, 1);
    expect(
      (await storage.getAdventure(first.instanceId))?.progress.currentQuestId,
    ).toBe('quest_01');
    expect(
      (await storage.getAdventure(restored.instanceId))?.progress
        .currentQuestId,
    ).toBe('quest_02');
    await storage.deleteAdventure(first.instanceId);
    expect(await storage.getAdventure(first.instanceId)).toBeUndefined();
    expect(await storage.getAdventure(second.instanceId)).toBeDefined();
    expect(await storage.listAdventures()).toHaveLength(2);
  });

  it('草稿按调用顺序保存，捕获入队快照；flush 等待事务而不是请求发出', async () => {
    const draft = { destination: '初始地点', privateNote: '只在本机' };
    const first = storage.setSetting('draft', draft);
    draft.destination = '不应影响待写入快照';
    await first;
    expect(await storage.getSetting('draft')).toEqual({
      destination: '初始地点',
      privateNote: '只在本机',
    });
    const writes = [
      storage.setSetting('draft', { destination: '地点二' }),
      storage.setSetting('draft', { destination: '地点三' }),
    ];
    await storage.flushWrites();
    await Promise.all(writes);
    expect(await storage.getSetting('draft')).toEqual({
      destination: '地点三',
    });
  });

  it('本机进度损坏不会默默清零，拒绝无效进度写入', async () => {
    const adventure = await storage.createAdventure(trip, 'raw');
    const bad = initialProgress(trip);
    bad.currentQuestId = 'quest_missing';
    await expect(
      storage.saveProgress(adventure.instanceId, bad, 0),
    ).rejects.toMatchObject({ code: 'INVALID_PROGRESS' });
    const db = await openDB('rpg-travel', 1);
    await db.put('progress', {
      instanceId: adventure.instanceId,
      progress: bad,
      revision: 0,
    });
    await expect(
      storage.getAdventure(adventure.instanceId),
    ).rejects.toMatchObject({ code: 'CORRUPT_PROGRESS' });
    expect(
      (await db.get('progress', adventure.instanceId)).progress.currentQuestId,
    ).toBe('quest_missing');
    db.close();
  });

  it('数据库不可用给可操作中文提示，不删除任何数据', async () => {
    vi.stubGlobal('indexedDB', undefined);
    await expect(storage.listAdventures()).rejects.toMatchObject({
      code: 'STORAGE_UNAVAILABLE',
      message: expect.stringContaining('保留'),
    });
    expect(
      storage.storageError(new DOMException('Security', 'SecurityError'))
        .message,
    ).toContain('存储设置');
  });

  it('版本变更时安全关闭旧连接并发送用户通知', async () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal('window', { dispatchEvent });
    const adventure = await storage.createAdventure(trip, 'raw');
    const newer = await openDB('rpg-travel', 2);
    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: expect.objectContaining({ code: 'DATABASE_CHANGED' }),
      }),
    );
    expect((await newer.get('adventures', adventure.instanceId)).rawReply).toBe(
      'raw',
    );
    newer.close();
    await expect(storage.listAdventures()).rejects.toMatchObject({
      code: 'DATABASE_VERSION',
    });
  });

  it('阻塞事件立即给关闭其他页面的提示，失败后可重试且不删除数据库', async () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal('window', { dispatchEvent });
    const original = indexedDB.open.bind(indexedDB);
    const open = vi
      .spyOn(indexedDB, 'open')
      .mockImplementationOnce((name, version) => {
        const request = original(name, version);
        // Exercise the browser event path without needing a second live tab.
        request.addEventListener('upgradeneeded', () =>
          request.dispatchEvent(new IDBVersionChangeEvent('blocked')),
        );
        return request;
      });
    const remove = vi.spyOn(indexedDB, 'deleteDatabase');
    await expect(storage.listAdventures()).rejects.toMatchObject({
      code: 'DATABASE_BLOCKED',
      message: expect.stringContaining('关闭'),
    });
    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: expect.objectContaining({ code: 'DATABASE_BLOCKED' }),
      }),
    );
    open.mockRestore();
    expect(await storage.listAdventures()).toEqual([]);
    expect(remove).not.toHaveBeenCalled();
  });
});
