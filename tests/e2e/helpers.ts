import {
  expect,
  type Locator,
  type Page,
  type TestInfo,
} from '@playwright/test';
import { readFile } from 'node:fs/promises';
import trip from '../fixtures/valid-trip.json' with { type: 'json' };

export const fixture = trip;
export const wrapped = (value: unknown = fixture) =>
  `<RPG_TRIP_V1>\n${JSON.stringify(value)}\n</RPG_TRIP_V1>`;

export async function home(page: Page) {
  const close = page
    .getByRole('dialog')
    .getByRole('button', { name: '关闭', exact: true });
  if (await close.count()) await close.click();
  const target = page.url().startsWith('http')
    ? new URL('./#/', page.url()).href
    : './#/';
  if (page.url() !== target) await page.goto(target);
  await expect(page.getByLabel('AI 的完整回答')).toBeVisible();
}

export async function preview(page: Page, value: unknown = fixture) {
  await home(page);
  await page
    .getByLabel('AI 的完整回答')
    .fill(typeof value === 'string' ? value : wrapped(value));
  await page.getByRole('button', { name: '生成我的冒险', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '保存并开始', exact: true }),
  ).toBeVisible();
}

export async function importTrip(page: Page, value: unknown = fixture) {
  await preview(page, value);
  await page.getByRole('button', { name: '保存并开始', exact: true }).click();
  await expect(page).toHaveURL(/#\/quest\//);
  return new URL(page.url()).hash.split('/')[2];
}

export async function startQuest(page: Page) {
  await page
    .getByRole('button', { name: '我已到达，开始调查', exact: true })
    .click();
  await expect(page.getByRole('checkbox').first()).toBeEnabled();
}

export async function completeQuest(page: Page, index: number) {
  const current = fixture.quests[index];
  await startQuest(page);
  for (const objective of current.objectives) {
    await checkObjective(
      page.getByRole('checkbox', { name: objective.text, exact: true }),
    );
  }
  // The last checkbox must not auto-complete or navigate.
  await expect(
    page.getByRole('heading', { name: current.title, exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '完成调查', exact: true }).click();
  await expect(
    page.getByText(current.completionText, { exact: true }),
  ).toBeVisible();
}

export async function checkObjective(checkbox: Locator) {
  // The UI commits IndexedDB before publishing the new checked state.
  if (!(await checkbox.isChecked())) await checkbox.click();
  await expect(checkbox).toBeChecked();
  await expect(checkbox).toBeEnabled();
}

export async function dismissFeedback(page: Page) {
  const button = page.getByRole('button', {
    name: /继续下一节|继续调查|查看下一节|前往下一节|查看结局|继续冒险/,
  });
  await expect(button.first()).toBeVisible();
  await button.first().click();
  await expect(button).toHaveCount(0);
}

export async function skipQuest(page: Page) {
  await page.getByRole('button', { name: /现场无法完成/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('跳过');
  await dialog.getByRole('button', { name: '确认跳过', exact: true }).click();
}

export async function library(page: Page) {
  await page.goto(
    page.url().startsWith('http')
      ? new URL('./#/library', page.url()).href
      : './#/library',
  );
  await expect(
    page.getByRole('heading', { name: '我的冒险', exact: true }),
  ).toBeVisible();
}

export async function downloadJson(page: Page, name = '导出完整存档') {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name, exact: true }).first().click();
  const download = await pending;
  expect(download.suggestedFilename()).toMatch(/\.rpgtrip\.json$/);
  const path = await download.path();
  expect(path).not.toBeNull();
  return JSON.parse(await readFile(path!, 'utf8'));
}

export async function screenshot(page: Page, info: TestInfo, name: string) {
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true });
  await info.attach(name, { path, contentType: 'image/png' });
}

export async function mockClipboard(page: Page, rejection = false) {
  await page.addInitScript((reject) => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          if (reject)
            throw new DOMException(
              'Simulated clipboard rejection',
              'NotAllowedError',
            );
          (
            window as Window & { capturedClipboard?: string }
          ).capturedClipboard = text;
        },
      },
    });
  }, rejection);
}

export async function fillTravelForm(page: Page) {
  await page.getByLabel(/目的地.*游览范围/).fill('协议测试目的地 A&B “引号”');
  await page.getByLabel('开始日期', { exact: true }).fill('2026-09-23');
  await page.getByLabel('结束日期', { exact: true }).fill('2026-09-24');
  await page
    .getByLabel(/旅行限制/)
    .fill('哨兵隐私约束 "限定"\n第二行 & 不走山路');
}
