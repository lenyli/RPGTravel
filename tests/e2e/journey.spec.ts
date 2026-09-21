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
  preview,
  screenshot,
  skipQuest,
  startQuest,
  wrapped,
} from './helpers';

test('首页直接为表单；复制完整 Prompt 且草稿在关闭重开后保留', async ({
  page,
  context,
}, info) => {
  await mockClipboard(page);
  await home(page);
  await expect(page.getByLabel('开始日期', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('结束日期', { exact: true })).toHaveValue('');
  await screenshot(page, info, 'home-empty-mobile');
  if (info.project.name === 'chromium') {
    await page.setViewportSize({ width: 1280, height: 900 });
    await screenshot(page, info, 'home-empty-desktop');
    await page.setViewportSize({ width: 390, height: 844 });
  }
  await fillTravelForm(page);
  await page
    .getByRole('button', { name: '复制生成 Prompt', exact: true })
    .click();
  await expect(
    page.getByText('已复制，发给你常用的 AI 即可', { exact: false }),
  ).toBeVisible();
  const prompt = await page.evaluate(
    () => (window as Window & { capturedClipboard?: string }).capturedClipboard,
  );
  expect(prompt).toContain('RPG_TRIP_V1');
  expect(prompt).toContain('"schemaVersion"');
  expect(prompt).toContain('"1.1"');
  expect(prompt).toContain('"2026-09-23"');
  expect(prompt).toContain('"2026-09-24"');
  expect(prompt).toContain(
    JSON.stringify('哨兵隐私约束 "限定"\n第二行 & 不走山路'),
  );
  expect(prompt).not.toContain(fixture.adventure.title);
  await page.getByLabel('AI 的完整回答').fill('未完成粘贴草稿，协议测试');
  await page.waitForTimeout(700);
  await screenshot(page, info, 'home-mobile');
  await page.close();
  const reopened = await context.newPage();
  await home(reopened);
  await expect(reopened.getByLabel(/目的地.*游览范围/)).toHaveValue(
    '协议测试目的地 A&B “引号”',
  );
  await expect(reopened.getByLabel('AI 的完整回答')).toHaveValue(
    '未完成粘贴草稿，协议测试',
  );
});

test('复制失败提供完整可选文本；导入错误保留原文并提供完整修复 Prompt', async ({
  page,
}) => {
  await mockClipboard(page, true);
  await home(page);
  await fillTravelForm(page);
  await page
    .getByRole('button', { name: '复制生成 Prompt', exact: true })
    .click();
  const fallback = page.getByLabel('手动复制文本');
  await expect(fallback).toBeVisible();
  expect(await fallback.inputValue()).toContain('"schemaVersion"');
  await expect(
    page.getByText('已复制，发给你常用的 AI 即可', { exact: false }),
  ).toHaveCount(0);
  const incomplete = '<RPG_TRIP_V1>{"schemaVersion":"1.0"}';
  await page.getByLabel('AI 的完整回答').fill(incomplete);
  await page.getByRole('button', { name: '生成我的冒险', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(/结尾|不完整/);
  await expect(page.getByLabel('AI 的完整回答')).toHaveValue(incomplete);
  await page
    .getByRole('button', { name: '复制修复 Prompt', exact: true })
    .click();
  const repair = await fallback.last().inputValue();
  expect(repair).toContain(JSON.stringify(incomplete));
  expect(repair).toContain('"schemaVersion"');
  expect(repair).toContain('path');
  expect(repair).not.toContain('哨兵隐私约束');
});

test('导入预览只展示概要；地点可自由选择且未开始剧情不泄露；完成所有地点后收束', async ({
  page,
}, info) => {
  await preview(page);
  await expect(
    page.getByText(fixture.adventure.title, { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(fixture.adventure.endingText, { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText(fixture.quests[1].story.scene, { exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: '保存并开始', exact: true }).click();
  await expect(page).toHaveURL(/#\/quest\//);
  const instanceId = new URL(page.url()).hash.split('/')[2];
  await expect(
    page.getByText(fixture.npcs[0].description, { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText(fixture.clues[0].content, { exact: true }),
  ).toHaveCount(0);
  await page.goto(`./#/route/${instanceId}`);
  await expect(
    page.getByRole('heading', { name: '地点与任务', exact: true }),
  ).toBeVisible();
  for (const quest of fixture.quests) {
    await expect(
      page.getByText(quest.location.name, { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(quest.visit.safetyNote, { exact: false }),
    ).toBeVisible();
  }
  await expect(
    page.getByText(fixture.quests[1].title, { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(fixture.quests[2].story.scene, { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText('待解锁', { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: '选择此地点', exact: true }),
  ).toHaveCount(3);
  await screenshot(page, info, 'places-mobile');
  await page.goto(`./#/quest/${instanceId}`);
  await screenshot(page, info, 'quest-current-mobile');
  for (let index = 0; index < fixture.quests.length; index++) {
    await completeQuest(page, index);
    await expect(
      page.getByText(fixture.clues[index].content, { exact: true }),
    ).toBeVisible();
    if (index === 0) await screenshot(page, info, 'quest-completed-mobile');
    await dismissFeedback(page);
  }
  await expect(
    page.getByText(fixture.adventure.endingText, { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText(fixture.adventure.endingText, { exact: true }),
  ).toBeVisible();
  await screenshot(page, info, 'ending-mobile');
});

test('跳过可取消；补叙不伪造勾选，含跳过的结局正确表述', async ({ page }) => {
  const id = await importTrip(page);
  await startQuest(page);
  await checkObjective(page.getByRole('checkbox').first());
  await page.getByRole('button', { name: /现场无法完成/ }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: '先不继续', exact: true })
    .click();
  await expect(page.getByRole('checkbox').first()).toBeChecked();
  await expect(page.getByRole('checkbox').nth(1)).not.toBeChecked();
  await skipQuest(page);
  await expect(
    page.getByText(fixture.quests[0].visit.fallbackText, { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('剧情补叙所得', { exact: false }).first(),
  ).toBeVisible();
  await dismissFeedback(page);
  await completeQuest(page, 1);
  await dismissFeedback(page);
  await skipQuest(page);
  await dismissFeedback(page);
  await expect(
    page.getByText('故事已收束，含 2 个跳过任务', { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText(fixture.adventure.endingText, { exact: true }),
  ).toBeVisible();
  await page.goto(`./#/journal/${id}`);
  await page.getByRole('tab', { name: /冒险日志/ }).click();
  await expect(
    page.getByText(fixture.quests[0].visit.fallbackText, { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(fixture.quests[0].completionText, { exact: true }),
  ).toHaveCount(0);
  await library(page);
  const backup = await downloadJson(page);
  expect(backup.progress.quests.quest_01.status).toBe('skipped');
  expect(backup.progress.quests.quest_01.checkedObjectiveIds).toEqual([
    'objective_01',
  ]);
  expect(backup.progress.quests.quest_03.checkedObjectiveIds).toEqual([]);
});

test('同故事重复导入明确选择，另存实例与同 adventure.id 的新故事进度隔离', async ({
  page,
}) => {
  const first = await importTrip(page);
  await startQuest(page);
  await checkObjective(page.getByRole('checkbox').first());
  await preview(page);
  await page.getByRole('button', { name: '保存并开始', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: '打开已有存档', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`quest/${first}$`));
  await expect(page.getByRole('checkbox').first()).toBeChecked();
  await preview(page);
  await page.getByRole('button', { name: '保存并开始', exact: true }).click();
  await page.getByRole('button', { name: '另存一份', exact: true }).click();
  const second = new URL(page.url()).hash.split('/')[2];
  expect(second).not.toBe(first);
  await expect(
    page.getByRole('button', { name: '我已到达，开始调查', exact: true }),
  ).toBeVisible();
  const other = structuredClone(fixture);
  other.adventure.title = '另一封信 · 协议测试';
  const third = await importTrip(page, other);
  expect(third).not.toBe(first);
  await library(page);
  await expect(page.locator('article')).toHaveCount(3);
  await page.goto(`./#/quest/${first}`);
  await expect(page.getByRole('checkbox').first()).toBeChecked();
});

test('完整存档导出恢复精确进度；故事导出从零开始；文件导入可用', async ({
  page,
}) => {
  const original = await importTrip(page);
  await completeQuest(page, 0);
  await dismissFeedback(page);
  await startQuest(page);
  await checkObjective(page.getByRole('checkbox').nth(1));
  await library(page);
  const backup = await downloadJson(page);
  expect(backup.format).toBe('RPG_TRIP_SAVE');
  expect(backup.progress.currentQuestId).toBe('quest_02');
  expect(backup.progress.quests.quest_02.checkedObjectiveIds).toEqual([
    'objective_05',
  ]);
  expect(Object.keys(backup).sort()).toEqual([
    'adventureData',
    'exportedAt',
    'format',
    'progress',
    'saveVersion',
  ]);
  const story = await downloadJson(page, '导出故事');
  expect(story.progress).toBeNull();
  await home(page);
  await page.locator('input[type=file]').setInputFiles({
    name: 'protocol-test.rpgtrip.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  await page.getByRole('button', { name: '保存并开始', exact: true }).click();
  if (
    await page.getByRole('button', { name: '另存一份', exact: true }).count()
  ) {
    await page.getByRole('button', { name: '另存一份', exact: true }).click();
  }
  await expect(page).not.toHaveURL(new RegExp(`quest/${original}$`));
  await expect(page.getByRole('checkbox').nth(1)).toBeChecked();
  await expect(page.getByRole('checkbox').first()).not.toBeChecked();
  await page.reload();
  await expect(page.getByRole('checkbox').nth(1)).toBeChecked();
  await preview(page, JSON.stringify(story));
  await page.getByRole('button', { name: '保存并开始', exact: true }).click();
  await page.getByRole('button', { name: '另存一份', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: fixture.quests[0].title, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: '我已到达，开始调查', exact: true }),
  ).toBeVisible();
});

test('进度损坏不静默清零，明确选择仅导入故事；未知备份版本拒绝', async ({
  page,
}) => {
  await importTrip(page);
  await startQuest(page);
  await library(page);
  const backup = await downloadJson(page);
  backup.progress.currentQuestId = 'missing_quest';
  await home(page);
  await page.getByLabel('AI 的完整回答').fill(JSON.stringify(backup));
  await page.getByRole('button', { name: '生成我的冒险', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('CURRENT_QUEST_MISMATCH');
  await expect(
    page.getByRole('button', { name: '保存并开始', exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole('button', { name: '只导入故事，重新开始', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: '保存并开始', exact: true }),
  ).toBeVisible();
  backup.saveVersion = 999;
  await home(page);
  await page.getByLabel('AI 的完整回答').fill(JSON.stringify(backup));
  await page.getByRole('button', { name: '生成我的冒险', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(/版本|不支持/);
});

test('重开与删除均确认，取消保持内容，只操作指定实例', async ({ page }) => {
  const first = await importTrip(page);
  await startQuest(page);
  await checkObjective(page.getByRole('checkbox').first());
  const secondData = structuredClone(fixture);
  secondData.adventure.title = '另一段旅程 · 协议测试';
  const second = await importTrip(page, secondData);
  await library(page);
  const firstCard = page.locator('article').filter({
    has: page.getByRole('heading', {
      name: fixture.adventure.title,
      exact: true,
    }),
  });
  await firstCard.getByRole('button', { name: '重开', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText(fixture.adventure.title);
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /取消|先不继续/ })
    .click();
  await page.goto(`./#/quest/${first}`);
  await expect(page.getByRole('checkbox').first()).toBeChecked();
  await library(page);
  await firstCard.getByRole('button', { name: '重开', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: '确认重开', exact: true })
    .click();
  await page.goto(`./#/quest/${first}`);
  await expect(
    page.getByRole('button', { name: '我已到达，开始调查', exact: true }),
  ).toBeVisible();
  await library(page);
  await firstCard.getByRole('button', { name: '删除', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /取消|先不继续/ })
    .click();
  await expect(page.locator('article')).toHaveCount(2);
  await firstCard.getByRole('button', { name: '删除', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: '确认删除', exact: true })
    .click();
  await expect(page.locator('article')).toHaveCount(1);
  await page.goto(`./#/quest/${second}`);
  await expect(
    page.getByRole('button', { name: '我已到达，开始调查', exact: true }),
  ).toBeVisible();
});

test('恶意 HTML 是纯文本，未点击地图/来源不发第三方请求', async ({ page }) => {
  const external: string[] = [];
  page.on('request', (request) => {
    if (
      /^https?:/.test(request.url()) &&
      !request.url().startsWith('http://127.0.0.1:')
    )
      external.push(request.url());
  });
  const hostile = structuredClone(fixture);
  const payload =
    '<img src="https://attacker.invalid/pixel" onerror="window.__pwned=1"><script>window.__pwned=2</script>';
  hostile.quests[0].story.scene = payload;
  await importTrip(page, hostile);
  await startQuest(page);
  await expect(page.getByText(payload, { exact: true })).toBeVisible();
  await expect(page.locator('img[src*="attacker.invalid"]')).toHaveCount(0);
  expect(
    await page.evaluate(
      () => (window as Window & { __pwned?: number }).__pwned,
    ),
  ).toBeUndefined();
  expect(external).toEqual([]);
  await importTrip(page, {
    ...fixture,
    adventure: {
      ...fixture.adventure,
      sources: [
        {
          id: 'source_script',
          title: '脚本形式原文',
          url: 'javascript:alert(1)',
          checkedOn: '2026-09-20',
        },
        {
          id: 'source_markdown',
          title: 'Markdown 来源',
          url: '[https://example.com/travel](https://example.com/travel)',
          checkedOn: '2026-09-20',
        },
        {
          id: 'source_text',
          title: '原样保留的来源',
          url: 'www.example.com/旅行 资料',
          checkedOn: '2026-09-20',
        },
      ],
    },
  });
  await page.getByText('出行提醒与信息来源', { exact: true }).click();
  await expect(
    page.getByText('javascript:alert(1)', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: '脚本形式原文' })).toHaveCount(0);
  await expect(page.locator('a[href^="javascript:"]')).toHaveCount(0);
  await expect(
    page.getByRole('link', { name: 'Markdown 来源 ↗', exact: true }),
  ).toHaveAttribute('href', 'https://example.com/travel');
  await expect(
    page.getByText('[https://example.com/travel](https://example.com/travel)', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText('www.example.com/旅行 资料', { exact: true }),
  ).toBeVisible();
  expect(external).toEqual([]);
});

test('重复标记与章节别名可预览，不同故事可在本机选择导入', async ({ page }) => {
  const { adventure, ...body } = structuredClone(fixture);
  const compatible = {
    ...body,
    ...adventure,
    chapters: body.chapters.map(({ area: _area, intro, ...chapter }) => ({
      ...chapter,
      subtitle: intro,
    })),
  };
  const duplicate = `复制 <RPG_TRIP_V1> 到 </RPG_TRIP_V1> 的故事：\n${wrapped(compatible)}\n${wrapped(compatible)}`;
  await preview(page, duplicate);
  await expect(page.getByRole('dialog')).toContainText(fixture.adventure.title);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await home(page);

  const second = {
    ...fixture,
    adventure: { ...fixture.adventure, title: '第二份协议测试故事' },
  };
  const multiple = `${wrapped()}\n${wrapped(second)}`;
  await page.getByLabel('AI 的完整回答').fill(multiple);
  await page.getByRole('button', { name: '生成我的冒险', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('选择要导入的故事');
  await expect(
    page.getByRole('button', { name: '复制修复 Prompt', exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole('button', { name: '第 2 份 · 第二份协议测试故事', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toContainText('第二份协议测试故事');
  await expect(page.getByLabel('AI 的完整回答')).toHaveValue(multiple);
  await page.getByRole('button', { name: '保存并开始', exact: true }).click();
  await expect(page).toHaveURL(/#\/quest\//);
  await library(page);
  await expect(page.locator('article')).toHaveCount(1);
  await expect(page.locator('article')).toContainText('第二份协议测试故事');
});
