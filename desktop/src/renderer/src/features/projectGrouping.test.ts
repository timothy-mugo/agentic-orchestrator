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
import { groupFeaturesByProject, type ProjectCatalogEntry, type ProjectMember } from './projectGrouping';

function feature(id: string, repos: string[], createdAt: string): ProjectMember {
  return { id, repos, createdAt };
}

const catalog: ProjectCatalogEntry[] = [
  { name: 'lloopd', path: '/work/Lloopd' },
  { name: 'tcdi-cd', path: '/work/tcdi-cd' },
  { name: 'west/qareplus-website', path: '/work/west/qareplus-website' },
  { name: 'east/qareplus-website', path: '/work/east/qareplus-website' },
  { name: 'idle-lib', path: '/work/idle-lib' },
];

describe('groupFeaturesByProject', () => {
  it('files each feature under its first repository and lists empty projects', () => {
    const folders = groupFeaturesByProject(
      [
        feature('newer', ['lloopd', 'tcdi-cd'], '2026-10-02T00:00:00Z'),
        feature('older', ['lloopd'], '2026-10-01T00:00:00Z'),
        feature('other', ['tcdi-cd'], '2026-09-01T00:00:00Z'),
        feature('loose', [], '2026-08-01T00:00:00Z'),
      ],
      catalog,
    );

    expect(folders.map((folder) => [folder.label, folder.features.map((item) => item.id)])).toEqual([
      ['Lloopd', ['newer', 'older']],
      ['tcdi-cd', ['other']],
      ['No project', ['loose']],
      ['idle-lib', []],
      ['qareplus-website', []],
      ['qareplus-website', []],
    ]);
    expect(folders[0]).toMatchObject({ path: '/work/Lloopd', accessibleName: 'Lloopd' });
    const duplicates = folders.filter((folder) => folder.label === 'qareplus-website');
    expect(duplicates.map((folder) => folder.accessibleName).sort()).toEqual([
      'qareplus-website, /work/east/qareplus-website',
      'qareplus-website, /work/west/qareplus-website',
    ]);
  });

  it('keeps a feature whose repository is not in the catalog', () => {
    const folders = groupFeaturesByProject(
      [feature('only', ['', 'orphan-app'], '2026-10-01T00:00:00Z')],
      [],
    );
    expect(folders).toEqual([
      {
        id: 'orphan-app',
        label: 'orphan-app',
        accessibleName: 'orphan-app',
        features: [feature('only', ['', 'orphan-app'], '2026-10-01T00:00:00Z')],
      },
    ]);
  });

  it('reads a Windows path basename as the folder name', () => {
    const folders = groupFeaturesByProject(
      [],
      [{ name: 'client', path: 'C:\\work\\qareplus-client-app' }],
    );
    expect(folders.map((folder) => folder.label)).toEqual(['qareplus-client-app']);
  });
});
