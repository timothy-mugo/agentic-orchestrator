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

import { describe, expect, it } from 'vitest';
import { debugLogSnapshot } from '../debugLogs';
import { DEBUG_LOG_MAX_LINE_CHARS, DEBUG_LOG_MAX_LINES } from '../../shared/ipc';

describe('debugLogSnapshot', () => {
  it('redacts bearers and home-directory paths before a line can cross IPC', () => {
    expect(debugLogSnapshot(['listen Bearer tok-secret at /Users/alice/project ready'])).toEqual({
      lines: ['listen [redacted] at [path] ready'],
    });
  });

  it('keeps the newest lines and cuts each one to the contract limit', () => {
    const lines = Array.from({ length: DEBUG_LOG_MAX_LINES + 5 }, (_, index) => `line ${index}`);
    const snapshot = debugLogSnapshot(lines);
    expect(snapshot.lines).toHaveLength(DEBUG_LOG_MAX_LINES);
    expect(snapshot.lines[0]).toBe('line 5');
    expect(snapshot.lines.at(-1)).toBe(`line ${DEBUG_LOG_MAX_LINES + 4}`);

    const long = 'x'.repeat(DEBUG_LOG_MAX_LINE_CHARS + 25);
    expect(debugLogSnapshot([long]).lines[0]).toHaveLength(DEBUG_LOG_MAX_LINE_CHARS);
  });
});
