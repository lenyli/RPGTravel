import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { TripInput } from './protocol/prompt';
import type { RPGTrip } from './protocol/schema';
import {
  preparePhoto,
  validatePhotos,
  MAX_PHOTOS_PER_QUEST,
  MAX_PHOTOS_PER_ADVENTURE,
  type PhotoAttachment,
} from './domain/photos';
import {
  transitionProgress,
  type Progress,
  type ProgressAction,
} from './domain/progress';
import {
  createAdventure,
  deleteAdventure,
  flushWrites,
  getSetting,
  listAdventures,
  restartAdventure,
  saveProgress,
  savePhotos,
  setSetting,
  type StoredAdventure,
} from './storage/db';

export type Draft = { input: TripInput; raw: string };
const emptyDraft: Draft = {
  input: {
    destination: '',
    startDate: '',
    endDate: '',
    gameStyle: '塞尔达传说 / 巫师 3',
    interests: '',
    constraints: '',
  },
  raw: '',
};
type Pending = {
  record: StoredAdventure;
  next: Progress;
  photos?: PhotoAttachment[];
};
function useWorkspace() {
  const [records, setRecords] = useState<StoredAdventure[]>([]);
  const [draft, setDraftState] = useState<Draft>(emptyDraft);
  const draftRef = useRef(draft);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [draftStatus, setDraftStatus] = useState('');
  const [pending, setPendingState] = useState<Pending | null>(null);
  const pendingRef = useRef<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [updating, setUpdating] = useState(false);
  const updateGate = useRef(false);
  const gate = useRef(false);
  const dirty = useRef(false);
  const [lastId, setLastId] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const updateRecord = (record: StoredAdventure) =>
    setRecords((old) => [
      record,
      ...old.filter((r) => r.instanceId !== record.instanceId),
    ]);
  const setPending = (p: Pending | null) => {
    pendingRef.current = p;
    setPendingState(p);
  };
  const message = (e: unknown) =>
    e instanceof Error ? e.message : '本机数据未保存，请重试或导出备份。';
  const loadSequence = useRef(0);
  const load = async () => {
    const sequence = ++loadSequence.current;
    try {
      const [items, saved, last] = await Promise.all([
        listAdventures(),
        getSetting<Draft>('draft'),
        getSetting<string>('lastAdventure'),
      ]);
      if (sequence !== loadSequence.current) return;
      setRecords(items);
      const validDraft =
        saved &&
        typeof saved.raw === 'string' &&
        saved.input &&
        [
          'destination',
          'startDate',
          'endDate',
          'gameStyle',
          'interests',
          'constraints',
        ].every(
          (key) => typeof saved.input[key as keyof TripInput] === 'string',
        );
      if (validDraft && !dirty.current) {
        draftRef.current = saved;
        setDraftState(saved);
      }
      if (saved && !validDraft)
        setDraftStatus(
          '本机草稿格式无法读取，原数据未被删除；可以重新填写，冒险存档不受影响。',
        );
      setLastId(last || null);
      setReady(true);
      setError('');
      setPending(null);
    } catch (e) {
      if (sequence === loadSequence.current) setError(message(e));
    }
  };
  useEffect(() => {
    void load();
    const onNotice = (e: Event) =>
      setError((e as CustomEvent<{ message: string }>).detail.message);
    window.addEventListener('rpg-storage-notice', onNotice);
    return () => window.removeEventListener('rpg-storage-notice', onNotice);
  }, []);
  const saveDraft = async () => {
    clearTimeout(saveTimer.current);
    if (!dirty.current) return;
    const snapshot = draftRef.current;
    try {
      await setSetting('draft', snapshot);
      if (draftRef.current === snapshot) {
        dirty.current = false;
        setDraftStatus('草稿已保存到本机');
      }
    } catch (e) {
      setDraftStatus(`草稿未保存：${message(e)}`);
      throw e;
    }
  };
  const setDraft = (next: Draft) => {
    if (updateGate.current) return;
    draftRef.current = next;
    setDraftState(next);
    dirty.current = true;
    setDraftStatus('正在保存草稿…');
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void saveDraft().catch(() => {});
    }, 400);
  };
  useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (
        dirty.current ||
        pendingRef.current ||
        (gate.current && !updateGate.current)
      ) {
        e.preventDefault();
      }
    };
    const hidden = () => {
      if (document.visibilityState === 'hidden')
        void saveDraft().catch(() => {});
    };
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, []);
  const run = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    if (gate.current) return;
    gate.current = true;
    setBusy(true);
    setError('');
    try {
      return await fn();
    } catch (e) {
      setError(message(e));
      return undefined;
    } finally {
      gate.current = false;
      setBusy(false);
    }
  };
  const add = async (
    data: RPGTrip,
    raw: string,
    progress: Progress | null,
    photos: PhotoAttachment[] = [],
  ) =>
    run(async () => {
      const record = await createAdventure(data, raw, progress, photos);
      updateRecord(record);
      setNotice('冒险已保存到本机');
      return record;
    });
  const persistPhotos = async (
    record: StoredAdventure,
    photos: PhotoAttachment[],
  ) => {
    const checked = validatePhotos(record.data, photos);
    if (!checked.success) throw new Error(checked.errors[0].message);
    try {
      const saved = await savePhotos(
        record.instanceId,
        photos,
        record.revision,
      );
      updateRecord(saved);
      setNotice('照片手记已保存到本机');
      return saved;
    } catch (e) {
      setPending({ record, next: record.progress, photos });
      throw e;
    }
  };
  const addPhotos = async (
    record: StoredAdventure,
    questId: string,
    files: File[],
    caption: string,
  ) => {
    if (pendingRef.current) {
      setError('仍有未保存内容，请先重试保存或导出备份。');
      return;
    }
    return run(async () => {
      if (
        record.photos.length + files.length > MAX_PHOTOS_PER_ADVENTURE ||
        record.photos.filter((p) => p.questId === questId).length +
          files.length >
          MAX_PHOTOS_PER_QUEST
      ) {
        throw new Error(
          `每项任务最多 ${MAX_PHOTOS_PER_QUEST} 张照片，每份冒险最多 ${MAX_PHOTOS_PER_ADVENTURE} 张。请减少选择数量。`,
        );
      }
      const prepared: PhotoAttachment[] = [];
      for (const file of files)
        prepared.push(await preparePhoto(file, questId, caption));
      return persistPhotos(record, [...record.photos, ...prepared]);
    });
  };
  const changePhotos = async (
    record: StoredAdventure,
    photos: PhotoAttachment[],
  ) => {
    if (pendingRef.current) {
      setError('仍有未保存内容，请先重试保存或导出备份。');
      return;
    }
    return run(() => persistPhotos(record, photos));
  };
  const act = async (record: StoredAdventure, action: ProgressAction) => {
    if (pendingRef.current) {
      setError('仍有未保存进度，请先重试保存或导出备份。');
      return;
    }
    return run(async () => {
      const next = transitionProgress(record.data, record.progress, action);
      try {
        const saved = await saveProgress(
          record.instanceId,
          next,
          record.revision,
        );
        updateRecord(saved);
        setNotice('进度已保存到本机');
        return saved;
      } catch (e) {
        setPending({ record, next });
        throw e;
      }
    });
  };
  const retryPending = () =>
    run(async () => {
      const p = pendingRef.current;
      if (p) {
        const saved = p.photos
          ? await savePhotos(p.record.instanceId, p.photos, p.record.revision)
          : await saveProgress(p.record.instanceId, p.next, p.record.revision);
        updateRecord(saved);
        setPending(null);
        setNotice('未保存内容已写入本机');
      }
      await saveDraft();
    });
  const remove = (record: StoredAdventure) =>
    run(async () => {
      await deleteAdventure(record.instanceId);
      setRecords((old) =>
        old.filter((r) => r.instanceId !== record.instanceId),
      );
      if (lastId === record.instanceId) setLastId(null);
      setNotice('已删除指定冒险');
      return true;
    });
  const restart = (record: StoredAdventure) =>
    run(async () => {
      const saved = await restartAdventure(record.instanceId, record.revision);
      updateRecord(saved);
      setNotice('已重开，故事与照片手记保留');
      return saved;
    });
  const remember = (id: string) => {
    setLastId(id);
    void setSetting('lastAdventure', id).catch((e) => setError(message(e)));
  };
  const cancelUpdate = () => {
    updateGate.current = false;
    gate.current = false;
    setBusy(false);
    setUpdating(false);
  };
  const beforeUpdate = async () => {
    if (pendingRef.current || gate.current)
      throw new Error('请先保存未保存的进度，再更新应用。');
    updateGate.current = true;
    gate.current = true;
    setBusy(true);
    setUpdating(true);
    try {
      while (dirty.current) await saveDraft();
      await flushWrites();
    } catch (e) {
      cancelUpdate();
      throw e;
    }
  };
  return {
    records,
    draft,
    setDraft,
    ready,
    error,
    setError,
    notice,
    setNotice,
    draftStatus,
    pending,
    busy,
    updating,
    cancelUpdate,
    load,
    saveDraft,
    add,
    addPhotos,
    changePhotos,
    act,
    retryPending,
    remove,
    restart,
    remember,
    lastId,
    beforeUpdate,
  };
}
const Workspace = createContext<ReturnType<typeof useWorkspace> | null>(null);
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const state = useWorkspace();
  return <Workspace.Provider value={state}>{children}</Workspace.Provider>;
}
export function useApp() {
  const value = useContext(Workspace);
  if (!value) throw new Error('应用尚未初始化');
  return value;
}
