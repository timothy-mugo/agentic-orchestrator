import { describe, expect, it } from 'vitest';
import type { FeatureSummaryView, LivePreviewView, SessionSummary } from '../../../shared/ipc';
import {
  agentTaskLogs,
  featureDebugLines,
  filterLogLines,
  isRunningFeature,
} from './debugFeatureLog';

const FEATURE_ID = 'abcd1234ef567890';

function summary(status: string): FeatureSummaryView {
  return {
    id: FEATURE_ID,
    name: 'Search box',
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

function session(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: 'sess-1',
    featureId: FEATURE_ID,
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
    ...overrides,
  };
}

function preview(overrides: Partial<LivePreviewView> = {}): LivePreviewView {
  return {
    featureId: FEATURE_ID,
    activity: 'running',
    contextPercentage: 10,
    totalSeconds: 4,
    totalUsd: 0,
    session: session(),
    transcript: [
      { index: 0, role: 'assistant', type: 'tool_use', tool: 'Read' },
      { index: 1, role: 'assistant', type: 'tool_use', tool: 'Bash' },
    ],
    ...overrides,
  };
}

describe('feature debug log', () => {
  it('keeps a feature only while its status is a live phase', () => {
    expect(isRunningFeature(summary('Implementing'))).toBe(true);
    expect(isRunningFeature(summary('Published'))).toBe(false);
  });

  it('names the model, the current task, and what the model is doing', () => {
    expect(featureDebugLines(summary('Implementing'), preview())).toEqual([
      'model: anthropic / claude-opus',
      'task: Implement · Add log search',
      'doing: Using bash',
      'doing: Using read',
    ]);
  });

  it('falls back to the phase and the latest activity when no task is running', () => {
    const idle = preview({
      activity: 'Planning',
      session: session({
        taskActivities: [],
        runningTaskCount: 0,
        model: undefined,
        provider: undefined,
      }),
      transcript: [],
    });
    expect(featureDebugLines(summary('Planning'), idle)).toEqual([
      'model: unknown',
      'task: Implement',
      'doing: Planning',
    ]);
  });

  it('keeps a progress log for each agent task', () => {
    const live = preview({
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
        {
          index: 2,
          role: 'system',
          type: 'task_progress',
          task: { id: 'task-2', lastToolName: 'Grep' },
        },
      ],
    });
    const [running] = agentTaskLogs(FEATURE_ID, live);
    expect(running).toMatchObject({ id: 'task:abcd1234ef567890:task-1', label: 'Add log search' });
    expect(running?.lines).toEqual([
      'model: anthropic / claude-opus',
      'task: Add log search',
      'state: running',
      'doing: Using read',
      'doing: Using bash',
    ]);

    const settled = preview({
      session: session({
        taskActivities: [
          {
            taskId: 'task-2',
            description: 'Check callers',
            state: 'completed',
            summary: 'Wrote /Users/alice/notes',
            toolUses: 3,
            durationMs: 65_000,
            startedAt: '2026-11-01T00:00:00Z',
            updatedAt: '2026-11-01T00:01:05Z',
          },
        ],
        runningTaskCount: 0,
      }),
      transcript: [
        {
          index: 0,
          role: 'system',
          type: 'task_progress',
          task: { id: 'task-2', lastToolName: 'Grep' },
        },
      ],
    });
    expect(agentTaskLogs(FEATURE_ID, settled)[0]?.lines).toEqual([
      'model: anthropic / claude-opus',
      'task: Check callers',
      'state: completed',
      'progress: 3 tool uses · 1m 5s',
      'doing: Using grep',
      'done: Wrote [path]',
    ]);
  });

  it('filters log lines by a case-insensitive query', () => {
    const lines = ['model: claude-opus', 'doing: Using bash', 'doing: Reading notes'];
    expect(filterLogLines(lines, ' bash ')).toEqual(['doing: Using bash']);
    expect(filterLogLines(lines, '')).toEqual(lines);
  });
});
