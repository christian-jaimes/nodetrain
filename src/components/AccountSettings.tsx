import { Bot, CircleCheck, CircleUserRound, ExternalLink, KeyRound, LoaderCircle, Settings, TriangleAlert, Upload, UserRound, X } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { KEY_PROVIDERS, type KeyProviderId, type ProviderStatus } from '../../shared/api';
import { api, errorText } from '../lib/api';
import { pictureFromFile } from '../lib/images';
import { useBoard } from '../store/board';

export function Avatar({ size = 34 }: { size?: number }) {
  const picture = useBoard((s) => s.profile.picture);
  return (
    <span className="avatar" style={{ width: size, height: size }} aria-hidden>
      {picture ? <img src={picture} alt="" /> : <CircleUserRound size={Math.round(size * 0.6)} />}
    </span>
  );
}

/** Bottom of the left sidebar: your name and picture, opening Account settings. */
export function AccountButton() {
  const name = useBoard((s) => s.profile.name);
  const setSettingsOpen = useBoard((s) => s.setSettingsOpen);
  return (
    <button className="account-btn" onClick={() => setSettingsOpen(true)} aria-label={`Account settings${name ? ` for ${name}` : ''}`}>
      <Avatar />
      <span className="account-btn__text">
        <strong>{name || 'Account settings'}</strong>
        {name ? <small>Account settings</small> : null}
      </span>
      <Settings size={16} aria-hidden />
    </button>
  );
}

type Section = 'account' | 'keys';
const SECTIONS: { id: Section; label: string; icon: typeof UserRound }[] = [
  { id: 'account', label: 'Account', icon: UserRound },
  { id: 'keys', label: 'API keys', icon: KeyRound },
];

export function AccountSettings() {
  const setSettingsOpen = useBoard((s) => s.setSettingsOpen);
  const [section, setSection] = useState<Section>('account');
  // Captured during the first render, before autoFocus moves focus into the dialog.
  const [opener] = useState(() => document.activeElement);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setSettingsOpen(false);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      // Return focus to whatever opened the dialog.
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, [setSettingsOpen, opener]);

  return (
    <div className="modal-backdrop" onClick={() => setSettingsOpen(false)}>
      <div className="modal modal--settings" role="dialog" aria-modal="true" aria-labelledby="acct-title" onClick={(e) => e.stopPropagation()}>
        <nav className="settings-nav" aria-label="Settings sections">
          <h2 id="acct-title">Settings</h2>
          {SECTIONS.map(({ id, label, icon: Icon }) => (
            <button key={id} className={`settings-nav__item ${section === id ? 'is-active' : ''}`} onClick={() => setSection(id)} aria-current={section === id ? 'page' : undefined}>
              <Icon size={17} /> {label}
            </button>
          ))}
        </nav>
        <div className="settings-main">
          <button className="icon-btn settings-close" onClick={() => setSettingsOpen(false)} aria-label="Close">
            <X size={20} />
          </button>
          {section === 'account' ? <AccountSection /> : <KeysSection />}
        </div>
      </div>
    </div>
  );
}

function AccountSection() {
  const profile = useBoard((s) => s.profile);
  const setProfile = useBoard((s) => s.setProfile);
  const notify = useBoard((s) => s.notify);
  const [name, setName] = useState(profile.name);
  const [picture, setPicture] = useState(profile.picture);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dirty = name.trim() !== profile.name || picture !== profile.picture;

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      setPicture(await pictureFromFile(file));
    } catch (err) {
      setError(errorText(err));
    }
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const saved = await api.saveProfile({ name, picture });
      setProfile(saved);
      setName(saved.name);
      notify('Account saved.');
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="settings-pane" onSubmit={(e) => void save(e)}>
      <h3>Account</h3>
      <p className="muted small">NodeTrain runs on this computer, so this profile is stored here too. Sign-in and team accounts come later, with hosting.</p>

      <div className="field">
        <span className="field-label">Picture</span>
        <div className="picture-row">
          <span className="avatar avatar--lg">{picture ? <img src={picture} alt="Your picture" /> : <CircleUserRound size={44} aria-hidden />}</span>
          <div className="picture-row__actions">
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => void pick(e.target.files?.[0]).then(() => (e.target.value = ''))} />
            <button type="button" className="secondary-btn secondary-btn--sm" onClick={() => fileRef.current?.click()}>
              <Upload size={14} /> {picture ? 'Change picture' : 'Upload picture'}
            </button>
            {picture ? (
              <button type="button" className="secondary-btn secondary-btn--sm" onClick={() => setPicture(null)}>
                Remove
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="field">
        <label className="field-label" htmlFor="acct-name">
          Name
        </label>
        <input id="acct-name" className="nt-input" value={name} maxLength={60} placeholder="Your name" autoComplete="name" onChange={(e) => setName(e.target.value)} />
      </div>

      {error ? (
        <p className="settings-error" role="alert">
          {error}
        </p>
      ) : null}
      <div>
        <button className="primary-btn" type="submit" disabled={!dirty || busy}>
          {busy ? <LoaderCircle size={15} className="spin" /> : null} Save changes
        </button>
      </div>
    </form>
  );
}

function KeysSection() {
  const setProvider = useBoard((s) => s.setProvider);
  const [status, setStatus] = useState<ProviderStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    api.settings().then(setStatus, (e) => setLoadError(errorText(e)));
  }, []);

  const apply = (s: ProviderStatus) => {
    setStatus(s);
    setProvider(s.provider);
  };

  return (
    <div className="settings-pane">
      <h3>API keys</h3>
      <p className="muted small">
        Connect the AI providers you want to run workflows with. Keys are checked with the provider, then stored only on this computer and never sent back to the browser.
      </p>
      {loadError ? (
        <p className="settings-status settings-status--warn" role="alert">
          <TriangleAlert size={16} /> {loadError}
        </p>
      ) : !status ? (
        <p className="muted small">Loading…</p>
      ) : (
        <ul className="key-list">
          {KEY_PROVIDERS.map((p) => (
            <KeyRow key={p.id} provider={p} status={status} onStatus={apply} />
          ))}
        </ul>
      )}
    </div>
  );
}

function KeyRow({ provider, status, onStatus }: { provider: (typeof KEY_PROVIDERS)[number]; status: ProviderStatus; onStatus: (s: ProviderStatus) => void }) {
  const notify = useBoard((s) => s.notify);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState<'save' | 'remove' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const id: KeyProviderId = provider.id;
  const connected = Boolean(status.key) && !status.forcedSimulated;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy('save');
    setError(null);
    try {
      onStatus(await api.saveKey(id, key));
      setKey('');
      notify(`${provider.label} key saved. Runs now use ${provider.label}.`);
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
      const s = await api.removeKey(id);
      onStatus(s);
      notify(s.provider.id === id ? 'Removed. Runs now use the key from your .env file.' : 'API key removed. Runs are simulated until you add one.');
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <li className="key-row">
      <div className="key-row__head">
        <span className="key-row__icon" aria-hidden>
          <Bot size={20} />
        </span>
        <div className="key-row__title">
          <strong>{provider.label}</strong>
          <span className="muted small">{provider.purpose}</span>
        </div>
        <span className={`key-chip ${connected ? 'is-on' : ''}`}>{connected ? 'Key set' : 'No key'}</span>
      </div>

      <KeyStatus status={status} />

      <form className="settings-form" onSubmit={(e) => void save(e)}>
        <label className="field-label" htmlFor={`key-${id}`}>
          {status.key?.source === 'app' ? 'Replace the key' : 'Paste your key'}
        </label>
        <div className="settings-form__row">
          <input
            id={`key-${id}`}
            className="nt-input"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder={provider.placeholder}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            aria-describedby={`key-${id}-help`}
            aria-invalid={Boolean(error)}
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
        <p id={`key-${id}-help`} className="muted small">
          Stored only on this computer, in <code>data/secrets.json</code>. Get a key at{' '}
          <a href={provider.helpUrl} target="_blank" rel="noreferrer">
            {new URL(provider.helpUrl).host} <ExternalLink size={12} aria-hidden />
          </a>
          . Every run is billed to that {provider.label} account.
        </p>
      </form>

      {status.key?.source === 'app' ? (
        <button className="secondary-btn secondary-btn--danger" onClick={() => void remove()} disabled={busy !== null}>
          {busy === 'remove' ? 'Removing…' : 'Remove saved key'}
        </button>
      ) : null}
    </li>
  );
}

function KeyStatus({ status }: { status: ProviderStatus }) {
  if (status.forcedSimulated) {
    return (
      <p className="settings-status settings-status--warn">
        <TriangleAlert size={16} />
        <span>
          <code>NODETRAIN_PROVIDER=simulated</code> is set in .env, so runs stay simulated whatever key you add. Remove that line and restart to use real models.
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
