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
 * Groups sidebar features under project folders. A feature lives in the
 * folder of its first repository. Catalog repositories with no features
 * still appear, so an empty project can be opened the way an empty
 * workspace shows "No features". The folder label is the repository's
 * directory name; two checkouts of the same name stay separate folders.
 */
export interface ProjectCatalogEntry {
  name: string;
  path: string;
}

export interface ProjectMember {
  id: string;
  repos: readonly string[];
  createdAt: string;
}

export interface ProjectFolder<T> {
  id: string;
  /** Directory name shown on the folder row. */
  label: string;
  /** Accessible name. Distinct when two folders share a directory name. */
  accessibleName: string;
  path?: string;
  features: T[];
}

const UNASSIGNED_ID = 'project:';

/** Last path segment, accepting both POSIX and Windows separators. */
function folderBasename(path: string): string | undefined {
  const parts = path.split(/[/\\]/).filter((part) => part !== '');
  return parts.length > 0 ? parts[parts.length - 1] : undefined;
}

function createdMillis(createdAt: string): number {
  const parsed = Date.parse(createdAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

function byNewest<T extends ProjectMember>(left: T, right: T): number {
  const delta = createdMillis(right.createdAt) - createdMillis(left.createdAt);
  return delta !== 0 ? delta : left.id.localeCompare(right.id);
}

function homeRepository(feature: ProjectMember): string | undefined {
  return feature.repos.find((repo) => repo !== '');
}

/**
 * Groups features by project. Named projects that contain features come
 * first, newest work on top. Features with no repository follow in a
 * "No project" folder, and empty catalog projects come last.
 */
export function groupFeaturesByProject<T extends ProjectMember>(
  snapshots: readonly T[],
  catalog: readonly ProjectCatalogEntry[],
): ProjectFolder<T>[] {
  const byName = new Map<string, ProjectCatalogEntry>();
  for (const entry of catalog) {
    if (entry.name !== '' && !byName.has(entry.name)) byName.set(entry.name, entry);
  }

  const featuresByProject = new Map<string, T[]>();
  const ensure = (id: string): T[] => {
    const existing = featuresByProject.get(id);
    if (existing !== undefined) return existing;
    const created: T[] = [];
    featuresByProject.set(id, created);
    return created;
  };

  for (const name of byName.keys()) ensure(name);
  for (const feature of snapshots) {
    ensure(homeRepository(feature) ?? UNASSIGNED_ID).push(feature);
  }

  const folders: ProjectFolder<T>[] = [];
  for (const [id, features] of featuresByProject) {
    const ordered = features.slice().sort(byNewest);
    if (id === UNASSIGNED_ID) {
      if (ordered.length === 0) continue;
      folders.push({
        id,
        label: 'No project',
        accessibleName: 'No project',
        features: ordered,
      });
      continue;
    }
    const entry = byName.get(id);
    const label = (entry !== undefined ? folderBasename(entry.path) : undefined) ?? id;
    folders.push({
      id,
      label,
      accessibleName: label,
      ...(entry !== undefined && entry.path !== '' ? { path: entry.path } : {}),
      features: ordered,
    });
  }

  const labelCounts = new Map<string, number>();
  for (const folder of folders) {
    labelCounts.set(folder.label, (labelCounts.get(folder.label) ?? 0) + 1);
  }
  for (const folder of folders) {
    if ((labelCounts.get(folder.label) ?? 0) < 2) continue;
    folder.accessibleName =
      folder.path !== undefined
        ? `${folder.label}, ${folder.path}`
        : `${folder.label}, ${folder.id}`;
  }

  folders.sort((left, right) => {
    const leftEmpty = left.features.length === 0 ? 1 : 0;
    const rightEmpty = right.features.length === 0 ? 1 : 0;
    if (leftEmpty !== rightEmpty) return leftEmpty - rightEmpty;
    if (left.id === UNASSIGNED_ID) return 1;
    if (right.id === UNASSIGNED_ID) return -1;
    const recency =
      createdMillis(right.features[0]?.createdAt ?? '') -
      createdMillis(left.features[0]?.createdAt ?? '');
    if (recency !== 0) return recency;
    const label = left.label.localeCompare(right.label, undefined, { sensitivity: 'base' });
    return label !== 0 ? label : left.id.localeCompare(right.id);
  });
  return folders;
}
