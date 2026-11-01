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

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import DebugWindow from './DebugWindow';
import { installAgenticoMock } from './test/agenticoMock';

afterEach(() => {
  cleanup();
});

describe('DebugWindow', () => {
  it('shows the runtime log and copies it', async () => {
    const mock = installAgenticoMock();
    mock.api.getDebugLogs.mockResolvedValue({ lines: ['runtime ready', 'gateway attached'] });
    render(<DebugWindow />);

    expect(await screen.findByText(/runtime ready/)).toBeTruthy();
    expect(screen.getByRole('log', { name: 'Runtime logs' }).textContent).toContain(
      'gateway attached',
    );
    expect(screen.getByRole('status').textContent).toBe('2 lines');
    expect(document.title).toBe('Debug');

    await userEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(mock.api.writeClipboardText).toHaveBeenCalledWith('runtime ready\ngateway attached');
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeTruthy();
  });

  it('says when the runtime has not written anything yet', async () => {
    installAgenticoMock();
    render(<DebugWindow />);
    expect(await screen.findByText('No runtime log lines yet.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy' })).toBeDisabled();
  });

  it('reports a load failure without inventing lines', async () => {
    const mock = installAgenticoMock();
    mock.api.getDebugLogs.mockRejectedValue(new Error('unavailable'));
    render(<DebugWindow />);
    expect(await screen.findByText('Logs could not be loaded.')).toBeTruthy();
  });

  it('filters the open log as the search changes', async () => {
    const mock = installAgenticoMock();
    mock.api.getDebugLogs.mockResolvedValue({ lines: ['runtime ready', 'gateway attached'] });
    render(<DebugWindow />);
    await screen.findByText('runtime ready');

    await userEvent.type(screen.getByRole('searchbox', { name: 'Search logs' }), 'gateway');

    const log = screen.getByRole('log', { name: 'Runtime logs' });
    expect(log.textContent).toBe('gateway attached');
    expect(screen.getByRole('status').textContent).toBe('1 of 2');
  });

  it('lists each running feature with its model, task, and current activity', async () => {
    const mock = installAgenticoMock();
    mock.api.listFeatures.mockResolvedValue({
      features: [
        featureSummary('abcd1234ef567890', 'Search box', 'Implementing'),
        featureSummary('idle1234ef567890ab', 'Idle feature', 'Published'),
      ],
      warnings: [],
    });
    mock.api.getLivePreview.mockResolvedValue({
      featureId: 'abcd1234ef567890',
      activity: 'running',
      contextPercentage: 10,
      totalSeconds: 4,
      totalUsd: 0,
      session: {
        id: 'sess-1',
        featureId: 'abcd1234ef567890',
        runNumber: 1,
        phase: 'Implement',
        kind: 'phase',
        provider: 'anthropic',
        model: 'claude-opus',
        status: 'running',
        startedAt: '2026-11-01T00:00:00Z',
        taskActivities: [
          {
            taskId: 'task-1',
            description: 'Add log search',
            state: 'running',
            lastToolName: 'Bash',
            startedAt: '2026-11-01T00:00:00Z',
            updatedAt: '2026-11-01T00:00:01Z',
          },
        ],
        runningTaskCount: 1,
        usage: {},
      },
      transcript: [],
    });
    render(<DebugWindow />);

    const feature = await screen.findByRole('option', { name: 'Search box' });
    expect(screen.queryByRole('option', { name: 'Idle feature' })).toBeNull();
    await userEvent.click(feature);

    const log = screen.getByRole('log', { name: 'Feature logs' });
    expect(log.textContent).toContain('model: anthropic / claude-opus');
    expect(log.textContent).toContain('task: Implement · Add log search');
    expect(log.textContent).toContain('doing: Using bash');
    expect(mock.api.getLivePreview).toHaveBeenCalledWith('abcd1234ef567890');
  });

  it('opens an agent task log with that task’s progress', async () => {
    const mock = installAgenticoMock();
    mock.api.listFeatures.mockResolvedValue({
      features: [featureSummary('abcd1234ef567890', 'Search box', 'Implementing')],
      warnings: [],
    });
    mock.api.getLivePreview.mockResolvedValue({
      featureId: 'abcd1234ef567890',
      activity: 'running',
      contextPercentage: 10,
      totalSeconds: 4,
      totalUsd: 0,
      session: {
        id: 'sess-1',
        featureId: 'abcd1234ef567890',
        runNumber: 1,
        phase: 'Implement',
        kind: 'phase',
        provider: 'anthropic',
        model: 'claude-opus',
        status: 'running',
        startedAt: '2026-11-01T00:00:00Z',
        taskActivities: [
          {
            taskId: 'task-1',
            description: 'Add log search',
            state: 'running',
            lastToolName: 'Bash',
            toolUses: 2,
            startedAt: '2026-11-01T00:00:00Z',
            updatedAt: '2026-11-01T00:00:01Z',
          },
        ],
        runningTaskCount: 1,
        usage: {},
      },
      transcript: [
        {
          index: 0,
          role: 'system',
          type: 'task_progress',
          task: { id: 'task-1', lastToolName: 'Read' },
        },
        {
          index: 1,
          role: 'system',
          type: 'task_progress',
          task: { id: 'task-1', lastToolName: 'Bash' },
        },
      ],
    });
    render(<DebugWindow />);

    await userEvent.click(await screen.findByRole('option', { name: 'Add log search' }));

    const log = screen.getByRole('log', { name: 'Task logs' });
    expect(log.textContent).toContain('state: running');
    expect(log.textContent).toContain('progress: 2 tool uses');
    expect(log.textContent).toContain('doing: Using read');
    expect(log.textContent).toContain('doing: Using bash');
  });
});

function featureSummary(id: string, name: string, status: string) {
  return {
    id,
    name,
    status,
    currentPhase: 'Implement',
    repos: [],
    createdAt: '2026-11-01T00:00:00Z',
    activeRun: 1,
    runCount: 1,
    warnings: [],
    errors: [],
  };
}
