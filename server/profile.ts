import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Profile } from '../shared/api';
import { ProviderError } from './providers/types';

const MAX_PICTURE_CHARS = 400_000;
const PICTURE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

/** The local user's display name and picture, kept in data/profile.json. */
export class ProfileStore {
  private file: string;
  constructor(dataDir: string) {
    this.file = join(dataDir, 'profile.json');
  }

  get(): Profile {
    if (!existsSync(this.file)) return { name: '', picture: null };
    try {
      const p = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<Profile>;
      return { name: typeof p.name === 'string' ? p.name : '', picture: typeof p.picture === 'string' ? p.picture : null };
    } catch {
      return { name: '', picture: null };
    }
  }

  set(raw: unknown): Profile {
    const b = (raw ?? {}) as { name?: unknown; picture?: unknown };
    const name = typeof b.name === 'string' ? b.name.trim().slice(0, 60) : '';
    const picture = b.picture ?? null;
    if (picture !== null && (typeof picture !== 'string' || picture.length > MAX_PICTURE_CHARS || !PICTURE.test(picture))) {
      throw new ProviderError('The picture must be a PNG, JPEG or WebP image.', 'invalid_input');
    }
    const profile: Profile = { name, picture };
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(profile));
    renameSync(tmp, this.file);
    return profile;
  }
}
