import type { StoredAdventure } from '../storage/db';
import { sortedQuests } from '../domain/progress';
import { CopyButton, MapPanel, PracticalNotes } from '../components/Common';
import { useApp } from '../state';
const labels = {
  available: '可调查',
  active: '调查中',
  completed: '已完成',
  skipped: '已跳过',
};
export default function RoutePage({ record }: { record: StoredAdventure }) {
  const app = useApp();
  const choose = async (questId: string) => {
    const saved = await app.act(record, { type: 'select', questId });
    if (saved) location.hash = `/quest/${record.instanceId}`;
  };
  return (
    <div className="route-page">
      <p className="eyebrow">把故事带到真实的地方</p>
      <h1>地点与任务</h1>
      <p className="adventure-title">{record.data.adventure.title}</p>
      <p className="muted">
        到哪做哪，自由选择调查顺序。编号只为方便查找，不是固定行程；日期、时段和交通仅作参考。这是地点示意，不是道路导航。
      </p>
      <PracticalNotes data={record.data} />
      <div className="route-timeline">
        {sortedQuests(record.data).map((quest) => {
          const state = record.progress.quests[quest.id];
          const chapter = record.data.chapters.find(
            (c) => c.id === quest.chapterId,
          )!;
          const current = record.progress.currentQuestId === quest.id;
          return (
            <article className={`route-node ${state.status}`} key={quest.id}>
              <span className="route-index" aria-hidden="true">
                {String(quest.order).padStart(2, '0')}
              </span>
              <div className="route-card panel">
                <div className="route-meta">
                  <span>{chapter.area}</span>
                  <span className="badge">
                    {current ? '当前选择 · ' : ''}
                    {labels[state.status]}
                  </span>
                </div>
                <h2>{quest.location.name}</h2>
                <p className="address">{quest.location.address}</p>
                <p className="route-story-name">{quest.title}</p>
                <p>
                  {quest.visit.recommendedDate
                    ? `参考日期 ${quest.visit.recommendedDate} · `
                    : ''}
                  {quest.visit.recommendedTime || '日期与时间自行安排'} · 约{' '}
                  {quest.visit.estimatedMinutes} 分钟
                </p>
                {quest.visit.transportNote && (
                  <p>交通：{quest.visit.transportNote}</p>
                )}
                <p>开放 / 预约：{quest.visit.accessNote || '待核验'}</p>
                <p className="safety">
                  安全：
                  {quest.visit.safetyNote || '遵守现场开放范围与安全规定。'}
                </p>
                <div className="button-row">
                  {state.status === 'active' || state.status === 'available' ? (
                    <button
                      className="primary"
                      disabled={app.busy || !!app.pending}
                      onClick={() => void choose(quest.id)}
                    >
                      {state.status === 'active' ? '继续此地点' : '选择此地点'}
                    </button>
                  ) : (
                    <a
                      className="button secondary"
                      href={`#/journal/${record.instanceId}`}
                    >
                      查看已获线索与日志
                    </a>
                  )}
                  <MapPanel quest={quest} />
                  <CopyButton
                    text={`${quest.location.name}\n${quest.location.address}`}
                  >
                    复制地址
                  </CopyButton>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
