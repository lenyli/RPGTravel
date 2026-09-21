import { useState } from 'react';
import { useApp } from '../state';
import { progressSummary } from '../domain/progress';
import type { StoredAdventure } from '../storage/db';
import { ExportButton, Modal } from '../components/Common';
export default function LibraryPage() {
  const app = useApp();
  const [confirm, setConfirm] = useState<{
    record: StoredAdventure;
    type: 'restart' | 'delete';
  } | null>(null);
  const [persist, setPersist] = useState('');
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
        <a className="button primary" href="#/">
          ＋ 创建新冒险
        </a>
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
          <a className="button primary" href="#/">
            去创建冒险
          </a>
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
                    {record.data.adventure.startDate} —{' '}
                    {record.data.adventure.endDate}
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
          导出完整存档可保留勾选、线索和照片手记；导出故事仅分享剧本，不含你的照片。恢复文件总会创建新存档，不覆盖原来的进度。
        </p>
        <button className="secondary" onClick={() => void preserve()}>
          请求保留本机数据
        </button>
        {persist && <p role="status">{persist}</p>}
      </section>
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
