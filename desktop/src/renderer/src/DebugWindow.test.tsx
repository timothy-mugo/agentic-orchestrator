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
});
