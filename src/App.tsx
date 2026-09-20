import { useEffect, useState } from 'react';
import { APP_NAME } from './config';
import { WorkspaceProvider, useApp } from './state';
import HomePage from './pages/HomePage';
import QuestPage from './pages/QuestPage';
import RoutePage from './pages/RoutePage';
import JournalPage from './pages/JournalPage';
import LibraryPage from './pages/LibraryPage';
import PwaPanel from './components/PwaPanel';
import { Compass, ExportButton } from './components/Common';
function Shell() {
  const app = useApp();
  const [hash, setHash] = useState(location.hash || '#/');
  useEffect(() => {
    const change = () => {
      setHash(location.hash || '#/');
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  const [page, id] = hash.replace(/^#\/?/, '').split('/');
  const record = app.records.find((r) => r.instanceId === id);
  useEffect(() => {
    if (record) app.remember(record.instanceId);
  }, [record?.instanceId]);
  const current =
    record ||
    app.records.find((r) => r.instanceId === app.lastId) ||
    app.records[0];
  return (
    <>
      <a
        className="skip-link"
        href="#main-content"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById('main-content')?.focus();
          document.getElementById('main-content')?.scrollIntoView();
        }}
      >
        跳到主要内容
      </a>
      <header className="site-header">
        <a className="brand" href="#/" aria-label={`${APP_NAME} 首页`}>
          <Compass />
          <span>{APP_NAME}</span>
          <span className="brand-subtitle">TRAVEL, WITH A STORY.</span>
        </a>
        <a className="header-library" href="#/library">
          我的冒险 <span aria-hidden="true">↗</span>
        </a>
      </header>
      <main
        id="main-content"
        tabIndex={-1}
        className={current ? 'has-bottom-nav' : ''}
      >
        {app.error && (
          <div className="error-panel global-error" role="alert">
            <strong>{app.pending ? '未保存：' : '本机存储提示：'}</strong>
            {app.error}
            <div className="button-row">
              <button
                className="secondary"
                disabled={app.busy}
                onClick={() =>
                  void (app.ready ? app.retryPending() : app.load())
                }
              >
                重试保存 / 读取
              </button>
              {app.pending && (
                <ExportButton
                  data={app.pending.record.data}
                  progress={app.pending.next}
                >
                  导出未保存进度
                </ExportButton>
              )}
            </div>
            <p className="small">
              写入失败不会清空本机数据。发生其他页面修改冲突时，请先导出未保存进度，再重新打开本页读取最新存档。
            </p>
          </div>
        )}
        {!app.ready ? (
          <section className="empty-state">
            <h1>{app.error ? '暂时无法打开本机存储' : '正在打开旅行手册…'}</h1>
            <p>
              {app.error
                ? '请关闭其他正在使用本应用的页面，确认浏览器允许站点存储后重试。'
                : ''}
            </p>
          </section>
        ) : !page ? (
          <HomePage />
        ) : page === 'library' ? (
          <LibraryPage />
        ) : record ? (
          page === 'quest' ? (
            <QuestPage key={id} record={record} />
          ) : page === 'route' ? (
            <RoutePage record={record} />
          ) : page === 'journal' ? (
            <JournalPage record={record} />
          ) : (
            <HomePage />
          )
        ) : (
          <section className="empty-state">
            <h1>这里还没有冒险</h1>
            <p>请选择已有存档，或开始一段新旅程。</p>
            <a href="#/library" className="button primary">
              打开我的冒险
            </a>
            <a href="#/" className="button secondary">
              创建冒险
            </a>
          </section>
        )}
        <footer className="site-footer">
          <span>{APP_NAME} · 把故事带在身边</span>
          <span>本机保存 · 自由探索 · 离线继续</span>
        </footer>
        <PwaPanel />
      </main>
      {current && (
        <nav className="bottom-nav" aria-label="冒险导航">
          {[
            ['quest', '任务', '◇'],
            ['route', '地点', '⌁'],
            ['journal', '日志', '▤'],
            ['library', '我的', '◯'],
          ].map(([path, label, icon]) => (
            <a
              key={path}
              href={
                path === 'library'
                  ? '#/library'
                  : `#/${path}/${current.instanceId}`
              }
              aria-current={page === path ? 'page' : undefined}
            >
              <span aria-hidden="true">{icon}</span>
              {label}
            </a>
          ))}
        </nav>
      )}
      <div className="sr-only" role="status">
        {app.notice}
      </div>
    </>
  );
}
export default function App() {
  return (
    <WorkspaceProvider>
      <Shell />
    </WorkspaceProvider>
  );
}
