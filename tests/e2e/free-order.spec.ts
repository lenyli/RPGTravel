import { expect, test, type Page } from '@playwright/test';
import {
  checkObjective,
  completeQuest,
  dismissFeedback,
  downloadJson,
  fixture,
  importTrip,
  library,
  startQuest,
} from './helpers';

async function choosePlace(page: Page, instanceId: string, index: number) {
  await page.goto(`./#/route/${instanceId}`);
  const card = page.locator('article').filter({
    has: page.getByRole('heading', {
      name: fixture.quests[index].location.name,
      exact: true,
    }),
  });
  await card.getByRole('button', { name: /选择此地点|继续此地点/ }).click();
  await expect(page).toHaveURL(new RegExp(`quest/${instanceId}$`));
  await expect(
    page.getByRole('heading', {
      name: fixture.quests[index].title,
      exact: true,
    }),
  ).toBeVisible();
}

test('按地点自由选择 3→1→2，只有全部地点解决后才展示结局', async ({ page }) => {
  const id = await importTrip(page);
  await choosePlace(page, id, 2);
  await completeQuest(page, 2);
  await dismissFeedback(page);
  await expect(
    page.getByText(fixture.adventure.endingText, { exact: true }),
  ).toHaveCount(0);
  await page.goto(`./#/journal/${id}`);
  await expect(
    page.getByText(fixture.clues[2].content, { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(fixture.clues[0].content, { exact: true }),
  ).toHaveCount(0);
  await library(page);
  const partial = await downloadJson(page);
  expect(partial.progress.progressVersion).toBe(2);
  expect(partial.progress.quests.quest_03.status).toBe('completed');
  expect(partial.progress.quests.quest_01.status).toBe('available');
  expect(partial.progress.quests.quest_02.status).toBe('available');
  await choosePlace(page, id, 0);
  await completeQuest(page, 0);
  await dismissFeedback(page);
  await expect(
    page.getByText(fixture.adventure.endingText, { exact: true }),
  ).toHaveCount(0);
  await choosePlace(page, id, 1);
  await completeQuest(page, 1);
  await dismissFeedback(page);
  await expect(
    page.getByText(fixture.adventure.endingText, { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText(fixture.adventure.endingText, { exact: true }),
  ).toBeVisible();
});

test('部分行动可跨地点来回切换，刷新保留各地点精确勾选', async ({ page }) => {
  const id = await importTrip(page);
  await startQuest(page);
  await checkObjective(
    page.getByRole('checkbox', {
      name: fixture.quests[0].objectives[0].text,
      exact: true,
    }),
  );
  await choosePlace(page, id, 2);
  await startQuest(page);
  await checkObjective(
    page.getByRole('checkbox', {
      name: fixture.quests[2].objectives[2].text,
      exact: true,
    }),
  );
  await choosePlace(page, id, 0);
  await expect(page.getByRole('checkbox').first()).toBeChecked();
  await expect(page.getByRole('checkbox').nth(1)).not.toBeChecked();
  await page.reload();
  await expect(page.getByRole('checkbox').first()).toBeChecked();
  await choosePlace(page, id, 2);
  await expect(page.getByRole('checkbox').nth(2)).toBeChecked();
  await expect(page.getByRole('checkbox').first()).not.toBeChecked();
  await library(page);
  const backup = await downloadJson(page);
  expect(backup.progress.quests.quest_01.status).toBe('active');
  expect(backup.progress.quests.quest_03.status).toBe('active');
  expect(backup.progress.quests.quest_01.checkedObjectiveIds).toEqual([
    'objective_01',
  ]);
  expect(backup.progress.quests.quest_03.checkedObjectiveIds).toEqual([
    'objective_09',
  ]);
  expect(backup.progress.quests.quest_02.status).toBe('available');
});
