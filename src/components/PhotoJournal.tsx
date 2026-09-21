import { useEffect, useRef, useState } from 'react';
import type { StoredAdventure } from '../storage/db';
import { useApp } from '../state';
import {
  MAX_PHOTO_CAPTION,
  MAX_PHOTOS_PER_QUEST,
  MAX_PHOTOS_PER_ADVENTURE,
} from '../domain/photos';
import { Modal } from './Common';

export default function PhotoJournal({
  record,
  initialQuestId,
}: {
  record: StoredAdventure;
  initialQuestId?: string;
}) {
  const app = useApp();
  const [questId, setQuestId] = useState(
    initialQuestId ||
      record.progress.currentQuestId ||
      record.data.quests[0].id,
  );
  const [caption, setCaption] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editCaption, setEditCaption] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [status, setStatus] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const retryFiles = useRef<{
    files: File[];
    questId: string;
    caption: string;
  } | null>(null);
  const [canRetry, setCanRetry] = useState(false);
  const pendingRevision = useRef<number | null>(null);
  useEffect(() => {
    if (
      app.pending?.photos &&
      app.pending.record.instanceId === record.instanceId
    ) {
      pendingRevision.current = app.pending.record.revision;
    } else if (
      !app.pending &&
      pendingRevision.current !== null &&
      record.revision > pendingRevision.current
    ) {
      pendingRevision.current = null;
      retryFiles.current = null;
      setCanRetry(false);
      setCaption('');
      setStatus('照片手记已保存到本机。');
    }
  }, [app.pending, record.instanceId, record.revision]);
  const disabled = app.busy || !!app.pending;
  const quest =
    record.data.quests.find((q) => q.id === questId) || record.data.quests[0];
  const photos = record.photos.filter((p) => p.questId === quest.id);
  const selected = record.photos.find((p) => p.id === selectedId);
  const upload = async (selection: {
    files: File[];
    questId: string;
    caption: string;
  }) => {
    if (!selection.files.length || disabled) return;
    retryFiles.current = selection;
    setCanRetry(false);
    setStatus('正在处理照片并保存到本机…');
    const saved = await app.addPhotos(
      record,
      selection.questId,
      selection.files,
      selection.caption,
    );
    if (saved) {
      setStatus(`已保存 ${selection.files.length} 张照片，仅保存在本机。`);
      setCaption('');
      retryFiles.current = null;
    } else {
      setStatus('照片尚未保存。请查看页面提示，重试保存或重新选择文件。');
      setCanRetry(true);
    }
  };
  const saveCaption = async () => {
    if (!selected) return;
    const saved = await app.changePhotos(
      record,
      record.photos.map((p) =>
        p.id === selected.id ? { ...p, caption: editCaption.trim() } : p,
      ),
    );
    if (saved) setStatus('照片说明已保存。');
  };
  const remove = async () => {
    if (!selected) return;
    const saved = await app.changePhotos(
      record,
      record.photos.filter((p) => p.id !== selected.id),
    );
    if (saved) {
      setSelectedId(null);
      setDeleting(false);
      setStatus('已删除这张照片，任务进度没有改变。');
    }
  };
  return (
    <section className="photo-journal" aria-label="任务照片手记">
      <div className="panel photo-form">
        <div className="section-heading">
          <div>
            <p className="eyebrow">把旅途留在这一页</p>
            <h2>照片手记</h2>
          </div>
        </div>
        <p>
          随时为地点留下照片，不必等任务完成。照片只存在当前设备，导出完整存档时会一并保存。
        </p>
        <fieldset className="page-fieldset" disabled={disabled}>
          <label>
            关联任务
            <select
              value={quest.id}
              onChange={(e) => {
                setQuestId(e.target.value);
                setStatus('');
              }}
            >
              {record.data.quests.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.location.name} · {q.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            照片说明（选填）
            <textarea
              rows={3}
              value={caption}
              maxLength={MAX_PHOTO_CAPTION}
              placeholder="照片里的细节、当时的发现……"
              onChange={(e) => setCaption(e.target.value)}
            />
          </label>
          <button
            className="primary"
            onClick={() => inputRef.current?.click()}
            disabled={
              disabled ||
              photos.length >= MAX_PHOTOS_PER_QUEST ||
              record.photos.length >= MAX_PHOTOS_PER_ADVENTURE
            }
          >
            ＋ 添加照片
          </button>
          <input
            ref={inputRef}
            type="file"
            className="sr-only"
            aria-label="选择任务照片"
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
            multiple
            onChange={(e) => {
              const files = Array.from(e.target.files || []);
              e.target.value = '';
              void upload({ files, questId: quest.id, caption });
            }}
          />
        </fieldset>
        <p className="small muted">
          本任务 {photos.length}/{MAX_PHOTOS_PER_QUEST} 张 · 本次冒险{' '}
          {record.photos.length}/{MAX_PHOTOS_PER_ADVENTURE}{' '}
          张。照片会压缩保存，不保留原图中的位置等信息；请另存原片。
        </p>
        {status && (
          <p role="status" className="small">
            {status}
          </p>
        )}
        {canRetry && !app.pending && (
          <button
            className="secondary"
            disabled={app.busy}
            onClick={() => {
              if (retryFiles.current) void upload(retryFiles.current);
            }}
          >
            重试保存照片
          </button>
        )}
      </div>
      {photos.length ? (
        <div className="photo-grid">
          {photos.map((photo, index) => (
            <figure className="photo-card" key={photo.id}>
              <button
                className="photo-open"
                aria-label={`查看照片：${photo.caption || `${quest.title} · 照片 ${index + 1}`}`}
                onClick={() => {
                  setSelectedId(photo.id);
                  setEditCaption(photo.caption);
                  setDeleting(false);
                }}
              >
                <img
                  src={photo.dataUrl}
                  alt={
                    photo.caption ||
                    `${quest.location.name}的任务照片 ${index + 1}`
                  }
                  loading="lazy"
                />
                <span className="photo-caption">
                  {photo.caption || '为这一刻添加说明'}
                </span>
                <span className="small muted">
                  {new Date(photo.createdAt).toLocaleString()}
                </span>
              </button>
            </figure>
          ))}
        </div>
      ) : (
        <div className="empty-state photo-empty">
          <span aria-hidden="true">▧</span>
          <h3>这一页，还等着你的风景</h3>
          <p>添加照片后会归入“{quest.title}”，可以随时回看。</p>
        </div>
      )}
      {selected && (
        <Modal
          title={deleting ? '删除这张照片？' : '照片预览'}
          close={() => {
            if (!app.busy) {
              setSelectedId(null);
              setDeleting(false);
            }
          }}
        >
          <img
            className="photo-full"
            src={selected.dataUrl}
            alt={selected.caption || '任务照片'}
          />
          {deleting ? (
            <>
              <p>
                只删除本存档中的这张照片，不影响原相册或任务进度。可先导出完整存档留备份。
              </p>
              <div className="button-row">
                <button
                  className="secondary"
                  disabled={disabled}
                  onClick={() => setDeleting(false)}
                >
                  取消删除
                </button>
                <button
                  className="primary"
                  disabled={disabled}
                  onClick={() => void remove()}
                >
                  确认删除照片
                </button>
              </div>
            </>
          ) : (
            <>
              <label>
                编辑照片说明
                <textarea
                  rows={3}
                  value={editCaption}
                  maxLength={MAX_PHOTO_CAPTION}
                  disabled={disabled}
                  onChange={(e) => setEditCaption(e.target.value)}
                />
              </label>
              <div className="button-row">
                <button
                  className="primary"
                  disabled={disabled}
                  onClick={() => void saveCaption()}
                >
                  保存说明
                </button>
                <button
                  className="secondary danger"
                  disabled={disabled}
                  onClick={() => setDeleting(true)}
                >
                  删除照片
                </button>
              </div>
            </>
          )}
          {app.error && (
            <p className="error-panel" role="alert">
              {app.error}
            </p>
          )}
          {status && (
            <p role="status" className="small">
              {status}
            </p>
          )}
        </Modal>
      )}
    </section>
  );
}
