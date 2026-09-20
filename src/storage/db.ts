import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { RPGTrip } from '../protocol/schema';
import { validateTrip } from '../protocol/validate';
import {
  initialProgress,
  isIsoInstant,
  validateProgress,
  type Progress,
} from '../domain/progress';

export type AdventureRecord = {
  instanceId: string;
  importedAt: string;
  updatedAt: string;
  data: RPGTrip;
  rawReply: string;
};
export type StoredAdventure = AdventureRecord & {
  progress: Progress;
  revision: number;
};
interface TripDatabase extends DBSchema {
  adventures: { key: string; value: AdventureRecord };
  progress: {
    key: string;
    value: { instanceId: string; progress: Progress; revision: number };
  };
  settings: { key: string; value: unknown };
}

export class StorageError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'StorageError';
    this.code = code;
  }
}

const DB_NAME = 'rpg-travel';
let databasePromise: Promise<IDBPDatabase<TripDatabase>> | undefined;
let writeQueue: Promise<void> = Promise.resolve();
const pendingWrites = new Set<Promise<unknown>>();

function notice(code: string, message: string) {
  if (typeof window !== 'undefined')
    window.dispatchEvent(
      new CustomEvent('rpg-storage-notice', { detail: { code, message } }),
    );
}

export function storageError(error: unknown): StorageError {
  if (error instanceof StorageError) return error;
  const name =
    error instanceof Error || error instanceof DOMException ? error.name : '';
  if (name === 'QuotaExceededError')
    return new StorageError(
      'QUOTA_EXCEEDED',
      '本机存储空间不足，本次操作未保存。请先导出备份，再清理其他内容后重试。',
    );
  if (
    name === 'SecurityError' ||
    name === 'InvalidStateError' ||
    name === 'NotSupportedError'
  )
    return new StorageError(
      'STORAGE_UNAVAILABLE',
      '当前浏览器无法使用本机数据库。请检查隐私或存储设置，保留输入内容后重试。',
    );
  if (name === 'VersionError')
    return new StorageError(
      'DATABASE_VERSION',
      '本机数据来自更新版本。请更新应用后重试，不要清理站点数据。',
    );
  if (name === 'AbortError' || name === 'TransactionInactiveError')
    return new StorageError(
      'WRITE_ABORTED',
      '本次保存事务未完成，原有存档仍保留。请保留当前内容并重试或导出。',
    );
  return new StorageError(
    'STORAGE_FAILED',
    '本机读取或保存失败。请保留当前内容，重试或导出备份；不要清理站点数据。',
  );
}

function database(): Promise<IDBPDatabase<TripDatabase>> {
  if (!databasePromise) {
    databasePromise = new Promise<IDBPDatabase<TripDatabase>>(
      (resolve, reject) => {
        let blocked = false;
        if (typeof indexedDB === 'undefined') {
          reject(
            new StorageError(
              'STORAGE_UNAVAILABLE',
              '当前浏览器不支持本机数据库。请换用支持 IndexedDB 的浏览器；粘贴内容仍可复制保留。',
            ),
          );
          return;
        }
        const opening = openDB<TripDatabase>(DB_NAME, 1, {
          upgrade(db) {
            if (!db.objectStoreNames.contains('adventures'))
              db.createObjectStore('adventures', { keyPath: 'instanceId' });
            if (!db.objectStoreNames.contains('progress'))
              db.createObjectStore('progress', { keyPath: 'instanceId' });
            if (!db.objectStoreNames.contains('settings'))
              db.createObjectStore('settings');
          },
          blocked() {
            blocked = true;
            const error = new StorageError(
              'DATABASE_BLOCKED',
              '其他页面阻碍本机数据库升级。请关闭本应用的其他标签页，再点重试；现有数据不会被清理。',
            );
            notice(error.code, error.message);
            reject(error);
          },
          blocking() {
            void opening.then((db) => db.close());
            databasePromise = undefined;
            notice(
              'DATABASE_CHANGED',
              '另一个页面正在更新数据库。当前连接已安全关闭，请保存输入并重新打开页面。',
            );
          },
          terminated() {
            databasePromise = undefined;
            notice(
              'DATABASE_TERMINATED',
              '本机数据库连接已中断。请保留当前内容并重试，原有数据不会主动清理。',
            );
          },
        });
        void opening.then((db) => {
          if (blocked) db.close();
          else resolve(db);
        }, reject);
      },
    ).catch((error: unknown) => {
      databasePromise = undefined;
      throw storageError(error);
    });
  }
  return databasePromise;
}

function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const result = writeQueue.then(operation).catch((error: unknown) => {
    throw storageError(error);
  });
  pendingWrites.add(result);
  writeQueue = result.then(
    () => undefined,
    () => undefined,
  );
  void result.then(
    () => pendingWrites.delete(result),
    () => pendingWrites.delete(result),
  );
  return result;
}

export async function flushWrites(): Promise<void> {
  while (pendingWrites.size > 0) await Promise.all([...pendingWrites]);
}

async function commitTransaction<T>(
  transaction: { done: Promise<void>; abort(): void },
  operation: () => Promise<T>,
): Promise<T> {
  const done = transaction.done;
  void done.catch(() => undefined);
  try {
    const result = await operation();
    await done;
    return result;
  } catch (error) {
    // A synchronous failure (for example cloning or quota checks) must also roll
    // back any earlier request in this transaction.
    try {
      transaction.abort();
    } catch {
      /* Transaction may already be aborted. */
    }
    await done.catch(() => undefined);
    throw error;
  }
}

function checkedStored(
  record: AdventureRecord | undefined,
  state: TripDatabase['progress']['value'] | undefined,
): StoredAdventure | undefined {
  if (!record) {
    if (state)
      throw new StorageError(
        'CORRUPT_STORAGE',
        '本机进度缺少对应故事。请保留数据并从已导出的备份恢复。',
      );
    return undefined;
  }
  if (
    !state ||
    record.instanceId !== state.instanceId ||
    typeof record.rawReply !== 'string' ||
    !isIsoInstant(record.importedAt) ||
    !isIsoInstant(record.updatedAt) ||
    !Number.isSafeInteger(state.revision) ||
    state.revision < 0
  )
    throw new StorageError(
      'CORRUPT_STORAGE',
      '这份本机存档不完整。未自动重置或覆盖，请从已导出的备份恢复。',
    );
  const trip = validateTrip(record.data);
  if (!trip.success)
    throw new StorageError(
      'CORRUPT_STORAGE',
      `这份本机故事校验失败：${trip.errors[0].message} 未自动修改原数据。`,
    );
  const progress = validateProgress(trip.data, state.progress);
  if (!progress.success)
    throw new StorageError(
      'CORRUPT_PROGRESS',
      `这份本机进度校验失败：${progress.errors[0].message} 未自动清零，请从备份恢复。`,
    );
  return {
    ...record,
    data: trip.data,
    progress: progress.data,
    revision: state.revision,
  };
}

export async function listAdventures(): Promise<StoredAdventure[]> {
  try {
    const db = await database();
    const transaction = db.transaction(['adventures', 'progress']);
    return await commitTransaction(transaction, async () => {
      const [records, states] = await Promise.all([
        transaction.objectStore('adventures').getAll(),
        transaction.objectStore('progress').getAll(),
      ]);
      const stateMap = new Map(
        states.map((state) => [state.instanceId, state]),
      );
      return records
        .map(
          (record) => checkedStored(record, stateMap.get(record.instanceId))!,
        )
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    });
  } catch (error) {
    throw storageError(error);
  }
}

export async function getAdventure(
  instanceId: string,
): Promise<StoredAdventure | undefined> {
  try {
    const db = await database();
    const transaction = db.transaction(['adventures', 'progress']);
    return await commitTransaction(transaction, async () => {
      const [record, state] = await Promise.all([
        transaction.objectStore('adventures').get(instanceId),
        transaction.objectStore('progress').get(instanceId),
      ]);
      return checkedStored(record, state);
    });
  } catch (error) {
    throw storageError(error);
  }
}

export function createAdventure(
  data: RPGTrip,
  rawReply: string,
  progress: Progress | null = null,
): Promise<StoredAdventure> {
  // Clone before queuing so later edits in the UI cannot mutate a pending write.
  const trip = validateTrip(data);
  if (!trip.success)
    return Promise.reject(
      new StorageError('INVALID_STORY', trip.errors[0].message),
    );
  const checked = validateProgress(
    trip.data,
    progress ?? initialProgress(trip.data),
  );
  if (!checked.success)
    return Promise.reject(
      new StorageError('INVALID_PROGRESS', checked.errors[0].message),
    );
  const now = new Date().toISOString();
  const record: AdventureRecord = {
    instanceId: crypto.randomUUID(),
    importedAt: now,
    updatedAt: now,
    data: trip.data,
    rawReply,
  };
  return enqueue(async () => {
    const db = await database();
    const transaction = db.transaction(['adventures', 'progress'], 'readwrite');
    return commitTransaction(transaction, async () => {
      await transaction.objectStore('adventures').add(record);
      await transaction.objectStore('progress').add({
        instanceId: record.instanceId,
        progress: checked.data,
        revision: 0,
      });
      return { ...record, progress: checked.data, revision: 0 };
    });
  });
}

export function saveProgress(
  instanceId: string,
  progress: Progress,
  expectedRevision: number,
): Promise<StoredAdventure> {
  const captured: unknown = structuredClone(progress);
  return enqueue(async () => {
    const db = await database();
    const transaction = db.transaction(['adventures', 'progress'], 'readwrite');
    return commitTransaction(transaction, async () => {
      const [record, state] = await Promise.all([
        transaction.objectStore('adventures').get(instanceId),
        transaction.objectStore('progress').get(instanceId),
      ]);
      const existing = checkedStored(record, state);
      if (!existing)
        throw new StorageError(
          'MISSING_ADVENTURE',
          '这份冒险已被删除，请返回“我的冒险”重新选择。',
        );
      if (existing.revision !== expectedRevision)
        throw new StorageError(
          'STALE_PROGRESS',
          '另一页面已保存更新的进度。本次修改未覆盖它；请重新打开存档后继续，也可导出当前进度保留。',
        );
      const checked = validateProgress(existing.data, captured);
      if (!checked.success)
        throw new StorageError('INVALID_PROGRESS', checked.errors[0].message);
      const updated: AdventureRecord = {
        instanceId,
        importedAt: existing.importedAt,
        updatedAt: checked.data.updatedAt,
        data: existing.data,
        rawReply: existing.rawReply,
      };
      const revision = existing.revision + 1;
      await transaction
        .objectStore('progress')
        .put({ instanceId, progress: checked.data, revision });
      await transaction.objectStore('adventures').put(updated);
      return { ...updated, progress: checked.data, revision };
    });
  });
}

export function restartAdventure(
  instanceId: string,
  expectedRevision?: number,
): Promise<StoredAdventure> {
  return enqueue(async () => {
    const db = await database();
    const transaction = db.transaction(['adventures', 'progress'], 'readwrite');
    return commitTransaction(transaction, async () => {
      const [record, state] = await Promise.all([
        transaction.objectStore('adventures').get(instanceId),
        transaction.objectStore('progress').get(instanceId),
      ]);
      const existing = checkedStored(record, state);
      if (!existing)
        throw new StorageError('MISSING_ADVENTURE', '这份冒险已被删除。');
      if (
        expectedRevision !== undefined &&
        existing.revision !== expectedRevision
      )
        throw new StorageError(
          'STALE_PROGRESS',
          '另一页面已更新进度，请重新打开存档后再确认重开。',
        );
      const progress = initialProgress(existing.data);
      const updated = { ...record!, updatedAt: progress.updatedAt };
      const revision = existing.revision + 1;
      await transaction
        .objectStore('progress')
        .put({ instanceId, progress, revision });
      await transaction.objectStore('adventures').put(updated);
      return { ...updated, progress, revision };
    });
  });
}

export function deleteAdventure(instanceId: string): Promise<void> {
  return enqueue(async () => {
    const db = await database();
    const transaction = db.transaction(['adventures', 'progress'], 'readwrite');
    return commitTransaction(transaction, async () => {
      await transaction.objectStore('adventures').delete(instanceId);
      await transaction.objectStore('progress').delete(instanceId);
    });
  });
}

export async function getSetting<T>(key: string): Promise<T | undefined> {
  try {
    return (await (await database()).get('settings', key)) as T | undefined;
  } catch (error) {
    throw storageError(error);
  }
}

export function setSetting(key: string, value: unknown): Promise<void> {
  let captured: unknown;
  try {
    captured = structuredClone(value);
  } catch (error) {
    return Promise.reject(storageError(error));
  }
  return enqueue(async () => {
    const db = await database();
    const transaction = db.transaction('settings', 'readwrite');
    return commitTransaction(transaction, async () => {
      await transaction.store.put(captured, key);
    });
  });
}
