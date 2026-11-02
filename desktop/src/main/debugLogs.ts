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
 * The Debug window's view of the runtime log. The ring buffer is already
 * redacted on the way in; this pass redacts again and cuts every line to the
 * IPC contract, so a snapshot never crosses the boundary as stored.
 */
import { redactText } from '../shared/errors';
import {
  DEBUG_LOG_MAX_LINE_CHARS,
  DEBUG_LOG_MAX_LINES,
  type DebugLogSnapshot,
} from '../shared/ipc';

export function debugLogSnapshot(lines: readonly string[]): DebugLogSnapshot {
  return {
    lines: lines.slice(-DEBUG_LOG_MAX_LINES).map((line) => {
      const redacted = redactText(line);
      return redacted.length > DEBUG_LOG_MAX_LINE_CHARS
        ? redacted.slice(0, DEBUG_LOG_MAX_LINE_CHARS)
        : redacted;
    }),
  };
}
