import { useEffect, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useApp } from '../state';

type InstallEvent = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: string }>;
};
export default function PwaPanel() {
  const app = useApp();
  const [install, setInstall] = useState<InstallEvent | null>(null);
  const [installed, setInstalled] = useState(
    window.matchMedia('(display-mode: standalone)').matches,
  );
  const [error, setError] = useState('');
  const [deferred, setDeferred] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const {
    offlineReady: [offlineReady],
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    immediate: true,
    onRegisterError: () =>
      setError('离线缓存未能完成。请联网后重试，当前本机存档会保留。'),
    onRegisteredSW: (_url, registration) => {
      if (registration)
        window.addEventListener('focus', () => {
          if (navigator.onLine) void registration.update().catch(() => {});
        });
    },
  });
  useEffect(() => {
    const capture = (e: Event) => {
      e.preventDefault();
      setInstall(e as InstallEvent);
    };
    const done = () => {
      setInstalled(true);
      setInstall(null);
    };
    const syncOnline = () => setOnline(navigator.onLine);
    window.addEventListener('beforeinstallprompt', capture);
    window.addEventListener('appinstalled', done);
    window.addEventListener('online', syncOnline);
    window.addEventListener('offline', syncOnline);
    return () => {
      window.removeEventListener('beforeinstallprompt', capture);
      window.removeEventListener('appinstalled', done);
      window.removeEventListener('online', syncOnline);
      window.removeEventListener('offline', syncOnline);
    };
  }, []);
  const update = async () => {
    try {
      await app.beforeUpdate();
      await updateServiceWorker(true);
    } catch (e) {
      app.cancelUpdate();
      setError(e instanceof Error ? e.message : '保存尚未完成，请重试。');
    }
  };
  const requestInstall = async () => {
    if (install) {
      await install.prompt();
      const choice = await install.userChoice;
      if (choice.outcome === 'accepted') setInstall(null);
    }
  };
  return (
    <div className="pwa-area">
      <div className="pwa-status">
        <span className={`status-dot ${offlineReady ? 'ready' : ''}`} />
        <span>
          {!online
            ? '当前离线 · 使用本机内容'
            : offlineReady
              ? '应用资源已缓存，可离线使用'
              : import.meta.env.DEV
                ? '本地开发模式'
                : '正在准备离线资源'}
        </span>
        {installed ? (
          <span>已在独立窗口中打开</span>
        ) : install ? (
          <button className="text-button" onClick={() => void requestInstall()}>
            安装到设备
          </button>
        ) : (
          <details>
            <summary>如何安装</summary>
            <p>
              iPhone / iPad：在 Safari
              分享菜单选择「添加到主屏幕」。其他浏览器：在菜单中选择安装应用。需要
              HTTPS 或本机 localhost；安装与离线缓存是两件事。
            </p>
          </details>
        )}
      </div>
      {needRefresh && (
        <div className="update-panel" role="status">
          <span>
            {deferred
              ? '新版等待更新，你可以继续当前旅程。'
              : '发现新版应用，保存当前内容后即可更新。'}
          </span>
          <button
            className="primary"
            disabled={app.busy}
            onClick={() => void update()}
          >
            保存并更新
          </button>
          {!deferred && (
            <button className="secondary" onClick={() => setDeferred(true)}>
              稍后
            </button>
          )}
        </div>
      )}
      {error && (
        <div className="error-panel" role="alert">
          {error}
          <button
            className="secondary"
            onClick={() =>
              void app
                .beforeUpdate()
                .then(() => location.reload())
                .catch((e) => {
                  app.cancelUpdate();
                  setError(e.message);
                })
            }
          >
            保存并重试
          </button>
        </div>
      )}
    </div>
  );
}
