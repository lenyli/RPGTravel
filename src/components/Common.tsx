import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { RPGTrip, Quest } from '../protocol/schema';
import type { Progress } from '../domain/progress';
import { mapUrls, sourceHref } from '../domain/navigation';
import { createSave, saveFilename } from '../storage/backup';
import type { PhotoAttachment } from '../domain/photos';

export function Compass({ className = '' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="24" cy="24" r="19" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M24 1v8m0 30v8M1 24h8m30 0h8M33 14l-5 14-13 6 5-14z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path d="m33 14-5 14-4-4z" fill="currentColor" />
      <circle cx="24" cy="24" r="2" fill="currentColor" />
    </svg>
  );
}
export function Modal({
  title,
  children,
  close,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    if (!dialog.open) dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <div className="dialog-heading">
        <h2>{title}</h2>
        <button className="icon-button" aria-label="关闭" onClick={close}>
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function CopyButton({
  text,
  children,
  disabled = false,
  success = '已复制',
  className = 'secondary',
}: {
  text: string;
  children: ReactNode;
  disabled?: boolean;
  success?: string;
  className?: string;
}) {
  const [fallback, setFallback] = useState(false);
  const [message, setMessage] = useState('');
  const copy = () => {
    setMessage('');
    if (!navigator.clipboard?.writeText) {
      setFallback(true);
      return;
    }
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setFallback(false);
        setMessage(success);
      })
      .catch(() => {
        setFallback(true);
      });
  };
  return (
    <>
      <button
        type="button"
        className={className}
        disabled={disabled}
        onClick={copy}
      >
        {children}
      </button>
      {message && (
        <p className="success" role="status">
          {message}
        </p>
      )}
      {fallback && (
        <div className="copy-fallback">
          <p role="status">
            自动复制被浏览器拒绝，请长按或全选下方文本手动复制。
          </p>
          <textarea
            aria-label="手动复制文本"
            value={text}
            readOnly
            rows={6}
            onFocus={(e) => e.currentTarget.select()}
          />
          <button
            type="button"
            className="text-button"
            onClick={() => setFallback(false)}
          >
            收起复制文本
          </button>
        </div>
      )}
    </>
  );
}
export function MapPanel({ quest }: { quest: Quest }) {
  const [open, setOpen] = useState(false);
  const urls = mapUrls(quest.location);
  return (
    <>
      <button className="primary" onClick={() => setOpen(true)}>
        打开地图确认地点 <span aria-hidden="true">↗</span>
      </button>
      {open && (
        <Modal title="打开地图确认地点" close={() => setOpen(false)}>
          <p className="strong">{quest.location.name}</p>
          <p>{quest.location.address}</p>
          <p className="muted">
            请先核对同名地点，再在地图中开始导航。外部地图可能需要网络或自己的离线数据。
          </p>
          <div className="stack">
            <a
              className="button secondary"
              href={urls.amap}
              target="_blank"
              rel="noopener noreferrer"
            >
              高德地图 ↗
            </a>
            <a
              className="button secondary"
              href={urls.apple}
              target="_blank"
              rel="noopener noreferrer"
            >
              Apple 地图 ↗
            </a>
            <a
              className="button secondary"
              href={urls.google}
              target="_blank"
              rel="noopener noreferrer"
            >
              Google Maps ↗
            </a>
            <CopyButton
              text={`${quest.location.name}\n${quest.location.address}`}
            >
              复制地址
            </CopyButton>
          </div>
        </Modal>
      )}
    </>
  );
}
export function PracticalNotes({ data }: { data: RPGTrip }) {
  return (
    <details className="practical">
      <summary>出行提醒与信息来源</summary>
      <p className="muted">
        仅检查格式与一致性。地点、历史、开放和来源内容未经本应用联网核验，请出行前自行核对。
      </p>
      {data.adventure.practicalNotes.map((n, i) => (
        <p key={`p${i}`}>{n}</p>
      ))}
      {data.adventure.verificationNotes.map((n, i) => (
        <p className="warning-text" key={`v${i}`}>
          {n}
        </p>
      ))}
      {data.adventure.sources.length > 0 && (
        <ul className="sources">
          {data.adventure.sources.map((s) => {
            const href = sourceHref(s.url);
            return (
              <li key={s.id}>
                {href ? (
                  <a href={href} target="_blank" rel="noopener noreferrer">
                    {s.title} ↗
                  </a>
                ) : (
                  s.title
                )}
                <span className="source-url">{s.url}</span>
                <span className="muted">AI 声明查阅于 {s.checkedOn}</span>
              </li>
            );
          })}
        </ul>
      )}
    </details>
  );
}
export function ExportButton({
  data,
  progress,
  photos = [],
  children,
}: {
  data: RPGTrip;
  progress: Progress | null;
  photos?: PhotoAttachment[];
  children: ReactNode;
}) {
  const [backupText, setBackupText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState('');
  const [message, setMessage] = useState('');
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  const prepare = () => {
    try {
      const content = JSON.stringify(
        createSave(data, progress, undefined, photos),
        null,
        2,
      );
      setBackupText(content);
      const saved = new File([content], saveFilename(data), {
        type: 'application/json',
      });
      const link = URL.createObjectURL(saved);
      setFile(saved);
      setUrl(link);
      const a = document.createElement('a');
      a.href = link;
      a.download = saved.name;
      a.click();
      setMessage(
        '备份文件已生成。保存位置由浏览器或系统选择；请确认文件已保存。',
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '无法生成备份文件，请重试。');
    }
  };
  const share = () => {
    if (file && navigator.share)
      void navigator
        .share({ files: [file], title: data.adventure.title })
        .then(() => setMessage('已交给系统分享，请确认保存位置。'))
        .catch(() =>
          setMessage('分享已取消或不可用，可使用下载链接或复制文件内容。'),
        );
  };
  return (
    <>
      <button className="secondary" onClick={prepare}>
        {children}
      </button>
      {message && (
        <p role="status" className="small">
          {message}
        </p>
      )}
      {!file && backupText && (
        <CopyButton text={backupText}>复制备份内容</CopyButton>
      )}
      {file && (
        <div className="export-result">
          <a href={url} download={file.name}>
            再次下载文件
          </a>
          {navigator.canShare?.({ files: [file] }) && (
            <button className="text-button" onClick={share}>
              系统分享 / 存储到文件
            </button>
          )}
          <CopyButton text={backupText}>复制备份内容</CopyButton>
        </div>
      )}
    </>
  );
}
