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
 * The Debug window. Runtime output stays the first source. Each running
 * feature adds a log of its model, current task, and what the model is
 * doing, and each of that feature's agent tasks adds a progress log.
 * One search box filters whichever source is open.
 */
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import type { FeatureSummaryView } from '../../shared/ipc';
import {
  agentTaskLogs,
  featureDebugLines,
  filterLogLines,
  isRunningFeature,
  type AgentTaskLog,
} from './features/debugFeatureLog';
import { useSystemAccentMirror, useTheme } from './hooks';

const POLL_MS = 1000;
const RUNTIME_SOURCE = 'runtime';
/** A live preview per running feature; past this the rest wait for the next poll. */
const MAX_RUNNING_FEATURES = 20;

interface FeatureLog {
  id: string;
  name: string;
  lines: readonly string[];
  tasks: readonly AgentTaskLog[];
}

export default function DebugWindow() {
  useTheme();
  useSystemAccentMirror();
  const [lines, setLines] = useState<readonly string[] | null>(null);
  const [features, setFeatures] = useState<readonly FeatureLog[]>([]);
  const [source, setSource] = useState(RUNTIME_SOURCE);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [featureError, setFeatureError] = useState<string | null>(null);
  const [follow, setFollow] = useState(true);
  const [copied, setCopied] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.title = 'Debug';
  }, []);

  useEffect(() => {
    let alive = true;
    let inFlight = false;
    const load = (): void => {
      if (!alive || inFlight) return;
      inFlight = true;
      void Promise.all([window.agentico.getDebugLogs(), loadFeatureLogs()])
        .then(([snapshot, featureLogs]) => {
          if (!alive) return;
          setLines(snapshot.lines);
          setError(null);
          if (featureLogs.ok) {
            setFeatures(featureLogs.features);
            setFeatureError(null);
            setSource((current) =>
              sourceIds(featureLogs.features).includes(current) ? current : RUNTIME_SOURCE,
            );
          } else {
            setFeatureError(featureLogs.error);
          }
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

  const activeLines = linesForSource(source, lines, features);
  const visible = filterLogLines(activeLines, query);
  const text = visible.join('\n');

  useEffect(() => {
    if (!follow || query.trim() !== '') return;
    const node = scrollerRef.current;
    if (node !== null) node.scrollTop = node.scrollHeight;
  }, [follow, query, text]);

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

  const body = logBody({
    source,
    lines,
    error,
    visible,
    query,
  });
  const searching = query.trim() !== '';

  return (
    <section className="debug-window" aria-label="Debug">
      <div className="debug-window__drag" aria-hidden="true" />
      <header className="debug-window__header">
        <div className="debug-window__heading">
          <h1 className="debug-window__title">Debug</h1>
          <p className="debug-window__desc">
            Runtime output, a log for each running feature, and a progress log for each of its agent
            tasks. Secrets and home-directory paths are removed before lines are shown.
          </p>
          <label className="debug-window__search">
            <span className="debug-window__search-label">Search logs</span>
            <input
              type="search"
              value={query}
              placeholder="Search logs"
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
          </label>
        </div>
        <div className="debug-window__actions">
          <p className="debug-window__count" role="status">
            {lines === null && source === RUNTIME_SOURCE
              ? ''
              : countLabel(activeLines.length, visible.length, searching)}
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
      {featureError !== null ? (
        <p className="debug-window__error" role="status">
          {featureError}
        </p>
      ) : null}
      <div className="debug-window__body">
        <div
          className="debug-window__nav"
          role="listbox"
          aria-label="Log sources"
          onKeyDown={(event) => onSourceKeyDown(event, features, source, setSource)}
        >
          <SourceRow
            id={RUNTIME_SOURCE}
            label="Runtime"
            selected={source === RUNTIME_SOURCE}
            onSelect={setSource}
          />
          {features.map((feature) => (
            <div key={feature.id}>
              <SourceRow
                id={feature.id}
                label={feature.name}
                selected={source === feature.id}
                onSelect={setSource}
              />
              {feature.tasks.map((task) => (
                <SourceRow
                  key={task.id}
                  id={task.id}
                  label={task.label}
                  nested
                  selected={source === task.id}
                  onSelect={setSource}
                />
              ))}
            </div>
          ))}
          {features.length === 0 && featureError === null ? (
            <p className="debug-window__nav-empty">No features are running.</p>
          ) : null}
        </div>
        <div
          ref={scrollerRef}
          className="debug-window__log"
          role="log"
          aria-label={logLabel(source, features)}
          aria-live="off"
        >
          {body}
        </div>
      </div>
    </section>
  );
}

function SourceRow({
  id,
  label,
  nested = false,
  selected,
  onSelect,
}: {
  id: string;
  label: string;
  nested?: boolean;
  selected: boolean;
  onSelect(id: string): void;
}) {
  return (
    <div
      role="option"
      aria-selected={selected}
      tabIndex={selected ? 0 : -1}
      className={
        nested ? 'debug-window__source debug-window__source--task' : 'debug-window__source'
      }
      data-selected={selected}
      onClick={() => onSelect(id)}
    >
      {label}
    </div>
  );
}

function onSourceKeyDown(
  event: ReactKeyboardEvent<HTMLDivElement>,
  features: readonly FeatureLog[],
  source: string,
  onSelect: (id: string) => void,
): void {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  const ids = sourceIds(features);
  const current = Math.max(0, ids.indexOf(source));
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? ids.length - 1
        : event.key === 'ArrowDown'
          ? (current + 1) % ids.length
          : (current - 1 + ids.length) % ids.length;
  const id = ids[next];
  if (id === undefined) return;
  event.preventDefault();
  const target = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>('[role="option"]'),
  )[next];
  target?.focus();
  onSelect(id);
}

function logBody({
  source,
  lines,
  error,
  visible,
  query,
}: {
  source: string;
  lines: readonly string[] | null;
  error: string | null;
  visible: readonly string[];
  query: string;
}): ReactNode {
  if (source === RUNTIME_SOURCE && error !== null && lines === null) return error;
  if (source === RUNTIME_SOURCE && lines === null) return 'Loading logs…';
  if (visible.length === 0 && query.trim() !== '') return 'No lines match.';
  if (visible.length === 0) {
    return source === RUNTIME_SOURCE ? 'No runtime log lines yet.' : 'No activity recorded yet.';
  }
  return visible.map((line, index) => (
    <div key={`${index}-${line}`} className="debug-window__line">
      {highlight(line, query)}
    </div>
  ));
}

function highlight(line: string, query: string): ReactNode {
  const needle = query.trim();
  if (needle === '') return line;
  const index = line.toLocaleLowerCase().indexOf(needle.toLocaleLowerCase());
  if (index < 0) return line;
  return (
    <>
      {line.slice(0, index)}
      <mark>{line.slice(index, index + needle.length)}</mark>
      {line.slice(index + needle.length)}
    </>
  );
}

function sourceIds(features: readonly FeatureLog[]): string[] {
  return [
    RUNTIME_SOURCE,
    ...features.flatMap((feature) => [feature.id, ...feature.tasks.map((task) => task.id)]),
  ];
}

function linesForSource(
  source: string,
  lines: readonly string[] | null,
  features: readonly FeatureLog[],
): readonly string[] {
  if (source === RUNTIME_SOURCE) return lines ?? [];
  for (const feature of features) {
    if (feature.id === source) return feature.lines;
    const task = feature.tasks.find((item) => item.id === source);
    if (task !== undefined) return task.lines;
  }
  return [];
}

function logLabel(source: string, features: readonly FeatureLog[]): string {
  if (source === RUNTIME_SOURCE) return 'Runtime logs';
  if (features.some((feature) => feature.id === source)) return 'Feature logs';
  return 'Task logs';
}

function countLabel(total: number, shown: number, searching: boolean): string {
  if (!searching) return `${total} ${total === 1 ? 'line' : 'lines'}`;
  return `${shown} of ${total}`;
}

async function loadFeatureLogs(): Promise<
  { ok: true; features: FeatureLog[] } | { ok: false; error: string }
> {
  try {
    const listed = await window.agentico.listFeatures();
    const running = listed.features.filter(isRunningFeature).slice(0, MAX_RUNNING_FEATURES);
    const features = await Promise.all(running.map(loadOneFeature));
    return { ok: true, features };
  } catch {
    return { ok: false, error: 'Running features could not be loaded.' };
  }
}

async function loadOneFeature(feature: FeatureSummaryView): Promise<FeatureLog> {
  try {
    const preview = await window.agentico.getLivePreview(feature.id);
    return {
      id: feature.id,
      name: feature.name,
      lines: featureDebugLines(feature, preview),
      tasks: agentTaskLogs(feature.id, preview),
    };
  } catch {
    return {
      id: feature.id,
      name: feature.name,
      lines: featureDebugLines(feature, null),
      tasks: [],
    };
  }
}
