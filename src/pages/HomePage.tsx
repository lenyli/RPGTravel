import { useMemo, useRef, useState } from 'react';
import { useApp } from '../state';
import {
  createGenerationPrompt,
  createRepairPrompt,
  validateTripInput,
  type TripInput,
} from '../protocol/prompt';
import type { Issue } from '../protocol/validate';
import { parseImport } from '../storage/backup';
import { MAX_ENVELOPE_BYTES } from '../protocol/extract';
import { CopyButton, Compass, Modal } from '../components/Common';

type Preview = Extract<ReturnType<typeof parseImport>, { success: true }>;
export default function HomePage() {
  const app = useApp();
  const { input, raw } = app.draft;
  const inputErrors = useMemo(() => validateTripInput(input), [input]);
  const prompt = useMemo(() => createGenerationPrompt(input), [input]);
  const [errors, setErrors] = useState<Issue[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [storyOnly, setStoryOnly] = useState<Preview | null>(null);
  const [duplicate, setDuplicate] = useState(false);
  const [showFormErrors, setShowFormErrors] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const personalBackup =
    raw.includes('"RPG_TRIP_SAVE"') || raw.includes('data:image/');
  const existing = preview
    ? app.records.find(
        (r) => JSON.stringify(r.data) === JSON.stringify(preview.data),
      )
    : undefined;
  const last = app.records.find((r) => r.instanceId === app.lastId);
  const field = (key: keyof TripInput, value: string) =>
    app.setDraft({ input: { ...input, [key]: value }, raw });
  const importRaw = (text = raw) => {
    const result = parseImport(text);
    if (result.success) {
      setPreview(result);
      setErrors([]);
      setStoryOnly(null);
      setDuplicate(false);
    } else {
      setErrors(result.errors);
      setPreview(null);
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
      return;
    }
    try {
      const content = await file.text();
      app.setDraft({ input, raw: content });
      importRaw(content);
    } catch {
      setErrors([
        {
          code: 'FILE_READ_FAILED',
          path: '$',
          message: '文件未能读取，请重新选择，或把文件内容粘贴到下方。',
        },
      ]);
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };
  const save = async () => {
    if (!preview) return;
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
      if (preview.photos.length) app.setDraft({ input, raw: preview.rawReply });
      app.remember(record.instanceId);
      location.hash = `/quest/${record.instanceId}`;
    }
  };
  return (
    <fieldset className="home-page page-fieldset" disabled={app.updating}>
      <section className="hero">
        <div>
          <p className="eyebrow">一段旅途 · 一场属于你的冒险</p>
          <h1>
            把下一段旅程，
            <br />
            变成一段故事。
          </h1>
          <p className="hero-copy">
            让一封信带你转过街角，让一条线索牵起沿途风景。
            <br className="desktop-only" />
            带上好奇心，故事从你要去的地方开始。
          </p>
        </div>
        <div className="hero-art" aria-hidden="true">
          <span className="orbit orbit-one" />
          <span className="orbit orbit-two" />
          <Compass />
          <span className="art-caption">FOLLOW YOUR CURIOSITY</span>
        </div>
      </section>
      {last && (
        <a className="continue-strip" href={`#/quest/${last.instanceId}`}>
          继续上次冒险 <strong>{last.data.adventure.title}</strong>
          <span aria-hidden="true">↗</span>
        </a>
      )}
      <div className="home-grid">
        <section className="panel form-panel">
          <div className="section-heading">
            <span className="step-number">01</span>
            <div>
              <h2>写下你的旅行</h2>
              <p className="muted">按地点生成独立任务，不绑定固定行程</p>
            </div>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setShowFormErrors(true);
            }}
          >
            <label>
              目的地 / 游览范围 <span className="required">必填</span>
              <input
                name="destination"
                required
                maxLength={2000}
                placeholder="例如：一座旧城、一段山路，或一片街区"
                value={input.destination}
                onChange={(e) => field('destination', e.target.value)}
              />
            </label>
            <p className="small muted">
              旅行日期用于了解季节与开放信息，不会把任务锁在某天或某条路线。
            </p>
            <div className="date-fields">
              <label>
                开始日期
                <input
                  name="startDate"
                  type="date"
                  required
                  value={input.startDate}
                  onChange={(e) => field('startDate', e.target.value)}
                />
              </label>
              <label>
                结束日期
                <input
                  name="endDate"
                  type="date"
                  required
                  min={input.startDate || undefined}
                  value={input.endDate}
                  onChange={(e) => field('endDate', e.target.value)}
                />
              </label>
            </div>
            <label>
              喜欢的游戏风格 <span className="optional">选填</span>
              <input
                name="gameStyle"
                value={input.gameStyle}
                maxLength={2000}
                onChange={(e) => field('gameStyle', e.target.value)}
              />
            </label>
            <label>
              兴趣 <span className="optional">选填</span>
              <input
                name="interests"
                maxLength={4000}
                placeholder="历史、建筑、艺术、当地生活…"
                value={input.interests}
                onChange={(e) => field('interests', e.target.value)}
              />
            </label>
            <label>
              旅行限制 / 补充 <span className="optional">选填</span>
              <textarea
                name="constraints"
                rows={3}
                maxLength={20000}
                placeholder="住宿、预约、必去或不去的地方、交通和体力安排"
                value={input.constraints}
                onChange={(e) => field('constraints', e.target.value)}
              />
            </label>
            {inputErrors.length ? (
              <>
                <button
                  className="primary full"
                  type="submit"
                  onClick={() => setShowFormErrors(true)}
                >
                  复制生成 Prompt <span aria-hidden="true">↗</span>
                </button>
                {showFormErrors && (
                  <div role="alert" className="error-panel">
                    {inputErrors.map((e) => (
                      <p key={e.path}>{e.message}</p>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <CopyButton
                className="primary full"
                text={prompt}
                success="已复制，发给你常用的 AI 即可"
              >
                复制生成 Prompt <span aria-hidden="true">↗</span>
              </CopyButton>
            )}
            <details className="prompt-preview">
              <summary>
                查看 Prompt{' '}
                <span className="muted">
                  约 {prompt.length.toLocaleString()} 字符
                </span>
              </summary>
              <textarea
                aria-label="生成 Prompt 预览"
                value={prompt}
                rows={10}
                readOnly
              />
            </details>
          </form>
          <p className="local-save" role="status">
            {app.draftStatus ||
              '旅行资料仅在本机保存，复制后由你交给自己的 AI。'}
          </p>
          {app.draftStatus.includes('未保存') && (
            <button
              className="secondary"
              onClick={() => void app.saveDraft().catch(() => {})}
            >
              重试保存草稿
            </button>
          )}
        </section>
        <div className="right-column">
          <section className="panel import-panel">
            <div className="section-heading">
              <span className="step-number">02</span>
              <div>
                <h2>把 AI 的回答粘贴回来</h2>
                <p className="muted">完整复制即可，故事会在这里展开</p>
              </div>
            </div>
            <label className="sr-only" htmlFor="raw-reply">
              AI 的完整回答
            </label>
            <textarea
              id="raw-reply"
              className="reply-input"
              rows={9}
              value={raw}
              placeholder="在这里粘贴 AI 的整条回答…"
              onChange={(e) => {
                app.setDraft({ input, raw: e.target.value });
                setErrors([]);
                setStoryOnly(null);
              }}
            />
            <button
              className="primary full"
              disabled={!raw.trim()}
              onClick={() => importRaw()}
            >
              生成我的冒险 <span aria-hidden="true">→</span>
            </button>
            <button
              className="text-button"
              onClick={() => fileRef.current?.click()}
            >
              ↥ 从文件恢复
            </button>
            <input
              ref={fileRef}
              type="file"
              className="sr-only"
              aria-label="选择冒险备份文件"
              accept=".json,.rpgtrip,application/json"
              onChange={(e) => void readFile(e.target.files?.[0])}
            />
            {errors.length > 0 && (
              <div className="error-panel" role="alert">
                <h3>
                  {personalBackup ? '这份备份未能恢复' : '这份回答需要修正'}
                </h3>
                {errors.slice(0, 6).map((e, i) => (
                  <p key={i}>
                    {e.message}
                    <small>
                      {e.code} · {e.path}
                    </small>
                  </p>
                ))}
                {errors.length > 6 && (
                  <p>
                    还有 {errors.length - 6} 项，修复 Prompt 会包含全部错误。
                  </p>
                )}
                {!personalBackup && (
                  <CopyButton text={createRepairPrompt(raw, errors)}>
                    复制修复 Prompt
                  </CopyButton>
                )}
                {storyOnly && (
                  <button
                    className="secondary"
                    onClick={() => {
                      setPreview(storyOnly);
                      setStoryOnly(null);
                      setErrors([]);
                    }}
                  >
                    只导入故事，重新开始
                  </button>
                )}
                <p className="muted">
                  {personalBackup
                    ? '请重新选择完整备份文件。照片和私人存档不需要交给 AI 修复；仅导入故事会放弃这份文件中的进度和照片，原有存档不受影响。'
                    : '原始回答已保留。把修复提示交给原来的 AI，取得完整回答后再试。'}
                </p>
              </div>
            )}
          </section>
          <aside className="field-note">
            <div className="note-symbol" aria-hidden="true">
              ✳
            </div>
            <h3>把注意力留给路上的发现</h3>
            <p>
              不需要账号，也没有 AI
              接口。导入故事后，线索、地点与进度都能离线随身带走。
            </p>
            <div className="note-rule" />
            <p className="small">
              内容保存在当前浏览器 /
              当前设备；清理站点数据或更换浏览器可能丢失，请导出备份。
            </p>
          </aside>
        </div>
      </div>
      {preview && (
        <Modal
          title={duplicate ? '这段故事已在本机' : '你的冒险准备好了'}
          close={() => {
            if (!app.busy) {
              setPreview(null);
              setDuplicate(false);
            }
          }}
        >
          <p className="eyebrow">
            {preview.progress ? '恢复完整存档' : '故事预览'}
          </p>
          <h3 className="preview-title">{preview.data.adventure.title}</h3>
          <p>{preview.data.adventure.subtitle}</p>
          <dl className="preview-meta">
            <div>
              <dt>目的地</dt>
              <dd>{preview.data.adventure.destination}</dd>
            </div>
            <div>
              <dt>旅行日期</dt>
              <dd>
                {preview.data.adventure.startDate} —{' '}
                {preview.data.adventure.endDate}
              </dd>
            </div>
            <div>
              <dt>旅途篇幅</dt>
              <dd>
                {preview.data.chapters.length} 章 · {preview.data.quests.length}{' '}
                项调查
              </dd>
            </div>
          </dl>
          {preview.photos.length > 0 && (
            <p className="success">
              随存档恢复 {preview.photos.length} 张任务照片。
            </p>
          )}
          <p className="success">
            格式检查通过，尚有 {preview.data.adventure.verificationNotes.length}{' '}
            条出行信息待核验。
          </p>
          {preview.data.adventure.verificationNotes.map((n, i) => (
            <p className="warning-text" key={i}>
              {n}
            </p>
          ))}
          {preview.warnings.map((n, i) => (
            <p className="muted" key={i}>
              {n}
            </p>
          ))}
          <p className="small muted">
            这不代表地点、历史或行程已核实。各地点可按任意顺序调查，线索和结局会随你的行动揭露。
          </p>
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
                  onClick={() => {
                    app.remember(existing.instanceId);
                    location.hash = `/quest/${existing.instanceId}`;
                  }}
                >
                  打开已有存档
                </button>
                <button
                  className="secondary"
                  disabled={app.busy}
                  onClick={() => void save()}
                >
                  另存一份
                </button>
              </>
            ) : (
              <button
                className="primary"
                disabled={app.busy}
                onClick={() => void save()}
              >
                {app.busy ? '正在保存…' : '保存并开始'}
              </button>
            )}
            <button
              className="text-button"
              disabled={app.busy}
              onClick={() => setPreview(null)}
            >
              取消
            </button>
          </div>
        </Modal>
      )}
    </fieldset>
  );
}
