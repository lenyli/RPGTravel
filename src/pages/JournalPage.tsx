import { useState } from 'react';
import type { StoredAdventure } from '../storage/db';
import {
  unlockedClues,
  resolvedQuests,
  progressSummary,
} from '../domain/progress';
import { Ending } from './QuestPage';
import PhotoJournal from '../components/PhotoJournal';
export default function JournalPage({
  record,
  photoQuestId,
}: {
  record: StoredAdventure;
  photoQuestId?: string;
}) {
  const [tab, setTab] = useState<'clues' | 'journal' | 'photos'>(
    photoQuestId ? 'photos' : 'clues',
  );
  const [selectedQuest, setSelectedQuest] = useState(photoQuestId);
  const clues = unlockedClues(record.data, record.progress);
  const resolved = resolvedQuests(record.data, record.progress);
  return (
    <div className="journal-page">
      <p className="eyebrow">把已经发生的故事收好</p>
      <h1>旅人手记</h1>
      <div className="segmented" role="tablist" aria-label="手记内容">
        <button
          role="tab"
          aria-selected={tab === 'clues'}
          onClick={() => setTab('clues')}
        >
          已获线索 · {clues.length}
        </button>
        <button
          role="tab"
          aria-selected={tab === 'journal'}
          onClick={() => setTab('journal')}
        >
          冒险日志 · {resolved.length}
        </button>
        <button
          role="tab"
          aria-selected={tab === 'photos'}
          onClick={() => setTab('photos')}
        >
          照片手记 · {record.photos.length}
        </button>
      </div>
      <div role="tabpanel">
        {tab === 'photos' ? (
          <PhotoJournal record={record} initialQuestId={selectedQuest} />
        ) : tab === 'clues' ? (
          clues.length ? (
            <div className="clues-grid">
              {clues.map(({ clue, via }, i) => (
                <article className="clue-card" key={clue.id}>
                  <p className="eyebrow">
                    线索 {String(i + 1).padStart(2, '0')} ·{' '}
                    {via === 'fallback' ? '剧情补叙' : '现场调查'}
                  </p>
                  <h2>{clue.title}</h2>
                  <p>{clue.content}</p>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <span aria-hidden="true">✳</span>
              <h2>第一条线索，还在路上</h2>
              <p>
                完成任一地点的调查，或明确跳过后，这里会记录你已经得知的内容。
              </p>
              <a
                className="button primary"
                href={`#/quest/${record.instanceId}`}
              >
                回到当前任务
              </a>
            </div>
          )
        ) : resolved.length ? (
          <div className="journal-list">
            {resolved.map((q) => {
              const p = record.progress.quests[q.id];
              return (
                <article className="panel" key={q.id}>
                  <p className="eyebrow">
                    {p.status === 'skipped' ? '已跳过 · 剧情补叙' : '已完成'}
                  </p>
                  <h2>{q.title}</h2>
                  <p className="small muted">
                    {p.resolvedAt
                      ? new Date(p.resolvedAt).toLocaleString()
                      : ''}
                  </p>
                  <p>
                    {p.status === 'skipped'
                      ? q.visit.fallbackText
                      : q.completionText}
                  </p>
                  <button
                    className="secondary"
                    onClick={() => {
                      setSelectedQuest(q.id);
                      setTab('photos');
                    }}
                  >
                    查看 / 添加本任务照片（
                    {
                      record.photos.filter((photo) => photo.questId === q.id)
                        .length
                    }
                    ）
                  </button>
                </article>
              );
            })}
          </div>
        ) : (
          <p className="empty-state">冒险刚刚开始，日志会随着你的行动展开。</p>
        )}
      </div>
      {progressSummary(record.data, record.progress).isFinished && (
        <Ending record={record} />
      )}
    </div>
  );
}
