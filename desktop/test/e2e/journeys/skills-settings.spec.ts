/*
Copyright 2026 DoorDash, Inc.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

/**
 * Settings → Skills against the packaged app. The pane lists the server's
 * skill catalog, and a language-guideline switch is saved through the
 * runtime-config mutation and comes back from the next read.
 */
import { expect, test } from '@playwright/test';
import {
  assertNoLeakedProcesses,
  closeApp,
  evidenceShot,
  launchApp,
  openSettings,
  persistAppLogs,
  selectSettingsPane,
  type AppHandle,
} from '../helpers/app';
import { createRepo, createWorld, destroyWorld } from '../helpers/world';

test('Settings Skills saves a language-guideline switch', async ({}, testInfo) => {
  test.setTimeout(180_000);
  const world = createWorld('skills-settings', {
    auth: { loggedIn: true, authMethod: 'oauth', email: 'e2e@example.invalid' },
    presetWorkspaceRoot: true,
  });
  createRepo(world, 'alpha', { commit: true });
  let handle: AppHandle | null = null;

  try {
    handle = await launchApp(world, testInfo, { traceName: 'skills-settings' });
    await expect(handle.page.getByRole('button', { name: 'New feature' })).toBeVisible({
      timeout: 60_000,
    });
    const settings = await openSettings(handle);
    await selectSettingsPane(settings, 'Skills');
    await expect(settings.getByRole('heading', { name: 'Skills', exact: true })).toBeVisible();
    const go = settings.getByRole('checkbox', { name: /^Go/ });
    await expect(go).toBeVisible({ timeout: 30_000 });
    const wasChecked = await go.isChecked();
    await go.click();
    await expect(go).toBeChecked({ checked: !wasChecked });
    await evidenceShot(handle, 'skills-settings-guideline-switch', settings);
    persistAppLogs(handle, 'skills-settings');
  } finally {
    if (handle !== null) await closeApp(handle).catch(() => {});
    assertNoLeakedProcesses(world);
    destroyWorld(world);
  }
});
