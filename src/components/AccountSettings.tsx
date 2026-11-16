import { CircleCheck, CircleUserRound, ExternalLink, KeyRound, LoaderCircle, Settings, TriangleAlert, X } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import type { ProviderStatus } from '../../shared/api';
import { api, errorText } from '../lib/api';
import { useBoard } from '../store/board';

/** Bottom of the left sidebar: opens Account settings and shows the provider at a glance. */
export function AccountButton({ compact = false }: { compact?: boolean }) {
  const provider = useBoard((s) => s.provider);
  const setSettingsOpen = useBoard((s) => s.setSettingsOpen);
  const live = provider?.id === 'openai';
  const status = live ? 'OpenAI connected' : 'Simulated, no key';
  if (compact) {
    return (
      <button className="icon-btn account-btn--compact" onClick={() => setSettingsOpen(true)} aria-label={`Account settings. ${status}`} title="Account settings">
        <Settings size={18} />
      </button>
    );
  }
  return (
    <button className="account-btn" onClick={() => setSettingsOpen(true)} aria-label={`Account settings. ${status}`}>
      <span className="account-btn__avatar" aria-hidden>
        <CircleUserRound size={20} />
      </span>
      <span className="account-btn__text">
        <strong>Account settings</strong>
        <small className={live ? 'is-ok' : 'is-warn'}>
          <i aria-hidden /> {status}
        </small>
      </span>
      <Settings size={16} aria-hidden />
    </button>
  );
}

export function AccountSettings() {
  const setSettingsOpen = useBoard((s) => s.setSettingsOpen);
  const setProvider = useBoard((s) => s.setProvider);
  const notify = useBoard((s) => s.notify);
  const [status, setStatus] = useState<ProviderStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState<'save' | 'remove' | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Captured during the first render, before autoFocus moves focus into the dialog.
  const [opener] = useState(() => document.activeElement);

  useEffect(() => {
    api.settings().then(setStatus, (e) => setLoadError(errorText(e)));
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setSettingsOpen(false);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      // Return focus to whatever opened the dialog.
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, [setSettingsOpen, opener]);

  const apply = (s: ProviderStatus) => {
    setStatus(s);
    setProvider(s.provider);
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy('save');
    setError(null);
    try {
      apply(await api.saveOpenAIKey(key));
      setKey('');
      notify('API key saved. Runs now use OpenAI.');
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setBusy('remove');
    setError(null);
    try {
      const s = await api.removeOpenAIKey();
      apply(s);
      notify(s.provider.id === 'openai' ? 'Removed. Runs now use the key from your .env file.' : 'API key removed. Runs are simulated until you add one.');
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="modal-backdrop" onClick={() => setSettingsOpen(false)}>
      <div className="modal modal--narrow" role="dialog" aria-modal="true" aria-labelledby="acct-title" onClick={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <span className="start-card__icon">
            <CircleUserRound size={26} />
          </span>
          <div>
            <h2 id="acct-title">Account settings</h2>
            <p>NodeTrain runs on this computer. Sign-in and team accounts come later, with hosting.</p>
          </div>
          <button className="icon-btn" onClick={() => setSettingsOpen(false)} aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <section className="settings-section" aria-labelledby="key-title">
          <h3 id="key-title">
            <KeyRound size={17} /> OpenAI API key
          </h3>
          {loadError ? (
            <p className="settings-status settings-status--warn" role="alert">
              <TriangleAlert size={16} /> {loadError}
            </p>
          ) : !status ? (
            <p className="muted small">Loading…</p>
          ) : (
            <KeyStatus status={status} />
          )}

          <form className="settings-form" onSubmit={(e) => void save(e)}>
            <label className="field-label" htmlFor="acct-key">
              {status?.key?.source === 'app' ? 'Replace the key' : 'Paste your key'}
            </label>
            <div className="settings-form__row">
              <input
                id="acct-key"
                className="nt-input"
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder="sk-..."
                value={key}
                onChange={(e) => setKey(e.target.value)}
                aria-describedby="acct-key-help"
                aria-invalid={Boolean(error)}
                autoFocus
              />
              <button className="primary-btn" type="submit" disabled={!key.trim() || busy !== null}>
                {busy === 'save' ? <LoaderCircle size={15} className="spin" /> : null}
                {busy === 'save' ? 'Checking…' : 'Save key'}
              </button>
            </div>
            {error ? (
              <p className="settings-error" role="alert">
                {error}
              </p>
            ) : null}
            <p id="acct-key-help" className="muted small">
              The key is checked with OpenAI, then stored only on this computer, in <code>data/secrets.json</code>. It is never shown again or sent back to the browser.
              Get a key at{' '}
              <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">
                platform.openai.com/api-keys <ExternalLink size={12} aria-hidden />
              </a>
              . Every run is billed to that OpenAI account.
            </p>
          </form>

          {status?.key?.source === 'app' ? (
            <button className="secondary-btn secondary-btn--danger" onClick={() => void remove()} disabled={busy !== null}>
              {busy === 'remove' ? 'Removing…' : 'Remove saved key'}
            </button>
          ) : null}
        </section>
      </div>
    </div>
  );
}

function KeyStatus({ status }: { status: ProviderStatus }) {
  if (status.forcedSimulated) {
    return (
      <p className="settings-status settings-status--warn">
        <TriangleAlert size={16} />
        <span>
          <code>NODETRAIN_PROVIDER=simulated</code> is set in .env, so runs stay simulated whatever key you add. Remove that line and restart to use OpenAI.
        </span>
      </p>
    );
  }
  if (!status.key) {
    return (
      <p className="settings-status settings-status--warn">
        <TriangleAlert size={16} />
        <span>No key yet, so runs are simulated and nothing is charged.</span>
      </p>
    );
  }
  return (
    <p className="settings-status settings-status--ok">
      <CircleCheck size={16} />
      <span>
        Connected with key <code>{status.key.hint}</code>
        {status.key.source === 'app' ? ', saved here.' : ', from your .env file.'}
        {status.key.source === 'app' && status.envKeyPresent ? ' It takes priority over the key in .env.' : ''}
      </span>
    </p>
  );
}
