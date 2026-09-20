import { expect, test } from '@playwright/test';
import {
  checkObjective,
  dismissFeedback,
  fixture,
  home,
  importTrip,
  library,
  screenshot,
  startQuest,
  downloadJson,
  skipQuest,
} from './helpers';

for (const action of ['complete', 'skip'] as const) {
  test(`提交 ${action} 保存失败后重试，仍呈现正确反馈并仅推进一次`, async ({
    page,
  }) => {
    await importTrip(page);
    await startQuest(page);
    if (action === 'complete') {
      for (const box of await page.getByRole('checkbox').all())
        await checkObjective(box);
    }
    await page.evaluate(() => {
      const original = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (
        ...args: Parameters<IDBObjectStore['put']>
      ) {
        if (
          this.name === 'progress' &&
          !(window as Window & { allowProgressWrite?: boolean })
            .allowProgressWrite
        )
          throw new DOMException(
            'Simulated submit failure',
            'QuotaExceededError',
          );
        return original.apply(this, args);
      };
    });
    if (action === 'complete')
      await page.getByRole('button', { name: '完成调查', exact: true }).click();
    else await skipQuest(page);
    await expect(page.getByRole('alert').first()).toContainText(/未保存|失败/);
    if (await page.getByRole('dialog').count())
      await page
        .getByRole('dialog')
        .getByRole('button', { name: '先不继续', exact: true })
        .click();
    await page.evaluate(() => {
      (window as Window & { allowProgressWrite?: boolean }).allowProgressWrite =
        true;
    });
    await page.getByRole('button', { name: /重试保存.*读取/ }).click();
    await expect(
      page.getByText(
        action === 'complete'
          ? fixture.quests[0].completionText
          : fixture.quests[0].visit.fallbackText,
        { exact: true },
      ),
    ).toBeVisible();
    await dismissFeedback(page);
    await expect(
      page.getByRole('heading', { name: fixture.quests[1].title, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: '我已到达，开始调查', exact: true }),
    ).toBeVisible();
  });
}

test('损坏的草稿设置不导致白屏，现有冒险仍可读取', async ({ page }) => {
  await importTrip(page);
  await page.waitForTimeout(700);
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('rpg-travel', 1);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction('settings', 'readwrite');
        tx.objectStore('settings').put(
          { input: { destination: null }, raw: 4 },
          'draft',
        );
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
  });
  await page.reload();
  await home(page);
  await expect(page.getByLabel('AI 的完整回答')).toBeVisible();
  await expect(
    page.getByText(/草稿.*损坏|草稿.*异常|草稿.*读取|草稿.*格式/),
  ).toBeVisible();
  await library(page);
  await expect(
    page.getByRole('heading', { name: fixture.adventure.title, exact: true }),
  ).toBeVisible();
});

test('键盘跳到主要内容保留 hash 路由并真正移动焦点', async ({ page }) => {
  await importTrip(page);
  const before = page.url();
  await page.getByRole('link', { name: '跳到主要内容', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(before);
  await expect(page.locator('main')).toBeFocused();
});

test('导航只使用受控地图域名与编码地址，无坐标也能开始', async ({ page }) => {
  const data = structuredClone(fixture);
  data.quests[0].location.name = '中文地点 & 书页 · 协议测试';
  data.quests[0].location.query = '中文地点 & 书页 · 协议测试';
  data.quests[0].location.address = '虚构测试区 A&B 街 1 号';
  await importTrip(page, data);
  await expect(
    page.getByText('可导航，暂无可靠坐标', { exact: false }),
  ).toBeVisible();
  await page.getByRole('button', { name: /打开地图确认地点/ }).click();
  const dialog = page.getByRole('dialog');
  for (const [name, host, parameter] of [
    ['Google Maps', 'www.google.com', 'query'],
    ['Apple 地图', 'maps.apple.com', 'q'],
    ['高德地图', 'uri.amap.com', 'keyword'],
  ]) {
    const link = dialog.getByRole('link', { name: new RegExp(name) });
    const url = new URL((await link.getAttribute('href'))!);
    expect(url.hostname).toBe(host);
    expect(url.searchParams.get(parameter)).toContain('中文地点 & 书页');
    expect(url.searchParams.get(parameter)).toContain('虚构测试区 A&B 街 1 号');
    expect(url.searchParams.has('center')).toBe(false);
    expect(url.searchParams.has('origin')).toBe(false);
    await expect(link).toHaveAttribute('rel', /noopener/);
    await expect(link).toHaveAttribute('rel', /noreferrer/);
  }
  await dialog.getByRole('button', { name: /关闭|返回/ }).click();
  await startQuest(page);
});

for (const state of ['success', 'denied', 'timeout', 'unavailable'] as const) {
  test(`一次性前台定位：${state}，不影响手动开始`, async ({ page }) => {
    await page.addInitScript((mode) => {
      let count = 0;
      Object.defineProperty(navigator, 'geolocation', {
        configurable: true,
        value: {
          getCurrentPosition(
            success: PositionCallback,
            error: PositionErrorCallback,
          ) {
            (window as Window & { geoCalls?: number }).geoCalls = ++count;
            setTimeout(() => {
              if (mode === 'success')
                success({
                  coords: { latitude: 0, longitude: 0, accuracy: 25 },
                  timestamp: Date.now(),
                } as GeolocationPosition);
              else
                error({
                  code: mode === 'denied' ? 1 : mode === 'unavailable' ? 2 : 3,
                } as GeolocationPositionError);
            }, 0);
          },
          watchPosition() {
            throw new Error('Persistent geolocation is forbidden');
          },
        },
      });
    }, state);
    const data = structuredClone(fixture);
    // These values deliberately exercise valid numeric zero; never used as real travel advice.
    data.adventure.sources = [
      {
        id: 'source_coordinates',
        title: '模拟坐标来源，仅工程测试',
        url: 'https://example.com/synthetic',
        checkedOn: '2026-09-20',
      },
    ] as typeof data.adventure.sources;
    Object.assign(data.quests[0].location, {
      latitude: 0,
      longitude: 0.001,
      coordinateSourceId: 'source_coordinates',
    });
    await importTrip(page, data);
    expect(
      await page.evaluate(
        () => (window as Window & { geoCalls?: number }).geoCalls || 0,
      ),
    ).toBe(0);
    await page
      .getByRole('button', { name: '查看我与任务地点的距离', exact: true })
      .click();
    const expected =
      state === 'success'
        ? /直线距离/
        : state === 'denied'
          ? /拒绝|未授权|未允许/
          : state === 'timeout'
            ? /超时/
            : /不可用|无法获取|无法取得/;
    await expect(page.getByText(expected).last()).toBeVisible();
    if (state === 'success')
      await expect(page.getByText(/25.*米/).last()).toBeVisible();
    expect(
      await page.evaluate(
        () => (window as Window & { geoCalls?: number }).geoCalls,
      ),
    ).toBe(1);
    await startQuest(page);
    for (const box of await page.getByRole('checkbox').all())
      await checkObjective(box);
    await page.getByRole('button', { name: '完成调查', exact: true }).click();
    await expect(
      page.getByText(fixture.quests[0].completionText, { exact: true }),
    ).toBeVisible();
    await library(page);
    const backup = await downloadJson(page);
    expect(JSON.stringify(backup.progress)).not.toMatch(
      /latitude|longitude|accuracy/,
    );
  });
}

test('数据库不能打开时保留可操作中文错误，不调用删除数据库', async ({
  page,
}) => {
  await page.addInitScript(() => {
    indexedDB.open = () => {
      throw new DOMException('Simulated unavailable storage', 'SecurityError');
    };
    indexedDB.deleteDatabase = () => {
      throw new Error('Must not erase user data');
    };
  });
  await page.goto('./#/');
  await expect(page.getByRole('alert')).toContainText(/本机|存储|数据库/);
  await expect(page.getByRole('button', { name: /重试/ })).toBeVisible();
});

test('进度写入失败显著提示未保存，重试成功后恢复精确行动', async ({ page }) => {
  const id = await importTrip(page);
  await startQuest(page);
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (
      ...args: Parameters<IDBObjectStore['put']>
    ) {
      if (
        this.name === 'progress' &&
        !(window as Window & { allowProgressWrite?: boolean })
          .allowProgressWrite
      ) {
        throw new DOMException('Simulated quota failure', 'QuotaExceededError');
      }
      return original.apply(this, args);
    };
  });
  await page.getByRole('checkbox').first().click();
  await expect(page.getByRole('alert')).toContainText(/未保存|失败/);
  await page.evaluate(() => {
    (window as Window & { allowProgressWrite?: boolean }).allowProgressWrite =
      true;
  });
  await page.getByRole('button', { name: /重试保存|重试/ }).click();
  await page.goto(`./#/quest/${id}`);
  await expect(page.getByRole('checkbox').first()).toBeChecked();
});

test('360/390px、横屏、桌面与 200% 文字没有页面横向溢出，底栏不覆盖末项', async ({
  page,
}, info) => {
  const data = structuredClone(fixture);
  data.quests[0].location.address =
    '虚构测试场景超长中文地址用于验证换行与窄屏阅读，'.repeat(12);
  await importTrip(page, data);
  await startQuest(page);
  for (const viewport of [
    { width: 360, height: 780 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
    { width: 1280, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    ).toBe(true);
    const finish = page.getByRole('button', { name: '完成调查', exact: true });
    await finish.scrollIntoViewIfNeeded();
    const box = await finish.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
  await screenshot(page, info, 'quest-text-200-percent');
  await home(page);
  await page.setViewportSize({ width: 390, height: 360 });
  await page.getByLabel('AI 的完整回答').focus();
  await page
    .getByRole('button', { name: '生成我的冒险', exact: true })
    .scrollIntoViewIfNeeded();
  await expect(
    page.getByRole('button', { name: '生成我的冒险', exact: true }),
  ).toBeInViewport();
});
