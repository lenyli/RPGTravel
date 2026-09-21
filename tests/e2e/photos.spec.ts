import { expect, test, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { downloadJson, fixture, home, importTrip, library } from './helpers';

const landscape = resolve('tests/fixtures/photo-e2e-landscape.png');
const detail = resolve('tests/fixtures/photo-e2e-detail.png');
const corrupt = resolve('tests/fixtures/photo-e2e-corrupt.jpg');

async function photos(page: Page, id: string, questId = 'quest_01') {
  const target = new URL(`./#/journal/${id}`, page.url()).href;
  await page.goto(target);
  await page.getByRole('tab', { name: /照片手记/ }).click();
  await page
    .getByRole('combobox', { name: '关联任务', exact: true })
    .selectOption(questId);
}

async function addPhoto(page: Page, caption: string, file = landscape) {
  await page
    .getByRole('textbox', { name: '照片说明（选填）', exact: true })
    .fill(caption);
  await page.getByLabel('选择任务照片', { exact: true }).setInputFiles(file);
  await expect(
    page.getByRole('button', { name: `查看照片：${caption}`, exact: true }),
  ).toBeVisible();
}

async function readableImage(page: Page, caption: string) {
  const image = page
    .getByRole('button', { name: `查看照片：${caption}`, exact: true })
    .getByRole('img');
  await expect(image).toBeVisible();
  await expect
    .poll(() =>
      image.evaluate(
        (element: HTMLImageElement) =>
          element.complete &&
          element.naturalWidth > 0 &&
          element.naturalHeight > 0,
      ),
    )
    .toBe(true);
  expect(await image.getAttribute('src')).toMatch(/^data:image\/jpeg;base64,/);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
}

test('旅章名称在界面、HTML 和安装 manifest 一致', async ({ page, request }) => {
  await home(page);
  await expect(page).toHaveTitle('旅章');
  await expect(
    page.getByRole('link', { name: '旅章 首页', exact: true }),
  ).toBeVisible();
  const manifestHref = await page
    .locator('link[rel=manifest]')
    .getAttribute('href');
  const manifest = await (
    await request.get(new URL(manifestHref!, page.url()).href)
  ).json();
  expect(manifest.name).toBe('旅章');
  expect(manifest.short_name).toBe('旅章');
});

test('未完成任务即可多选照片；刷新保留且各任务说明与照片隔离', async ({
  page,
}) => {
  const external: string[] = [];
  page.on('request', (request) => {
    if (
      /^https?:/.test(request.url()) &&
      !request.url().startsWith('http://127.0.0.1:')
    )
      external.push(request.url());
  });
  const id = await importTrip(page);
  await page
    .getByRole('link', { name: '为本任务添加照片', exact: true })
    .click();
  await expect(page.getByRole('tab', { name: /照片手记/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(
    page.getByRole('combobox', { name: '关联任务', exact: true }),
  ).toHaveValue('quest_01');
  await addPhoto(page, '到达前记录的山门');
  await readableImage(page, '到达前记录的山门');
  await page
    .getByRole('combobox', { name: '关联任务', exact: true })
    .selectOption('quest_03');
  await expect(
    page.getByRole('button', {
      name: '查看照片：到达前记录的山门',
      exact: true,
    }),
  ).toHaveCount(0);
  await page
    .getByRole('textbox', { name: '照片说明（选填）', exact: true })
    .fill('第三地点的两处细节');
  await page
    .getByLabel('选择任务照片', { exact: true })
    .setInputFiles([landscape, detail]);
  await expect(
    page.getByRole('button', {
      name: '查看照片：第三地点的两处细节',
      exact: true,
    }),
  ).toHaveCount(2);
  await page.reload();
  await photos(page, id, 'quest_03');
  await expect(
    page.getByRole('button', {
      name: '查看照片：第三地点的两处细节',
      exact: true,
    }),
  ).toHaveCount(2);
  await page
    .getByRole('combobox', { name: '关联任务', exact: true })
    .selectOption('quest_01');
  await readableImage(page, '到达前记录的山门');
  await library(page);
  const backup = await downloadJson(page);
  expect(backup.photos).toHaveLength(3);
  for (const quest of fixture.quests)
    expect(backup.progress.quests[quest.id].status).toBe('available');
  expect(external).toEqual([]);
});

test('照片可预览与修改说明，删除必须确认且取消不丢记录', async ({ page }) => {
  const id = await importTrip(page);
  await photos(page, id);
  await addPhoto(page, '最初说明');
  await page
    .getByRole('button', { name: '查看照片：最初说明', exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('img')).toBeVisible();
  await dialog
    .getByRole('textbox', { name: '编辑照片说明', exact: true })
    .fill('修改后的说明 <script>文本</script>');
  await dialog.getByRole('button', { name: '保存说明', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('照片说明已保存。');
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await page.reload();
  await photos(page, id);
  const photo = page.getByRole('button', {
    name: '查看照片：修改后的说明 <script>文本</script>',
    exact: true,
  });
  await expect(photo).toBeVisible();
  await photo.click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: '删除照片', exact: true })
    .click();
  const confirmation = page.getByRole('dialog').filter({
    has: page.getByRole('button', { name: '确认删除照片', exact: true }),
  });
  await confirmation.getByRole('button', { name: /取消|先不继续/ }).click();
  await expect(page.getByRole('dialog').getByRole('img')).toBeVisible();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: '删除照片', exact: true })
    .click();
  await page.getByRole('button', { name: '确认删除照片', exact: true }).click();
  await expect(photo).toHaveCount(0);
  await page.reload();
  await photos(page, id);
  await expect(page.getByRole('button', { name: /^查看照片：/ })).toHaveCount(
    0,
  );
});

test('损坏图片明确失败并保留已有照片，之后仍可正常添加', async ({ page }) => {
  const id = await importTrip(page);
  await photos(page, id);
  await addPhoto(page, '应保留的已有照片');
  await page.getByLabel('选择任务照片', { exact: true }).setInputFiles(corrupt);
  await expect(page.getByRole('alert').last()).toContainText(
    /图片|照片|读取|解码|格式/,
  );
  await readableImage(page, '应保留的已有照片');
  await expect(page.getByRole('button', { name: /^查看照片：/ })).toHaveCount(
    1,
  );
  await addPhoto(page, '失败后的新照片', detail);
  await expect(page.getByRole('button', { name: /^查看照片：/ })).toHaveCount(
    2,
  );
});

test('照片写入失败不伪装成功，重试原批次仅保存一次且旧照片保留', async ({
  page,
}) => {
  const id = await importTrip(page);
  await photos(page, id);
  await addPhoto(page, '已保存照片');
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (
      ...args: Parameters<IDBObjectStore['put']>
    ) {
      if (
        this.name === 'progress' &&
        !(window as Window & { allowPhotoWrite?: boolean }).allowPhotoWrite
      )
        throw new DOMException(
          'Simulated photo transaction failure',
          'QuotaExceededError',
        );
      return original.apply(this, args);
    };
  });
  await page
    .getByRole('textbox', { name: '照片说明（选填）', exact: true })
    .fill('重试后保存的照片');
  await page.getByLabel('选择任务照片', { exact: true }).setInputFiles(detail);
  await expect(page.getByRole('alert').first()).toContainText(
    /未保存|失败|空间/,
  );
  await expect(
    page.getByRole('button', {
      name: '查看照片：重试后保存的照片',
      exact: true,
    }),
  ).toHaveCount(0);
  await readableImage(page, '已保存照片');
  await expect(page.getByLabel('选择任务照片', { exact: true })).toBeDisabled();
  await page.evaluate(() => {
    (window as Window & { allowPhotoWrite?: boolean }).allowPhotoWrite = true;
  });
  await page
    .getByRole('button', { name: '重试保存 / 读取', exact: true })
    .click();
  await expect(
    page.getByRole('button', {
      name: '查看照片：重试后保存的照片',
      exact: true,
    }),
  ).toHaveCount(1);
  await expect(
    page.getByRole('button', { name: '重试保存照片', exact: true }),
  ).toHaveCount(0);
  await readableImage(page, '已保存照片');
  await page.reload();
  await photos(page, id);
  await expect(page.getByRole('button', { name: /^查看照片：/ })).toHaveCount(
    2,
  );
  await library(page);
  expect((await downloadJson(page)).photos).toHaveLength(2);
});

test('完整照片备份可恢复原关联与说明，故事导出和其他实例不包含照片', async ({
  page,
}) => {
  const original = await importTrip(page);
  await photos(page, original, 'quest_03');
  await addPhoto(page, '跨设备备份的第三地点照片');
  await library(page);
  const backup = await downloadJson(page);
  expect(backup.saveVersion).toBe(2);
  expect(backup.photos).toHaveLength(1);
  expect(backup.photos[0].questId).toBe('quest_03');
  const story = await downloadJson(page, '导出故事');
  expect(story.progress).toBeNull();
  expect(story.photos ?? []).toHaveLength(0);
  await home(page);
  await page.locator('input[type=file]').setInputFiles({
    name: 'photo-backup.rpgtrip.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  await page.getByRole('button', { name: '保存并开始', exact: true }).click();
  await page.getByRole('button', { name: '另存一份', exact: true }).click();
  await expect(page).toHaveURL(/#\/quest\//);
  const restored = new URL(page.url()).hash.split('/')[2];
  expect(restored).not.toBe(original);
  await photos(page, restored, 'quest_03');
  await readableImage(page, '跨设备备份的第三地点照片');
  await photos(page, restored, 'quest_01');
  await expect(page.getByRole('button', { name: /^查看照片：/ })).toHaveCount(
    0,
  );
  await home(page);
  await page.getByLabel('AI 的完整回答').fill(JSON.stringify(story));
  await page.getByRole('button', { name: '生成我的冒险', exact: true }).click();
  await page.getByRole('button', { name: '保存并开始', exact: true }).click();
  await page.getByRole('button', { name: '另存一份', exact: true }).click();
  await expect(page).toHaveURL(/#\/quest\//);
  const clean = new URL(page.url()).hash.split('/')[2];
  await photos(page, clean, 'quest_03');
  await expect(page.getByRole('button', { name: /^查看照片：/ })).toHaveCount(
    0,
  );
  await photos(page, original, 'quest_03');
  await readableImage(page, '跨设备备份的第三地点照片');
});

test('已缓存应用断网关闭重开仍可读取照片并导出完整备份', async ({
  page,
  context,
  request,
}, info) => {
  const webkit = info.project.name === 'webkit';
  const origin = `http://127.0.0.1:${webkit ? 4178 : 4173}`;
  if (webkit) {
    await request.post(`${origin}/__test/deploy?release=a`);
    await request.post(`${origin}/__test/network?offline=false`);
  }
  await page.goto(`${origin}/#/`);
  const id = await importTrip(page);
  await photos(page, id);
  await addPhoto(page, '离线山门照片');
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
  try {
    if (webkit) {
      await request.post(`${origin}/__test/network?offline=true`);
      expect(
        await page.evaluate(async () => {
          try {
            await fetch('/uncached-photo-probe', { cache: 'no-store' });
            return false;
          } catch {
            return true;
          }
        }),
      ).toBe(true);
    } else await context.setOffline(true);
    await page.close();
    const reopened = await context.newPage();
    await reopened.goto(`${origin}/#/journal/${id}`);
    await reopened.getByRole('tab', { name: /照片手记/ }).click();
    await reopened
      .getByRole('combobox', { name: '关联任务', exact: true })
      .selectOption('quest_01');
    await readableImage(reopened, '离线山门照片');
    await library(reopened);
    const backup = await downloadJson(reopened);
    expect(backup.saveVersion).toBe(2);
    expect(backup.photos).toHaveLength(1);
  } finally {
    await context.setOffline(false);
    if (webkit) await request.post(`${origin}/__test/network?offline=false`);
  }
});
