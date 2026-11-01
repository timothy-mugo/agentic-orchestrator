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
 * The Debug window: a live tail of the runtime's recent log. Lines arrive
 * already redacted and length-bounded. The view polls while it is open and
 * follows the end until the reader turns that off.
 */
import { useEffect, useRef, useState } from 'react';
import { useSystemAccentMirror, useTheme } from './hooks';

const POLL_MS = 1000;

export default function DebugWindow() {
  useTheme();
  useSystemAccentMirror();
  const [lines, setLines] = useState<readonly string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [follow, setFollow] = useState(true);
  const [copied, setCopied] = useState(false);
  const scrollerRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    document.title = 'Debug';
  }, []);

  useEffect(() => {
    let alive = true;
    let inFlight = false;
    const load = (): void => {
      if (!alive || inFlight) return;
      inFlight = true;
      window.agentico
        .getDebugLogs()
        .then((snapshot) => {
          if (!alive) return;
          setLines(snapshot.lines);
          setError(null);
        })
        .catch(() => {
          if (alive) setError('Logs could not be loaded.');
        })
        .finally(() => {
          inFlight = false;
        });
    };
    load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!follow) return;
    const node = scrollerRef.current;
    if (node !== null) node.scrollTop = node.scrollHeight;
  }, [follow, lines]);

  const text = lines?.join('\n') ?? '';
  const copy = (): void => {
    if (text === '') return;
    void window.agentico
      .writeClipboardText(text)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => undefined);
  };

  const body =
    error !== null && lines === null
      ? error
      : lines === null
        ? 'Loading logs…'
        : lines.length === 0
          ? 'No runtime log lines yet.'
          : text;

  return (
    <section className="debug-window" aria-label="Debug">
      <div className="debug-window__drag" aria-hidden="true" />
      <header className="debug-window__header">
        <div>
          <h1 className="debug-window__title">Debug</h1>
          <p className="debug-window__desc">
            Recent runtime output. Secrets and home-directory paths are removed before these lines
            are shown.
          </p>
        </div>
        <div className="debug-window__actions">
          <p className="debug-window__count" role="status">
            {lines === null ? '' : `${lines.length} ${lines.length === 1 ? 'line' : 'lines'}`}
          </p>
          <label className="debug-window__follow">
            <input
              type="checkbox"
              checked={follow}
              onChange={(event) => setFollow(event.currentTarget.checked)}
            />
            Follow
          </label>
          <button
            type="button"
            className="debug-window__copy"
            onClick={copy}
            disabled={text === ''}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </header>
      {error !== null && lines !== null ? (
        <p className="debug-window__error" role="status">
          {error}
        </p>
      ) : null}
      <pre
        ref={scrollerRef}
        className="debug-window__log"
        role="log"
        aria-label="Runtime logs"
        aria-live="off"
      >
        {body}
      </pre>
    </section>
  );
}
