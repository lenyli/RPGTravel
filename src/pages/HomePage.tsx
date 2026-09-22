import { useEffect, useMemo, useRef, useState } from 'react';
import { DeepSeekError, generateWithDeepSeek } from '../ai/deepseek';
import { useApp } from '../state';
import {
  applyRequestSnapshot,
  createGenerationPrompt,
  createRepairPrompt,
  validateTripInput,
  type TripInput,
} from '../protocol/prompt';
import {
  loadAiSettings,
  maskApiKey,
  saveAiSettings,
  type AiSettings,
} from '../storage/settings';
import type { Issue } from '../protocol/validate';
import { parseImport, type ImportCandidate } from '../storage/backup';
import { MAX_ENVELOPE_BYTES } from '../protocol/extract';
import { CopyButton, Compass, Modal } from '../components/Common';

type Preview = Extract<ReturnType<typeof parseImport>, { success: true }>;

function humanIssues(errors: Issue[]): string[] {
  const lines: string[] = [];
  for (const error of errors) {
    const message = humanIssue(error);
    if (!lines.includes(message)) lines.push(message);
    if (lines.length === 4) break;
  }
  return lines;
}

function humanIssue(error: Issue): string {
  if (
    error.code.includes('PHOTO') ||
    error.message.includes('照片备份') ||
    error.message.includes('私人照片')
  )
    return '这是一份照片备份，请用原文件恢复。';
  if (
    error.code === 'INVALID_JSON' ||
    /停在|未闭合|半句/.test(error.message)
  )
    return '回复似乎停在半句话。原文已保留，可以检查后再导入。';
  if (
    /objectives|quests/.test(error.path) ||
    /行动列表|没有识别到地点|没有识别到行动/.test(error.message)
  )
    return '没有识别到行动列表。';
  return error.message;
}

function actionCount(preview: Preview): number {
  return preview.data.quests.reduce(
    (total, quest) => total + quest.objectives.length,
    0,
  );
}

function isImportantWarning(warning: string): boolean {
  return /尚缺结局|引号|标点|不完整|1\.0|关联不确定|未关联|坐标|待核验|没有执行|疑似/.test(
    warning,
  );
}

function importantWarnings(warnings: string[]): string[] {
  return [...new Set(warnings.filter(isImportantWarning))];
}

function hasRoutineWarning(warnings: string[]): boolean {
  return warnings.some((warning) => !isImportantWarning(warning));
}

function needsSnapshot(preview: Preview): boolean {
  const adventure = preview.data.adventure;
  return (
    !adventure.destination ||
    adventure.destination === '未提供目的地' ||
    !adventure.startDate ||
    !adventure.endDate
  );
}

export default function HomePage() {
  const app = useApp();
  const { input, raw } = app.draft;
  const inputErrors = useMemo(() => validateTripInput(input), [input]);
  const prompt = useMemo(() => createGenerationPrompt(input), [input]);
  const [errors, setErrors] = useState<Issue[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [storyOnly, setStoryOnly] = useState<Preview | null>(null);
  const [candidates, setCandidates] = useState<ImportCandidate[]>([]);
  const [repairRaw, setRepairRaw] = useState(raw);
  const [duplicate, setDuplicate] = useState(false);
  const [showFormErrors, setShowFormErrors] = useState(false);
  const [ai, setAi] = useState<AiSettings>({
    enabled: false,
    provider: 'deepseek',
    model: 'deepseek-flash',
  });
  const [generating, setGenerating] = useState(false);
  const [askKey, setAskKey] = useState(false);
  const [keyDraft, setKeyDraft] = useState('');
  const [aiError, setAiError] = useState('');
  const [truncated, setTruncated] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    void loadAiSettings()
      .then(setAi)
      .catch(() => {});
  }, []);
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
    setRepairRaw(text);
    setCandidates([]);
    const result = parseImport(text);
    if (result.success) {
      setPreview(result);
      setErrors([]);
      setStoryOnly(null);
      setDuplicate(false);
    } else {
      setErrors(result.candidates?.length ? [] : result.errors);
      setCandidates(result.candidates ?? []);
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
  const rememberSnapshot = () =>
    app.setDraft({ input, raw, promptSnapshot: input });
  const generate = async (apiKey = ai.apiKey) => {
    if (generating) return;
    if (!apiKey) {
      setAskKey(true);
      return;
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setAiError(
        '当前离线，无法调用 DeepSeek；可关闭 AI，改用复制 Prompt。已经保存的冒险仍可离线使用。',
      );
      return;
    }
    if (inputErrors.length) {
      setShowFormErrors(true);
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setGenerating(true);
    setAiError('');
    setTruncated(false);
    try {
      const reply = await generateWithDeepSeek({
        apiKey,
        prompt,
        signal: controller.signal,
      });
      app.setDraft({ input, raw: reply.content, promptSnapshot: input });
      if (reply.finishReason === 'length') {
        setTruncated(true);
        setAiError(
          '回答可能被截断，没有把它标成完整冒险。原文留在粘贴框里，可以检查后再导入。',
        );
        return;
      }
      importRaw(reply.content);
    } catch (error) {
      if (error instanceof DeepSeekError && error.code === 'aborted') {
        setAiError('已取消生成。');
        return;
      }
      setAiError(error instanceof Error ? error.message : '生成没有完成。');
    } finally {
      setGenerating(false);
      abortRef.current = null;
    }
  };
  const saveKeyAndGenerate = async () => {
    const apiKey = keyDraft.trim();
    if (!apiKey) return;
    const next = { ...ai, enabled: true, apiKey };
    await saveAiSettings(next);
    setAi(next);
    setKeyDraft('');
    setAskKey(false);
    await generate(apiKey);
  };
  const save = async () => {
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
                maxLength={1000}
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
                maxLength={1000}
                onChange={(e) => field('gameStyle', e.target.value)}
              />
            </label>
            <label>
              兴趣 <span className="optional">选填</span>
              <input
                name="interests"
                maxLength={1000}
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
            <button
              type="button"
              className="ai-row"
              aria-pressed={ai.enabled}
              onClick={() => {
                const enabled = !ai.enabled;
                const next = { ...ai, enabled };
                setAi(next);
                void saveAiSettings(next);
              }}
            >
              <span>使用 AI 直接生成</span>
              <strong>{ai.enabled ? '开' : '关'}</strong>
            </button>
            {ai.enabled && (
              <div className="ai-key-row">
                <span>
                  {ai.apiKey
                    ? `DeepSeek · Key 已保存在本机 ${maskApiKey(ai.apiKey)}`
                    : 'DeepSeek · 尚未保存 Key'}
                </span>
                <span className="ai-key-actions">
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => {
                      setKeyDraft('');
                      setAskKey(true);
                    }}
                  >
                    {ai.apiKey ? '修改 Key' : '配置 Key'}
                  </button>
                  {ai.apiKey && (
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => {
                        const next = { ...ai, apiKey: undefined };
                        setAi(next);
                        void saveAiSettings({ enabled: ai.enabled });
                      }}
                    >
                      删除 Key
                    </button>
                  )}
                </span>
              </div>
            )}
            {ai.enabled && (
              <p className="small muted">
                此 Key 只保存在当前浏览器。任何能执行本页脚本的代码理论上都可能读取它；请使用你自己的、可以撤销的
                DeepSeek Key。
              </p>
            )}
            {inputErrors.length ? (
              <>
                <button
                  className="primary full"
                  type="submit"
                  onClick={() => setShowFormErrors(true)}
                >
                  {ai.enabled ? (
                    <>
                      直接生成冒险 <span aria-hidden="true">✦</span>
                    </>
                  ) : (
                    <>
                      复制生成 Prompt <span aria-hidden="true">↗</span>
                    </>
                  )}
                </button>
                {showFormErrors && (
                  <div role="alert" className="error-panel">
                    {inputErrors.map((e) => (
                      <p key={e.path}>{e.message}</p>
                    ))}
                  </div>
                )}
              </>
            ) : ai.enabled ? (
              <>
                <button
                  className="primary full"
                  type="button"
                  disabled={generating}
                  onClick={() => void generate()}
                >
                  {generating ? (
                    'DeepSeek 正在生成…'
                  ) : (
                    <>
                      直接生成冒险 <span aria-hidden="true">✦</span>
                    </>
                  )}
                </button>
                {generating && (
                  <button
                    className="secondary full"
                    type="button"
                    onClick={() => abortRef.current?.abort()}
                  >
                    取消生成
                  </button>
                )}
              </>
            ) : (
              <CopyButton
                className="primary full"
                text={prompt}
                success="已复制，发给你常用的 AI 即可"
                onCopied={rememberSnapshot}
              >
                复制生成 Prompt <span aria-hidden="true">↗</span>
              </CopyButton>
            )}
            {aiError && (
              <div role="alert" className="error-panel">
                <p>{aiError}</p>
                {!truncated && (
                  <>
                    <button
                      className="secondary"
                      type="button"
                      onClick={() => void generate()}
                    >
                      再试一次
                    </button>
                    <button
                      className="text-button"
                      type="button"
                      onClick={() => {
                        const next = { ...ai, enabled: false };
                        setAi(next);
                        void saveAiSettings(next);
                        setAiError('');
                      }}
                    >
                      关闭 AI，改用复制 Prompt
                    </button>
                  </>
                )}
              </div>
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
              placeholder="粘贴 AI 的完整回复，支持新版故事正文和已有 JSON"
              onChange={(e) => {
                app.setDraft({ input, raw: e.target.value });
                setErrors([]);
                setStoryOnly(null);
                setCandidates([]);
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
              accept=".json,.rpgtrip,.txt,application/json,text/plain"
              onChange={(e) => void readFile(e.target.files?.[0])}
            />
            {errors.length > 0 && (
              <div className="error-panel" role="alert">
                <h3>
                  {personalBackup ? '这份备份未能恢复' : '这份回答需要修正'}
                </h3>
                {humanIssues(errors).map((message) => (
                  <p key={message}>{message}</p>
                ))}
                <details>
                  <summary>查看详细诊断（{errors.length}）</summary>
                  {errors.map((e, i) => (
                    <p key={i}>
                      {e.message}
                      <small>
                        {e.code} · {e.path}
                      </small>
                    </p>
                  ))}
                </details>
                {!personalBackup && (
                  <>
                    <CopyButton text={createRepairPrompt(repairRaw, errors)}>
                      复制修复 Prompt
                    </CopyButton>
                    <CopyButton
                      text={createRepairPrompt(
                        repairRaw,
                        errors,
                        app.draft.promptSnapshot ?? undefined,
                        { includeOriginal: true },
                      )}
                    >
                      更换 AI 时附上原文
                    </CopyButton>
                  </>
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
              不需要账号。可以复制 Prompt 交给自己的 AI，也可以把 DeepSeek Key
              存在本机后直接生成。导入后，线索、地点与进度都能离线随身带走。
            </p>
            <div className="note-rule" />
            <p className="small">
              内容保存在当前浏览器 /
              当前设备；清理站点数据或更换浏览器可能丢失，请导出备份。
            </p>
          </aside>
        </div>
      </div>
      {candidates.length > 0 && (
        <Modal title="选择要导入的故事" close={() => setCandidates([])}>
          <p>这份回复包含不同的故事或存档，请选择一份预览。原始回答会保留。</p>
          {candidates.map((candidate, index) => (
            <button
              key={index}
              className="secondary full"
              onClick={() => importRaw(candidate.raw)}
            >
              第 {index + 1} 份 · {candidate.title}
            </button>
          ))}
        </Modal>
      )}
      {askKey && (
        <Modal title="DeepSeek API Key" close={() => setAskKey(false)}>
          <label>
            DeepSeek API Key
            <input
              type="password"
              name="deepseek-api-key"
              autoComplete="off"
              value={keyDraft}
              onChange={(e) => setKeyDraft(e.target.value)}
            />
          </label>
          <p className="small muted">
            Key 仅保存在当前浏览器，不进入故事、备份或仓库。修改时需要重新输入完整新
            Key，页面不会回填已保存的密钥。
          </p>
          <button
            className="primary"
            type="button"
            disabled={!keyDraft.trim() || generating}
            onClick={() => void saveKeyAndGenerate()}
          >
            保存并继续
          </button>
        </Modal>
      )}
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
          <p>
            已识别 {preview.data.quests.length} 个地点 · {actionCount(preview)}{' '}
            项行动 ·{' '}
            {preview.data.adventure.endingText.trim()
              ? '已包含结局'
              : '尚缺结局'}
          </p>
          <dl className="preview-meta">
            <div>
              <dt>目的地</dt>
              <dd>{preview.data.adventure.destination || '未提供目的地'}</dd>
            </div>
            <div>
              <dt>旅行日期</dt>
              <dd>
                {preview.data.adventure.startDate ?? '日期未提供'} —{' '}
                {preview.data.adventure.endDate ?? '日期未提供'}
              </dd>
            </div>
          </dl>
          <ul className="preview-places">
            {preview.data.quests.map((quest) => {
              const nav =
                quest.location.query.trim() || quest.location.address.trim();
              return (
                <li key={quest.id}>
                  {quest.title} · {nav || '未提供导航'}
                </li>
              );
            })}
          </ul>
          <details>
            <summary>
              {preview.data.adventure.endingText.trim()
                ? '查看结局（可能剧透）'
                : '尚缺结局'}
            </summary>
            <p>
              {preview.data.adventure.endingText.trim() ||
                '结局尚未提供。可以先保存已有任务。'}
            </p>
          </details>
          {preview.photos.length > 0 && (
            <p className="success">
              随存档恢复 {preview.photos.length} 张任务照片。
            </p>
          )}
          {hasRoutineWarning(preview.warnings) && <p>已整理格式。</p>}
          {importantWarnings(preview.warnings).map((n) => (
            <p className="warning-text" key={n}>
              {n}
            </p>
          ))}
          {preview.data.adventure.verificationNotes.length > 0 && (
            <p className="warning-text">提醒：地点及交通信息未由本应用核验。</p>
          )}
          {preview.data.adventure.verificationNotes.map((n, i) => (
            <p className="warning-text" key={i}>
              {n}
            </p>
          ))}
          {preview.supplements.length > 0 && (
            <details>
              <summary>未关联内容（{preview.supplements.length}）</summary>
              {preview.supplements.map((item, index) => (
                <p key={index}>{item}</p>
              ))}
            </details>
          )}
          {needsSnapshot(preview) && app.draft.promptSnapshot && (
            <button
              className="secondary"
              type="button"
              onClick={() =>
                setPreview({
                  ...preview,
                  data: applyRequestSnapshot(
                    preview.data,
                    app.draft.promptSnapshot!,
                  ),
                })
              }
            >
              使用这次需求补齐
            </button>
          )}
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
