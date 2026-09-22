import { useRef, useState } from 'react';
import { useApp } from '../state';
import { progressSummary } from '../domain/progress';
import type { Issue } from '../protocol/validate';
import { MAX_ENVELOPE_BYTES } from '../protocol/extract';
import { parseImport, type ImportCandidate } from '../storage/backup';
import type { StoredAdventure } from '../storage/db';
import { ExportButton, Modal } from '../components/Common';

type Preview = Extract<ReturnType<typeof parseImport>, { success: true }>;

function visibleIssues(errors: Issue[]): string[] {
  const lines: string[] = [];
  for (const error of errors) {
    const message =
      error.code.includes('PHOTO') || error.message.includes('照片')
        ? '这是一份照片备份，请用原文件恢复。'
        : error.message;
    if (!lines.includes(message)) lines.push(message);
    if (lines.length === 4) break;
  }
  return lines;
}

export default function LibraryPage() {
  const app = useApp();
  const [confirm, setConfirm] = useState<{
    record: StoredAdventure;
    type: 'restart' | 'delete';
  } | null>(null);
  const [persist, setPersist] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [raw, setRaw] = useState('');
  const [errors, setErrors] = useState<Issue[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [storyOnly, setStoryOnly] = useState<Preview | null>(null);
  const [candidates, setCandidates] = useState<ImportCandidate[]>([]);
  const [duplicate, setDuplicate] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const preserve = async () => {
    try {
      if (!navigator.storage?.persist) {
        setPersist('此浏览器不支持保留申请，请通过导出文件备份。');
        return;
      }
      const result = await navigator.storage.persist();
      setPersist(
        result
          ? '浏览器已批准保留本机数据；仍建议导出文件备份。'
          : '浏览器未批准保留请求，现有内容仍在本机；请定期导出备份。',
      );
    } catch {
      setPersist('无法申请保留数据，请使用导出备份。');
    }
  };
  const openImport = () => {
    setImportOpen(true);
    setRaw('');
    setErrors([]);
    setPreview(null);
    setStoryOnly(null);
    setCandidates([]);
    setDuplicate(false);
  };
  const closeImport = () => {
    if (app.busy) return;
    setImportOpen(false);
    setPreview(null);
    setDuplicate(false);
    setCandidates([]);
  };
  const existing = preview
    ? app.records.find((record) => JSON.stringify(record.data) === JSON.stringify(preview.data))
    : undefined;
  const personalBackup = raw.includes('"RPG_TRIP_SAVE"') || raw.includes('data:image/');
  const readImport = (text: string) => {
    setRaw(text);
    setCandidates([]);
    setDuplicate(false);
    const result = parseImport(text);
    if (result.success) {
      setPreview(result);
      setErrors([]);
      setStoryOnly(null);
    } else {
      setPreview(null);
      setErrors(result.candidates?.length ? [] : result.errors);
      setCandidates(result.candidates ?? []);
      setStoryOnly(result.storyOnly || null);
    }
  };
  const readFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_ENVELOPE_BYTES) {
      setErrors([
        {
          code: 'INPUT_TOO_LARGE',
          path: '$',
          message: `文件超过 ${MAX_ENVELOPE_BYTES / 1024 / 1024} MiB，请选择单个冒险备份。`,
        },
      ]);
      setPreview(null);
      return;
    }
    try {
      readImport(await file.text());
    } catch {
      setErrors([
        {
          code: 'FILE_READ_FAILED',
          path: '$',
          message: '文件未能读取，请重新选择，或把内容粘贴到下方。',
        },
      ]);
      setPreview(null);
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };
  const saveImport = async () => {
    if (!preview || app.busy) return;
    if (existing && !duplicate) {
      setDuplicate(true);
      return;
    }
    const record = await app.add(
      preview.data,
      preview.rawReply,
      preview.progress,
      preview.photos,
    );
    if (record) {
      app.remember(record.instanceId);
      setImportOpen(false);
      setPreview(null);
      location.hash = `/quest/${record.instanceId}`;
    }
  };
  const execute = async () => {
    if (!confirm) return;
    const result =
      confirm.type === 'restart'
        ? await app.restart(confirm.record)
        : await app.remove(confirm.record);
    if (result) setConfirm(null);
  };
  return (
    <div className="library-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">每一次出发，都有自己的篇章</p>
          <h1>我的冒险</h1>
        </div>
        <div className="heading-actions">
          <button className="button secondary" type="button" onClick={openImport}>
            导入冒险
          </button>
          <a className="button primary" href="#/">
            ＋ 创建新冒险
          </a>
        </div>
      </div>
      <p className="muted">
        内容保存在当前浏览器 /
        当前设备；清理站点数据或更换浏览器可能丢失，请导出备份。
      </p>
      {app.records.length === 0 ? (
        <div className="empty-state panel">
          <span aria-hidden="true">⌁</span>
          <h2>你的故事，从下一次出发开始</h2>
          <p>填写旅行信息，把 AI 生成的完整回答带回来。</p>
          <div className="heading-actions">
            <button className="button secondary" type="button" onClick={openImport}>
              导入冒险
            </button>
            <a className="button primary" href="#/">
              去创建冒险
            </a>
          </div>
        </div>
      ) : (
        <div className="library-grid">
          {app.records.map((record) => {
            const summary = progressSummary(record.data, record.progress);
            return (
              <article className="panel library-card" key={record.instanceId}>
                <p className="eyebrow">
                  {summary.isFinished ? '已收束的故事' : '进行中的旅程'}
                </p>
                <a
                  className="library-main"
                  href={`#/quest/${record.instanceId}`}
                  onClick={() => app.remember(record.instanceId)}
                >
                  <h2>{record.data.adventure.title}</h2>
                  <p>{record.data.adventure.destination}</p>
                  <p className="small muted">
                    {record.data.adventure.startDate &&
                    record.data.adventure.endDate
                      ? `${record.data.adventure.startDate} — ${record.data.adventure.endDate}`
                      : '日期未提供'}
                  </p>
                  <div className="progress-track">
                    <span
                      style={{
                        width: `${(summary.resolved / summary.total) * 100}%`,
                      }}
                    />
                  </div>
                  <p className="progress-label">
                    {summary.resolved} / {summary.total} 节已解决 ·{' '}
                    {summary.completed} 完成 · {summary.skipped} 跳过
                  </p>
                </a>
                <a
                  className="button primary full"
                  href={`#/quest/${record.instanceId}`}
                  onClick={() => app.remember(record.instanceId)}
                >
                  继续冒险 →
                </a>
                <div className="export-actions">
                  <ExportButton
                    data={record.data}
                    progress={record.progress}
                    photos={record.photos}
                  >
                    导出完整存档
                  </ExportButton>
                  <ExportButton data={record.data} progress={null}>
                    导出故事
                  </ExportButton>
                </div>
                <div className="library-actions">
                  <button
                    className="text-button"
                    disabled={app.busy || !!app.pending}
                    onClick={() => setConfirm({ record, type: 'restart' })}
                  >
                    重开
                  </button>
                  <button
                    className="text-button danger"
                    disabled={app.busy || !!app.pending}
                    onClick={() => setConfirm({ record, type: 'delete' })}
                  >
                    删除
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
      <section className="storage-note">
        <h2>给冒险留一份副本</h2>
        <p>
          导出完整存档可保留勾选、线索和照片手记；导出故事仅分享剧本，不含你的照片。用「导入冒险」可以恢复这两种文件，也可以粘贴故事正文或旧 JSON。恢复总会创建新存档，不覆盖原来的进度。
        </p>
        <button className="secondary" onClick={() => void preserve()}>
          请求保留本机数据
        </button>
        {persist && <p role="status">{persist}</p>}
      </section>
      {importOpen && (
        <Modal
          title={duplicate ? '这段故事已在本机' : preview ? '确认导入' : '导入冒险'}
          close={closeImport}
        >
          {!preview && candidates.length === 0 && (
            <>
              <p>
                可以选择本机保存的完整存档、故事文件，或粘贴 AI 的故事正文和已有 JSON。
              </p>
              <button
                className="secondary full"
                type="button"
                onClick={() => fileRef.current?.click()}
              >
                选择文件
              </button>
              <input
                ref={fileRef}
                type="file"
                className="sr-only"
                aria-label="选择冒险文件"
                accept=".json,.rpgtrip,.txt,application/json,text/plain"
                onChange={(e) => void readFile(e.target.files?.[0])}
              />
              <label>
                或粘贴内容
                <textarea
                  rows={8}
                  value={raw}
                  placeholder="故事正文、JSON，或导出的存档内容"
                  onChange={(e) => {
                    setRaw(e.target.value);
                    setErrors([]);
                    setStoryOnly(null);
                  }}
                />
              </label>
              <button
                className="primary full"
                type="button"
                disabled={!raw.trim()}
                onClick={() => readImport(raw)}
              >
                读取并预览
              </button>
            </>
          )}
          {candidates.length > 0 && (
            <>
              <p>这份内容里有多份故事，请选择要导入的一份。</p>
              {candidates.map((candidate, index) => (
                <button
                  key={index}
                  className="secondary full"
                  type="button"
                  onClick={() => readImport(candidate.raw)}
                >
                  第 {index + 1} 份 · {candidate.title}
                </button>
              ))}
            </>
          )}
          {errors.length > 0 && (
            <div className="error-panel" role="alert">
              <h3>{personalBackup ? '这份备份未能恢复' : '这份内容还不能导入'}</h3>
              {visibleIssues(errors).map((message) => (
                <p key={message}>{message}</p>
              ))}
              {storyOnly && (
                <button
                  className="secondary"
                  type="button"
                  onClick={() => {
                    setPreview(storyOnly);
                    setStoryOnly(null);
                    setErrors([]);
                  }}
                >
                  只导入故事，重新开始
                </button>
              )}
            </div>
          )}
          {preview && (
            <>
              <p className="eyebrow">
                {preview.progress ? '恢复完整存档' : '导入故事'}
              </p>
              <h3 className="preview-title">{preview.data.adventure.title}</h3>
              <p>
                {preview.data.quests.length} 个地点 ·{' '}
                {preview.data.quests.reduce(
                  (total, quest) => total + quest.objectives.length,
                  0,
                )}{' '}
                项行动 ·{' '}
                {preview.data.adventure.endingText.trim() ? '已包含结局' : '尚缺结局'}
              </p>
              <p>
                {preview.data.adventure.destination || '未提供目的地'}
                {preview.photos.length > 0
                  ? ` · 含 ${preview.photos.length} 张照片`
                  : ''}
              </p>
              {preview.warnings.slice(0, 4).map((warning) => (
                <p className="warning-text" key={warning}>
                  {warning}
                </p>
              ))}
              {app.error && (
                <p className="error-panel" role="alert">
                  {app.error}
                </p>
              )}
              <div className="stack">
                {duplicate && existing ? (
                  <>
                    <button
                      className="primary"
                      type="button"
                      onClick={() => {
                        app.remember(existing.instanceId);
                        location.hash = `/quest/${existing.instanceId}`;
                      }}
                    >
                      打开已有存档
                    </button>
                    <button
                      className="secondary"
                      type="button"
                      disabled={app.busy}
                      onClick={() => void saveImport()}
                    >
                      另存一份
                    </button>
                  </>
                ) : (
                  <button
                    className="primary"
                    type="button"
                    disabled={app.busy}
                    onClick={() => void saveImport()}
                  >
                    {app.busy ? '正在保存…' : '保存并开始'}
                  </button>
                )}
                <button
                  className="text-button"
                  type="button"
                  disabled={app.busy}
                  onClick={() => {
                    setPreview(null);
                    setDuplicate(false);
                  }}
                >
                  返回
                </button>
              </div>
            </>
          )}
        </Modal>
      )}
      {confirm && (
        <Modal
          title={
            confirm.type === 'restart' ? '重开这段冒险？' : '删除这段冒险？'
          }
          close={() => {
            if (!app.busy) setConfirm(null);
          }}
        >
          <h3>{confirm.record.data.adventure.title}</h3>
          <p>
            {confirm.type === 'restart'
              ? '这会清除该存档的所有行动进度，保留原故事与照片手记。其他冒险不受影响。'
              : '这会删除该存档的故事、进度和照片手记。其他冒险不受影响，建议先导出完整备份。'}
          </p>
          {app.error && (
            <p role="alert" className="error-panel">
              {app.error}
            </p>
          )}
          <div className="stack">
            <button
              className="secondary"
              disabled={app.busy}
              onClick={() => setConfirm(null)}
            >
              取消
            </button>
            <button
              className="primary"
              disabled={app.busy}
              onClick={() => void execute()}
            >
              {confirm.type === 'restart' ? '确认重开' : '确认删除'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
