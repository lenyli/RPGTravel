import { useEffect, useRef, useState } from 'react';
import type { StoredAdventure } from '../storage/db';
import type { Quest } from '../protocol/schema';
import { progressSummary } from '../domain/progress';
import { reliableDistance, requestPosition } from '../domain/navigation';
import { useApp } from '../state';
import {
  CopyButton,
  MapPanel,
  Modal,
  PracticalNotes,
} from '../components/Common';

export function Ending({ record }: { record: StoredAdventure }) {
  const summary = progressSummary(record.data, record.progress);
  if (!summary.isFinished) return null;
  return (
    <section className="ending panel">
      <p className="eyebrow">旅程的最后一页</p>
      <p className="adventure-title">{record.data.adventure.title}</p>
      <h1>{record.data.adventure.endingTitle}</h1>
      <p className="story-text">{record.data.adventure.endingText}</p>
      <p className="ending-status">
        {summary.skipped
          ? `故事已收束，含 ${summary.skipped} 个跳过任务`
          : '所有现场任务已完成，故事已收束'}
      </p>
      <a className="button primary" href={`#/journal/${record.instanceId}`}>
        回看线索与日志
      </a>
      <a className="button secondary" href="#/library">
        导出与管理冒险
      </a>
    </section>
  );
}
export default function QuestPage({ record }: { record: StoredAdventure }) {
  const app = useApp();
  const { data, progress } = record;
  const [skip, setSkip] = useState(false);
  const [feedback, setFeedback] = useState<{
    quest: Quest;
    skipped: boolean;
  } | null>(null);
  const [positionText, setPositionText] = useState('');
  const [locating, setLocating] = useState(false);
  const quest = data.quests.find((q) => q.id === progress.currentQuestId);
  const activeLocation = useRef(quest?.id);
  activeLocation.current = quest?.id;
  const previousProgress = useRef(progress);
  useEffect(() => {
    const previous = previousProgress.current;
    previousProgress.current = progress;
    const newlyResolved = data.quests.find((q) => {
      const before = previous.quests[q.id]?.status;
      const after = progress.quests[q.id].status;
      return before !== after && (after === 'completed' || after === 'skipped');
    });
    if (newlyResolved) {
      setSkip(false);
      setFeedback({
        quest: newlyResolved,
        skipped: progress.quests[newlyResolved.id].status === 'skipped',
      });
    }
  }, [progress, data]);
  useEffect(() => {
    setPositionText('');
    setLocating(false);
  }, [quest?.id]);
  const feedbackModal = feedback && (
    <Modal
      title={feedback.skipped ? '剧情补叙 · 继续故事' : '调查完成 · 线索已揭晓'}
      close={() => setFeedback(null)}
    >
      <h3>{feedback.quest.title}</h3>
      <p className="story-text">
        {feedback.skipped
          ? feedback.quest.visit.fallbackText
          : feedback.quest.completionText}
      </p>
      {feedback.quest.rewardClueIds.map((id) => {
        const clue = data.clues.find((c) => c.id === id)!;
        return (
          <div className="clue-card" key={id}>
            <span className="eyebrow">
              {feedback.skipped ? '剧情补叙所得' : '获得线索'}
            </span>
            <h3>{clue.title}</h3>
            <p>{clue.content}</p>
          </div>
        );
      })}
      <p className="success">
        {progressSummary(data, progress).isFinished
          ? '进度已保存到本机，故事已收束。'
          : '进度已保存到本机，可自由选择其他地点继续。'}
      </p>
      <button className="primary full" onClick={() => setFeedback(null)}>
        继续冒险
      </button>
      {!progressSummary(data, progress).isFinished && (
        <a
          className="button secondary full"
          href={`#/route/${record.instanceId}`}
        >
          自由选择下个地点
        </a>
      )}
    </Modal>
  );
  if (!quest)
    return (
      <>
        <Ending record={record} />
        <PracticalNotes data={data} />
        {feedbackModal}
      </>
    );
  const chapter = data.chapters.find((c) => c.id === quest.chapterId)!;
  const state = progress.quests[quest.id];
  const pendingProgress =
    app.pending?.record.instanceId === record.instanceId
      ? app.pending.next.quests[quest.id]
      : undefined;
  const checks =
    pendingProgress?.checkedObjectiveIds || state.checkedObjectiveIds;
  const summary = progressSummary(data, progress);
  const resolve = async (skipped: boolean) => {
    const saved = await app.act(record, {
      type: skipped ? 'skip' : 'complete',
      questId: quest.id,
    });
    if (saved) {
      setSkip(false);
    }
  };
  const locate = async () => {
    if (
      quest.location.latitude === null ||
      quest.location.longitude === null ||
      !quest.location.coordinateSourceId
    ) {
      setPositionText('可导航，暂无可靠坐标。你仍可手动开始调查。');
      return;
    }
    const targetId = quest.id;
    setLocating(true);
    try {
      const position = await requestPosition();
      if (activeLocation.current !== targetId) return;
      const distance = reliableDistance(quest.location, position);
      setPositionText(
        distance === null
          ? '可导航，暂无可靠坐标。'
          : `距目标约 ${distance >= 1000 ? `${(distance / 1000).toFixed(1)} 千米` : `${Math.round(distance)} 米`}（直线距离）。定位时间 ${new Date(position.timestamp).toLocaleTimeString()}，系统精度约 ${Math.round(position.accuracy)} 米；这不是到达证明或步行路线。`,
      );
    } catch (e) {
      if (activeLocation.current !== targetId) return;
      setPositionText(
        e instanceof Error
          ? e.message
          : '定位不可用，请直接使用地址导航或手动开始。',
      );
    } finally {
      if (activeLocation.current === targetId) setLocating(false);
    }
  };
  return (
    <div className="adventure-page">
      <div className="adventure-heading">
        <a href="#/library" className="back-link">
          ← 我的冒险
        </a>
        <p className="muted">{data.adventure.title}</p>
        <span className="progress-label">
          {summary.resolved} / {summary.total} 节已解决
        </span>
        <div className="progress-track">
          <span
            style={{ width: `${(summary.resolved / summary.total) * 100}%` }}
          />
        </div>
      </div>
      <a
        className="button secondary full choose-location"
        href={`#/route/${record.instanceId}`}
      >
        选择其他地点 · 当前勾选会保留
      </a>
      <section className="location-card">
        <p className="eyebrow">这一站，去这里</p>
        <h1>{quest.location.name}</h1>
        <p className="address">{quest.location.address}</p>
        <div className="button-row">
          <MapPanel quest={quest} />
          <CopyButton
            text={`${quest.location.name}\n${quest.location.address}`}
          >
            复制地址
          </CopyButton>
        </div>
        <button
          className="text-button"
          disabled={locating}
          onClick={() => void locate()}
        >
          {locating ? '正在定位…' : '查看我与任务地点的距离'}
        </button>
        {positionText ? (
          <p role="status" className="small">
            {positionText}
          </p>
        ) : (
          quest.location.latitude === null && (
            <p className="small muted">可导航，暂无可靠坐标</p>
          )
        )}
        <div className="visit-info">
          <p>
            <strong>参考安排</strong>{' '}
            {quest.visit.recommendedDate
              ? `${quest.visit.recommendedDate} · `
              : ''}{' '}
            {quest.visit.recommendedTime || '日期与时间自行安排'} · 约{' '}
            {quest.visit.estimatedMinutes} 分钟
          </p>
          {quest.visit.transportNote && (
            <p>
              <strong>交通</strong> {quest.visit.transportNote}
            </p>
          )}
          <p>
            <strong>开放 / 预约</strong>{' '}
            {quest.visit.accessNote || '未提供核验信息，请出发前自行确认。'}
          </p>
          <p className="safety">
            <strong>现场安全</strong>{' '}
            {quest.visit.safetyNote || '遵守现场开放范围、天气提示与安全规定。'}
          </p>
        </div>
      </section>
      <section className="panel investigation">
        <p className="eyebrow">地点故事 · {chapter.title}</p>
        <h2>{quest.title}</h2>
        {quest.id === chapter.questIds[0] && (
          <p className="chapter-intro">{chapter.intro}</p>
        )}
        {
          <div className="premise">
            <p>{data.adventure.premise}</p>
            <p>
              <strong>我们的目标</strong> {data.adventure.finalGoal}
            </p>
          </div>
        }
        <p className="story-text">{quest.story.scene}</p>
        <div className="mystery">
          <span aria-hidden="true">?</span>
          <p>{quest.story.currentMystery}</p>
        </div>
        {state.status === 'active' && quest.npcIds.length > 0 && (
          <div className="npc-list">
            {quest.npcIds.map((id) => {
              const npc = data.npcs.find((n) => n.id === id)!;
              return (
                <details key={id}>
                  <summary>
                    {npc.name} <span className="muted">· 虚构人物</span>
                  </summary>
                  <p>{npc.role}</p>
                  <p>{npc.description}</p>
                </details>
              );
            })}
          </div>
        )}
        {state.status === 'available' ? (
          <>
            <p className="muted">
              到达后再开始。无需按编号顺序，也没有日期或定位门禁。
            </p>
            <button
              className="primary full"
              disabled={app.busy || !!app.pending}
              onClick={() =>
                void app.act(record, { type: 'start', questId: quest.id })
              }
            >
              我已到达，开始调查
            </button>
            <h3>现场行动</h3>
            <ol className="objectives-preview">
              {quest.objectives.map((o) => (
                <li key={o.id}>{o.text}</li>
              ))}
            </ol>
          </>
        ) : (
          <>
            <h3>
              现场行动{' '}
              <span className="muted">
                {checks.length} / {quest.objectives.length}
              </span>
            </h3>
            <div className="objectives">
              {quest.objectives.map((o) => (
                <label
                  className={`objective ${checks.includes(o.id) ? 'checked' : ''}`}
                  key={o.id}
                >
                  <input
                    type="checkbox"
                    checked={checks.includes(o.id)}
                    disabled={app.busy || !!app.pending}
                    onChange={(e) =>
                      void app.act(record, {
                        type: 'check',
                        questId: quest.id,
                        objectiveId: o.id,
                        checked: e.target.checked,
                      })
                    }
                  />
                  <span>{o.text}</span>
                </label>
              ))}
            </div>
            <button
              className="primary full"
              disabled={
                checks.length !== quest.objectives.length ||
                app.busy ||
                !!app.pending
              }
              onClick={() => void resolve(false)}
            >
              完成调查
            </button>
            <p className="small muted">
              勾选不会自动结束；点击完成后才揭露线索并保存进度。
            </p>
          </>
        )}
        <button
          className="text-button skip-button"
          disabled={app.busy || !!app.pending}
          onClick={() => setSkip(true)}
        >
          现场无法完成 / 跳过本节
        </button>
      </section>
      <PracticalNotes data={data} />
      {skip && (
        <Modal
          title="跳过这一节调查？"
          close={() => {
            if (!app.busy) setSkip(false);
          }}
        >
          <h3>{quest.title}</h3>
          <p>
            本节会标记为跳过。你可以通过故事补叙获得后续线索，未完成的行动不会被勾选。
          </p>
          {app.error && (
            <p role="alert" className="error-panel">
              {app.error}
            </p>
          )}
          <button
            className="secondary full"
            disabled={app.busy}
            onClick={() => setSkip(false)}
          >
            先不继续
          </button>
          <button
            className="primary full"
            disabled={app.busy || !!app.pending}
            onClick={() => void resolve(true)}
          >
            确认跳过
          </button>
        </Modal>
      )}
      {feedbackModal}
    </div>
  );
}
