/**
 * The Debug window's per-feature log. A running feature contributes a short
 * log: which model is on the session, the task it is in, and what that model
 * is doing, plus the recent activity labels so the same search box that
 * filters the runtime log can find a tool or a task. Each agent task on that
 * session also contributes its own progress log.
 */
import type {
  FeatureSummaryView,
  LivePreviewView,
  SessionSummary,
  SessionTaskActivity,
  TranscriptMessage,
} from '../../../shared/ipc';
import { redactText } from '../../../shared/errors';
import { ACTIVE_STATUSES } from './featureView';
import { activityLabel, friendlyToolName } from './transcript/conversation';

/** How many earlier activity lines a feature log keeps behind the live snapshot. */
const ACTIVITY_HISTORY_LIMIT = 80;
/** Agent tasks shown under one feature. Running tasks come first. */
const MAX_AGENT_TASKS = 12;
/** Free-form task text is clipped so a prompt-sized description cannot flood the log. */
const TASK_TEXT_LIMIT = 500;

/** One agent task's progress log, addressed separately from its feature. */
export interface AgentTaskLog {
  id: string;
  label: string;
  lines: string[];
}

export function isRunningFeature(feature: FeatureSummaryView): boolean {
  return ACTIVE_STATUSES.has(feature.status);
}

export function filterLogLines(lines: readonly string[], query: string): string[] {
  const needle = query.trim().toLocaleLowerCase();
  if (needle === '') return [...lines];
  return lines.filter((line) => line.toLocaleLowerCase().includes(needle));
}

export function featureDebugLines(
  feature: Pick<FeatureSummaryView, 'currentPhase' | 'status'>,
  preview: LivePreviewView | null,
): string[] {
  const session = preview?.session;
  const model = modelLabel(session);
  const running = (session?.taskActivities ?? []).filter((task) => task.state === 'running');
  const current = running.length > 0 ? linesForTasks(feature.currentPhase, running) : [];
  const fallback =
    current.length > 0
      ? []
      : [
          `task: ${feature.currentPhase || feature.status}`,
          `doing: ${fallbackDoing(preview, feature.status)}`,
        ];
  const shown = new Set(
    [...current, ...fallback]
      .filter((line) => line.startsWith('doing: '))
      .map((line) => line.slice('doing: '.length)),
  );
  const history = activityHistory(preview?.transcript ?? []).filter((label) => !shown.has(label));
  return [
    `model: ${model}`,
    ...current,
    ...fallback,
    ...history.map((label) => `doing: ${clip(label)}`),
  ];
}

/** Progress logs for the agent tasks on a feature's live session. */
export function agentTaskLogs(featureId: string, preview: LivePreviewView | null): AgentTaskLog[] {
  const model = modelLabel(preview?.session);
  const transcript = preview?.transcript ?? [];
  return tasksForLog(preview?.session?.taskActivities ?? []).map((task, index) => ({
    id: `task:${featureId}:${task.taskId || index}`,
    label: taskLabel(task),
    lines: agentTaskDebugLines(task, transcript, model),
  }));
}

function agentTaskDebugLines(
  task: SessionTaskActivity,
  transcript: readonly TranscriptMessage[],
  model: string,
): string[] {
  const progress = progressLabels(task.taskId, transcript);
  const current = currentStep(task);
  if (current !== null && progress.at(-1) !== current) progress.push(current);
  if (progress.length === 0) progress.push(doingForTask(task));
  const done = doneLine(task);
  const usage = usageLine(task);
  return [
    `model: ${model}`,
    `task: ${taskLabel(task)}`,
    `state: ${task.state}`,
    ...(usage === null ? [] : [usage]),
    ...progress.map((label) => `doing: ${label}`),
    ...(done === null ? [] : [done]),
  ];
}

function modelLabel(session: SessionSummary | undefined): string {
  return (
    [session?.provider, session?.model]
      .map((part) => part?.trim() ?? '')
      .filter((part) => part !== '')
      .join(' / ') || 'unknown'
  );
}

function tasksForLog(tasks: readonly SessionTaskActivity[]): SessionTaskActivity[] {
  return [...tasks]
    .sort((left, right) => {
      const byState = rank(left) - rank(right);
      if (byState !== 0) return byState;
      return right.updatedAt.localeCompare(left.updatedAt);
    })
    .slice(0, MAX_AGENT_TASKS);
}

function rank(task: SessionTaskActivity): number {
  return task.state === 'running' ? 0 : 1;
}

function taskLabel(task: SessionTaskActivity): string {
  return clip(task.description?.trim() || task.taskId || 'Agent task');
}

function progressLabels(taskId: string, transcript: readonly TranscriptMessage[]): string[] {
  const id = taskId.trim();
  if (id === '') return [];
  const labels: string[] = [];
  for (const entry of transcript) {
    if (entry.task?.id?.trim() !== id) continue;
    const type = entry.type.toLocaleLowerCase();
    if (type === 'task_started' || type === 'task_notification') continue;
    const tool = entry.task?.lastToolName?.trim() || entry.tool?.trim();
    if (!tool) continue;
    const label = `Using ${friendlyToolName(tool)}`;
    if (labels.at(-1) === label) continue;
    labels.push(label);
  }
  return labels.slice(-ACTIVITY_HISTORY_LIMIT);
}

function doneLine(task: SessionTaskActivity): string | null {
  if (task.state === 'running') return null;
  const summary = clip(task.summary ?? '');
  if (summary !== '') return `done: ${summary}`;
  const status = clip(task.status ?? '');
  if (status !== '' && status.toLocaleLowerCase() !== task.state) return `done: ${status}`;
  return null;
}

function usageLine(task: SessionTaskActivity): string | null {
  const parts: string[] = [];
  if (task.toolUses !== undefined && task.toolUses > 0) {
    parts.push(`${task.toolUses} tool ${task.toolUses === 1 ? 'use' : 'uses'}`);
  }
  if (task.durationMs !== undefined && task.durationMs > 0) {
    parts.push(formatDuration(task.durationMs));
  }
  return parts.length === 0 ? null : `progress: ${parts.join(' · ')}`;
}

function formatDuration(durationMs: number): string {
  const seconds = Math.floor(durationMs / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
  const hours = Math.floor(minutes / 60);
  const minutesLeft = minutes % 60;
  return minutesLeft === 0 ? `${hours}h` : `${hours}h ${minutesLeft}m`;
}

function clip(text: string): string {
  const clean = redactText(text).replace(/\s+/g, ' ').trim();
  if (clean.length <= TASK_TEXT_LIMIT) return clean;
  return `${clean.slice(0, TASK_TEXT_LIMIT - 1)}…`;
}

function linesForTasks(phase: string, tasks: readonly SessionTaskActivity[]): string[] {
  return tasks.flatMap((task) => {
    const description = clip(task.description?.trim() || task.taskId);
    return [`task: ${withPhase(phase, description)}`, `doing: ${doingForTask(task)}`];
  });
}

function withPhase(phase: string, description: string): string {
  if (phase.trim() === '') return description;
  if (description.toLocaleLowerCase().includes(phase.trim().toLocaleLowerCase()))
    return description;
  return `${phase} · ${description}`;
}

function currentStep(task: SessionTaskActivity): string | null {
  const tool = task.lastToolName?.trim();
  return tool ? `Using ${friendlyToolName(tool)}` : null;
}

function doingForTask(task: SessionTaskActivity): string {
  const tool = task.lastToolName?.trim();
  if (tool) return `Using ${friendlyToolName(tool)}`;
  const summary = clip(task.summary ?? '');
  if (summary !== '') return summary;
  const status = clip(task.status ?? '');
  if (status !== '') return status;
  return 'Working';
}

function fallbackDoing(preview: LivePreviewView | null, status: string): string {
  const latest = activityHistory(preview?.transcript ?? []).at(-1);
  if (latest) return clip(latest);
  const activity = clip(preview?.activity ?? '');
  if (activity !== '') return activity;
  return clip(status) || status;
}

function activityHistory(transcript: readonly TranscriptMessage[]): string[] {
  const labels: string[] = [];
  for (const entry of transcript) {
    const label = activityLabel(entry)?.trim();
    if (!label) continue;
    if (labels.at(-1) === label) continue;
    labels.push(label);
  }
  return labels.slice(-ACTIVITY_HISTORY_LIMIT);
}
