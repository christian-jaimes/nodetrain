import type { BoardPayload, BoardRunState, BoardSummary, KeyProviderId, Profile, ProviderStatus, RunView, SaveBoardRequest, UserTemplate } from '../../shared/api';
import type { BoardDocument } from '../../shared/graph/document';
import type { ImageAsset } from '../../shared/graph/types';

/** Thin client for the local NodeTrain server (server/app.ts). */

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Raised when the local server can't be reached at all. */
export class OfflineError extends ApiError {
  constructor() {
    super("Can't reach the NodeTrain server. Check the terminal running `npm run dev` for an error.", 0, 'offline');
  }
}

async function request<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  let res: Response;
  try {
    const isJson = body !== undefined && !(body instanceof Blob);
    res = await fetch(path, {
      method,
      headers: isJson ? { 'content-type': 'application/json', ...headers } : headers,
      body: body === undefined ? undefined : isJson ? JSON.stringify(body) : (body as Blob),
    });
  } catch {
    throw new OfflineError();
  }
  // Vite answers 502/504 when the proxied server is down.
  if (res.status === 502 || res.status === 504) throw new OfflineError();
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((data as { error?: string }).error ?? `Request failed (${res.status}).`, res.status, (data as { code?: string }).code);
  return data as T;
}

export const api = {
  health: () => request<{ ok: true; provider: { id: string; label: string } }>('GET', '/api/health'),
  listBoards: () => request<BoardSummary[]>('GET', '/api/boards'),
  createBoard: (name: string, document?: BoardDocument) => request<BoardPayload>('POST', '/api/boards', { name, document }),
  getBoard: (id: string) => request<BoardPayload>('GET', `/api/boards/${id}`),
  saveBoard: (id: string, body: SaveBoardRequest) => request<BoardPayload>('PUT', `/api/boards/${id}`, body),
  setFavorite: (id: string, favorite: boolean) => request<BoardPayload>('PATCH', `/api/boards/${id}`, { favorite }),
  duplicateBoard: (id: string) => request<BoardPayload>('POST', `/api/boards/${id}/duplicate`),
  deleteBoard: (id: string) => request<void>('DELETE', `/api/boards/${id}`),
  listTemplates: () => request<UserTemplate[]>('GET', '/api/templates'),
  saveTemplate: (name: string, document: BoardDocument) => request<UserTemplate>('POST', '/api/templates', { name, document }),
  deleteTemplate: (id: string) => request<void>('DELETE', `/api/templates/${id}`),
  boardState: (id: string) => request<BoardRunState>('GET', `/api/boards/${id}/state`),
  startRun: (boardId: string, revision: number, targetNodeId?: string, upstream = true) => request<RunView>('POST', `/api/boards/${boardId}/runs`, { revision, targetNodeId, upstream }),
  getRun: (id: string) => request<RunView>('GET', `/api/runs/${id}`),
  cancelRun: (id: string) => request<RunView>('POST', `/api/runs/${id}/cancel`),
  settings: () => request<ProviderStatus>('GET', '/api/settings'),
  // The header marks the request as coming from this app (see server/app.ts).
  saveKey: (provider: KeyProviderId, apiKey: string) => request<ProviderStatus>('PUT', `/api/settings/keys/${provider}`, { apiKey }, { 'x-nodetrain-client': '1' }),
  removeKey: (provider: KeyProviderId) => request<ProviderStatus>('DELETE', `/api/settings/keys/${provider}`, undefined, { 'x-nodetrain-client': '1' }),
  profile: () => request<Profile>('GET', '/api/profile'),
  saveProfile: (p: Profile) => request<Profile>('PUT', '/api/profile', p, { 'x-nodetrain-client': '1' }),
  upload: (file: Blob, name: string) => request<ImageAsset>('POST', '/api/artifacts', file, { 'x-file-name': encodeURIComponent(name) }),
};

export const errorText = (err: unknown) => (err instanceof Error ? err.message : 'Something went wrong.');
