import { expect, test } from '@playwright/test';
import {
  checkObjective,
  completeQuest,
  dismissFeedback,
  downloadJson,
  fillTravelForm,
  fixture,
  home,
  importTrip,
  library,
  mockClipboard,
  screenshot,
  skipQuest,
  startQuest,
  wrapped,
} from './helpers';

async function controlled(page: import('@playwright/test').Page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  if (!(await page.evaluate(() => Boolean(navigator.serviceWorker.controller))))
    await page.reload();
  await expect
    .poll(() =>
      page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
    )
    .toBe(true);
}

test('生产缓存就绪后同 context 断网关闭重开，草稿、任务、结束与备份恢复均可用', async ({
  page,
  context,
  request,
}, info) => {
  const origin =
    info.project.name === 'webkit'
      ? 'http://127.0.0.1:4176'
      : 'http://127.0.0.1:4173';
  if (info.project.name === 'webkit') {
    await request.post(`${origin}/__test/deploy?release=a`);
    await request.post(`${origin}/__test/network?offline=false`);
  }
  await mockClipboard(page);
  await page.goto(`${origin}/#/`);
  await home(page);
  await controlled(page);
  await fillTravelForm(page);
  await expect(
    page.getByText('草稿已保存到本机', { exact: true }),
  ).toBeVisible();
  const id = await importTrip(page);
  await startQuest(page);
  await checkObjective(page.getByRole('checkbox').first());
  await controlled(page);
  const cacheKeys = await page.evaluate(() => caches.keys());
  expect(cacheKeys.length).toBeGreaterThan(0);
  if (info.project.name === 'webkit') {
    await request.post(`${origin}/__test/network?offline=true`);
    expect(
      await page.evaluate(async () => {
        try {
          await fetch('/uncached-network-probe', { cache: 'no-store' });
          return false;
        } catch {
          return true;
        }
      }),
    ).toBe(true);
    await info.attach('offline-method', {
      body: 'WebKit: production origin closes resource sockets; an uncached fetch is verified to fail. Playwright setOffline causes a separate WebKit internal navigation error in this environment.',
      contentType: 'text/plain',
    });
  } else await context.setOffline(true);
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto(`${origin}/#/quest/${id}`);
  await expect(reopened.getByRole('checkbox').first()).toBeChecked();
  for (const box of await reopened.getByRole('checkbox').all())
    await checkObjective(box);
  await reopened.getByRole('button', { name: '完成调查', exact: true }).click();
  await expect(
    reopened.getByText(fixture.quests[0].completionText, { exact: true }),
  ).toBeVisible();
  await dismissFeedback(reopened);
  await skipQuest(reopened);
  await dismissFeedback(reopened);
  await completeQuest(reopened, 2);
  await dismissFeedback(reopened);
  await expect(
    reopened.getByText(fixture.adventure.endingText, { exact: true }),
  ).toBeVisible();
  await screenshot(reopened, info, 'offline-ending');
  await home(reopened);
  await expect(reopened.getByLabel(/目的地.*游览范围/)).toHaveValue(
    '协议测试目的地 A&B “引号”',
  );
  await reopened
    .getByRole('button', { name: '复制生成 Prompt', exact: true })
    .click();
  // Depending on the engine, copying offline may succeed or use the same complete manual fallback.
  await expect(
    reopened.getByText(/已复制|长按|全选|手动复制/).first(),
  ).toBeVisible();
  await library(reopened);
  const backup = await downloadJson(reopened);
  await home(reopened);
  await reopened.getByLabel('AI 的完整回答').fill(JSON.stringify(backup));
  await reopened
    .getByRole('button', { name: '生成我的冒险', exact: true })
    .click();
  await reopened
    .getByRole('button', { name: '保存并开始', exact: true })
    .click();
  await reopened.getByRole('button', { name: '另存一份', exact: true }).click();
  await expect(reopened).not.toHaveURL(new RegExp(`quest/${id}$`));
  await expect(
    reopened.getByText(fixture.adventure.endingText, { exact: true }),
  ).toBeVisible();
  await context.setOffline(false);
  if (info.project.name === 'webkit')
    await request.post(`${origin}/__test/network?offline=false`);
});

test('真实子路径构建的 manifest、资源与 SW scope 一致并可离线刷新深链接', async ({
  page,
  context,
  request,
}, info) => {
  const origin = `http://127.0.0.1:${info.project.name === 'webkit' ? 4177 : 4175}`;
  await request.post(`${origin}/__test/network?offline=false`);
  await page.goto(`${origin}/rpg-trip/#/`);
  await expect(page.getByLabel('AI 的完整回答')).toBeVisible();
  const manifestHref = await page
    .locator('link[rel=manifest]')
    .getAttribute('href');
  const manifest = await (
    await request.get(new URL(manifestHref!, page.url()).href)
  ).json();
  expect(manifest.start_url).toBe('/rpg-trip/#/');
  expect(manifest.scope).toBe('/rpg-trip/');
  expect(manifest.id).toBe('/rpg-trip/');
  for (const icon of manifest.icons) {
    const response = await request.get(
      new URL(icon.src, `${origin}/rpg-trip/manifest.webmanifest`).href,
    );
    expect(response.ok()).toBe(true);
  }
  await page.getByLabel('AI 的完整回答').fill(wrapped());
  await page.getByRole('button', { name: '生成我的冒险', exact: true }).click();
  await page.getByRole('button', { name: '保存并开始', exact: true }).click();
  await expect(page).toHaveURL(/#\/quest\//);
  await controlled(page);
  const registration = await page.evaluate(
    async () => (await navigator.serviceWorker.ready).scope,
  );
  expect(registration).toBe(`${origin}/rpg-trip/`);
  if (info.project.name === 'webkit') {
    await request.post(`${origin}/__test/network?offline=true`);
    expect(
      await page.evaluate(async () => {
        try {
          await fetch('/rpg-trip/uncached-network-probe', {
            cache: 'no-store',
          });
          return false;
        } catch {
          return true;
        }
      }),
    ).toBe(true);
  } else await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByRole('heading', { name: fixture.quests[0].title, exact: true }),
  ).toBeVisible();
  await startQuest(page);
  await context.setOffline(false);
  await request.post(`${origin}/__test/network?offline=false`);
});

test('新版 SW 等待用户选择，保存并更新保留草稿、精确进度与同域其他缓存', async ({
  page,
  request,
}, info) => {
  test.setTimeout(90000);
  const origin = `http://127.0.0.1:${info.project.name === 'webkit' ? 4176 : 4174}`;
  await request.post(`${origin}/__test/network?offline=false`);
  await request.post(`${origin}/__test/deploy?release=a`);
  await page.goto(`${origin}/#/`);
  await expect(page.locator('meta[name=rpg-build]')).toHaveAttribute(
    'content',
    'acceptance-a',
  );
  await page.getByLabel('AI 的完整回答').fill(wrapped());
  await page.getByRole('button', { name: '生成我的冒险', exact: true }).click();
  await page.getByRole('button', { name: '保存并开始', exact: true }).click();
  await expect(page).toHaveURL(/#\/quest\//);
  const id = new URL(page.url()).hash.split('/')[2];
  await startQuest(page);
  await checkObjective(page.getByRole('checkbox').nth(1));
  await controlled(page);
  await page.evaluate(async () => {
    const other = await caches.open('unrelated-app-cache');
    await other.put('/other-app-marker', new Response('keep-me'));
  });
  await page.goto(`${origin}/#/`);
  await page.getByLabel(/目的地.*游览范围/).fill('SW 更新中的协议测试草稿');
  await request.post(`${origin}/__test/deploy?release=b`);
  await page.evaluate(async () => {
    await (await navigator.serviceWorker.ready).update();
  });
  await expect(
    page.getByRole('button', { name: '保存并更新', exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await expect(page.locator('meta[name=rpg-build]')).toHaveAttribute(
    'content',
    'acceptance-a',
  );
  await page.getByRole('button', { name: '稍后', exact: true }).click();
  await page
    .getByLabel(/目的地.*游览范围/)
    .fill('稍后继续编辑也不丢失 · 协议测试');
  await expect(page.locator('meta[name=rpg-build]')).toHaveAttribute(
    'content',
    'acceptance-a',
  );
  await page.waitForTimeout(700);
  // A fresh page detects the already-waiting worker without discarding current site storage.
  await page.reload();
  await expect(
    page.getByRole('button', { name: '保存并更新', exact: true }),
  ).toBeVisible();
  await page
    .getByLabel(/目的地.*游览范围/)
    .fill('更新按钮立即保存的协议测试草稿');
  await page.getByRole('button', { name: '保存并更新', exact: true }).click();
  await expect(page.locator('meta[name=rpg-build]')).toHaveAttribute(
    'content',
    'acceptance-b',
  );
  await expect(page.getByLabel(/目的地.*游览范围/)).toHaveValue(
    '更新按钮立即保存的协议测试草稿',
  );
  const otherCache = await page.evaluate(async () =>
    (
      await (
        await caches.open('unrelated-app-cache')
      ).match('/other-app-marker')
    )?.text(),
  );
  expect(otherCache).toBe('keep-me');
  await page.goto(`${origin}/#/quest/${id}`);
  await expect(page.getByRole('checkbox').nth(1)).toBeChecked();
  await expect(page.getByRole('checkbox').first()).not.toBeChecked();
});
