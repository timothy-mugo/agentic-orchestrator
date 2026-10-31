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

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import type { SkillCatalogEntry } from '../../../shared/ipc';
import { installAgenticoMock } from '../test/agenticoMock';
import { SkillsPane } from './SkillsPane';

afterEach(cleanup);

const goGuideline: SkillCatalogEntry = {
  id: 'guideline:go',
  name: 'Go',
  description: 'Go best practices',
  kind: 'guideline',
  origin: 'builtin',
  path: '/state/guidelines/go/index.md',
  enabled: true,
  toggleable: true,
};

const implement: SkillCatalogEntry = {
  id: 'skill:implement',
  name: 'implement',
  description: 'Implement the plan',
  kind: 'skill',
  origin: 'builtin',
  path: '/state/skills/implement/SKILL.md',
  enabled: true,
  toggleable: false,
};

const debugging: SkillCatalogEntry = {
  id: 'external:systematic-debugging',
  name: 'systematic-debugging',
  description: 'Find the root cause before fixing',
  kind: 'skill',
  origin: 'external',
  path: '/skills/systematic-debugging/SKILL.md',
  enabled: false,
  toggleable: true,
};

describe('SkillsPane', () => {
  it('turns a discovered skill on and a language guideline off', async () => {
    const user = userEvent.setup();
    const mock = installAgenticoMock();
    mock.api.getSkillCatalog.mockResolvedValue({
      roots: ['/skills/superpowers'],
      implicitRoots: ['/Users/tim/.agents/skills'],
      entries: [goGuideline, implement, debugging],
    });
    mock.api.updateSkillPolicy.mockImplementation(
      async (policy: { roots: string[]; disabled: string[]; enabled: string[] }) => ({
        roots: policy.roots,
        implicitRoots: ['/Users/tim/.agents/skills'],
        entries: [
          { ...goGuideline, enabled: !policy.disabled.includes(goGuideline.id) },
          implement,
          { ...debugging, enabled: policy.enabled.includes(debugging.id) },
        ],
      }),
    );

    render(<SkillsPane remote={false} />);

    const debugSwitch = await screen.findByRole('checkbox', { name: /systematic-debugging/ });
    expect(debugSwitch).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: /implement/ })).toBeDisabled();
    expect(screen.getByText('/Users/tim/.agents/skills')).toBeVisible();

    await user.click(debugSwitch);
    await waitFor(() =>
      expect(mock.api.updateSkillPolicy).toHaveBeenCalledWith({
        roots: ['/skills/superpowers'],
        disabled: [],
        enabled: ['external:systematic-debugging'],
      }),
    );
    expect(debugSwitch).toBeChecked();

    await user.click(screen.getByRole('checkbox', { name: /^Go/ }));
    await waitFor(() =>
      expect(mock.api.updateSkillPolicy).toHaveBeenLastCalledWith({
        roots: ['/skills/superpowers'],
        disabled: ['guideline:go'],
        enabled: ['external:systematic-debugging'],
      }),
    );
  });

  it('adds a skill folder the user picks', async () => {
    const user = userEvent.setup();
    const mock = installAgenticoMock();
    mock.api.getSkillCatalog.mockResolvedValue({
      roots: [],
      implicitRoots: [],
      entries: [],
    });
    mock.api.pickWorkspaceDirectory.mockResolvedValue({ path: '/skills/superpowers' });
    mock.api.updateSkillPolicy.mockImplementation(async (policy: { roots: string[] }) => ({
      roots: policy.roots,
      implicitRoots: [],
      entries: [],
    }));

    render(<SkillsPane remote={false} />);
    await screen.findByRole('button', { name: 'Add skill folder' });
    await user.click(screen.getByRole('button', { name: 'Add skill folder' }));

    await waitFor(() =>
      expect(mock.api.updateSkillPolicy).toHaveBeenCalledWith({
        roots: ['/skills/superpowers'],
        disabled: [],
        enabled: [],
      }),
    );
  });
});
