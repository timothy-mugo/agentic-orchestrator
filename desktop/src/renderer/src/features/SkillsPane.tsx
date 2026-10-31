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
 * Settings → Skills. Lists the language guidelines and skills the connected
 * server can offer an agent, and saves each switch through the runtime config.
 */
import { useCallback, useEffect, useState } from 'react';
import type { SkillCatalog, SkillCatalogEntry, SkillPolicy } from '../../../shared/ipc';
import { parseIpcError } from '../wizard/ipcError';

const EMPTY_CATALOG: SkillCatalog = { roots: [], implicitRoots: [], entries: [] };

function policyFor(catalog: SkillCatalog, roots = catalog.roots): SkillPolicy {
  return {
    roots,
    disabled: catalog.entries
      .filter((entry) => entry.toggleable && entry.origin === 'builtin' && !entry.enabled)
      .map((entry) => entry.id),
    enabled: catalog.entries
      .filter((entry) => entry.origin === 'external' && entry.enabled)
      .map((entry) => entry.id),
  };
}

export function SkillsPane({ remote }: { remote: boolean }) {
  const [catalog, setCatalog] = useState<SkillCatalog>(EMPTY_CATALOG);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setCatalog(await window.agentico.getSkillCatalog());
    } catch (err) {
      setError(parseIpcError(err).summary);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const save = useCallback(async (policy: SkillPolicy) => {
    setBusy(true);
    setError(null);
    try {
      setCatalog(await window.agentico.updateSkillPolicy(policy));
    } catch (err) {
      setError(parseIpcError(err).summary);
    } finally {
      setBusy(false);
    }
  }, []);

  const toggle = (entry: SkillCatalogEntry) => {
    const next = {
      ...catalog,
      entries: catalog.entries.map((row) =>
        row.id === entry.id ? { ...row, enabled: !row.enabled } : row,
      ),
    };
    void save(policyFor(next));
  };

  const addFolder = async () => {
    setError(null);
    try {
      const picked = await window.agentico.pickWorkspaceDirectory();
      if (picked.path === null) return;
      if (catalog.roots.includes(picked.path) || catalog.implicitRoots.includes(picked.path)) {
        return;
      }
      await save(policyFor(catalog, [...catalog.roots, picked.path]));
    } catch (err) {
      setError(parseIpcError(err).summary);
    }
  };

  const removeFolder = (path: string) => {
    void save(
      policyFor(
        catalog,
        catalog.roots.filter((root) => root !== path),
      ),
    );
  };

  const guidelines = catalog.entries.filter((entry) => entry.kind === 'guideline');
  const builtin = catalog.entries.filter(
    (entry) => entry.kind === 'skill' && entry.origin === 'builtin',
  );
  const external = catalog.entries.filter((entry) => entry.origin === 'external');

  return (
    <section className="settings-panel__section" aria-label="Skills">
      <h2 className="settings-panel__section-title">Skills</h2>
      <p className="settings-panel__section-desc">
        A switch that is on puts that skill or language guideline into the agent prompt, and the
        agent reads it when the work matches. Skills found in a folder stay off until you turn them
        on. A phase skill stays on because that phase reads it.
      </p>
      {error !== null && <p className="settings-panel__section-desc">{error}</p>}
      {loading ? (
        <p className="settings-panel__section-desc">Loading skills…</p>
      ) : (
        <>
          <h3 className="skills-pane__group">Skill folders</h3>
          <ul className="skills-pane__folders">
            {catalog.implicitRoots.map((path) => (
              <li key={path}>
                <code>{path}</code>
                <span>Included automatically</span>
              </li>
            ))}
            {catalog.roots.map((path) => (
              <li key={path}>
                <code>{path}</code>
                  disabled={busy || remote}
                  Remove
                </button>
              </li>
            ))}
          </ul>
          {remote ? (
            <p className="settings-panel__section-desc">
              Skill folders are chosen on the server. Ask the server administrator to add one.
            </p>
          ) : (
            <button
              type="button"
              className="setup-wizard__action"
              onClick={() => void addFolder()}
              disabled={busy}
            >
              Add skill folder
            </button>
          )}
          <SkillGroup
            title="Language guidelines"
            entries={guidelines}
            busy={busy}
            onToggle={toggle}
          />
          <SkillGroup title="Built-in skills" entries={builtin} busy={busy} onToggle={toggle} />
          <SkillGroup
            title="Your skills"
            entries={external}
            busy={busy}
            onToggle={toggle}
            empty="Add a folder to see skills such as systematic debugging or React best practices."
          />
        </>
      )}
    </section>
  );
}

function SkillGroup({
  title,
  entries,
  busy,
  empty,
  onToggle,
}: {
  title: string;
  entries: SkillCatalogEntry[];
  busy: boolean;
  empty?: string;
  onToggle(entry: SkillCatalogEntry): void;
}) {
  return (
    <>
      <h3 className="skills-pane__group">{title}</h3>
      {entries.length === 0 ? (
        <p className="settings-panel__section-desc">{empty ?? 'None shipped with this version.'}</p>
      ) : (
        <ul className="skills-pane__list">
          {entries.map((entry) => (
            <li key={entry.id}>
              <label className="settings-panel__toggle">
                <input
                  type="checkbox"
                  checked={entry.enabled}
                  disabled={!entry.toggleable || busy}
                  onChange={() => onToggle(entry)}
                />
                <span>
                  <strong>{entry.name}</strong>
                  <span>
                    {entry.description}
                    {entry.toggleable ? '' : ' Required by a phase.'}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
