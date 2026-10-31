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

  const save = useCallback(async (policy: SkillPolicy, optimistic: SkillCatalog) => {
    setBusy(true);
    setError(null);
    try {
      setCatalog(await window.agentico.updateSkillPolicy(policy));
    } catch (err) {
      const parsed = parseIpcError(err);
      if (parsed.code === 'E_SKILL_CATALOG_REFRESH') {
        setCatalog(optimistic);
        return;
      }
      setError(parsed.summary);
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
    void save(policyFor(next), next);
  };

  const addFolder = async () => {
    setError(null);
    try {
      const picked = await window.agentico.pickWorkspaceDirectory();
      if (picked.path === null) return;
      if (catalog.roots.includes(picked.path) || catalog.implicitRoots.includes(picked.path)) {
        return;
      }
      const next = { ...catalog, roots: [...catalog.roots, picked.path] };
      await save(policyFor(next), next);
    } catch (err) {
      setError(parseIpcError(err).summary);
    }
  };

  const removeFolder = (path: string) => {
    const next = { ...catalog, roots: catalog.roots.filter((root) => root !== path) };
    void save(policyFor(next), next);
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
                {remote ? null : (
                  <button type="button" onClick={() => removeFolder(path)} disabled={busy}>
                    Remove
                  </button>
                )}
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
