import type { BoardDocument } from './graph/document';
import type { ImageAsset } from './graph/types';

/** Shapes exchanged between the app and the local server. */

/** A tiny picture of a workflow's layout for gallery cards: node positions and links, no data. */
export type BoardPreview = {
  nodes: { id: string; x: number; y: number; type: string }[];
  edges: { source: string; target: string }[];
};

export type BoardSummary = {
  id: string;
  name: string;
  revision: number;
  nodeCount: number;
  favorite: boolean;
  createdAt: number;
  updatedAt: number;
  preview: BoardPreview;
};

/** A workflow the user saved to reuse as a starting point. */
export type UserTemplate = {
  id: string;
  name: string;
  createdAt: number;
  nodeKinds: string[];
  document: BoardDocument;
};

/** Local profile, shown in the sidebar. Stored on this computer only. */
export type Profile = {
  name: string;
  /** Small image as a data: URL, or null. */
  picture: string | null;
};

/** AI providers that can hold an API key. Add an entry here (and a server provider) to support another. */
export const KEY_PROVIDERS = [
  {
    id: 'openai',
    label: 'OpenAI',
    purpose: 'Image generation',
    placeholder: 'sk-...',
    helpUrl: 'https://platform.openai.com/api-keys',
  },
] as const;
export type KeyProviderId = (typeof KEY_PROVIDERS)[number]['id'];

export type BoardPayload = {
  id: string;
  name: string;
  revision: number;
  document: BoardDocument;
  updatedAt: number;
};

export type SaveBoardRequest = {
  name: string;
  /** Revision the client edited from. A mismatch returns 409. */
  baseRevision: number;
  document: BoardDocument;
};

/** Generations run and what they cost, split into text (prompt) and image (references and output) spend. */
export type SpendStats = { generations: number; textUsd: number; imageUsd: number };
export const EMPTY_SPEND: BoardRunState['spend'] = { board: 0, today: 0, all: { generations: 0, textUsd: 0, imageUsd: 0 }, byNode: {} };

export type RunStatusApi = 'queued' | 'running' | 'succeeded' | 'partial' | 'failed' | 'canceled';
export type NodeExecStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';

export type NodeExecutionView = {
  id: string;
  runId: string;
  nodeId: string;
  nodeTitle: string;
  status: NodeExecStatus;
  error?: string;
  errorCategory?: string;
  /** Inputs and settings actually sent, for provenance. */
  request?: { prompt: string; referenceIds: string[]; model: string; aspectRatio: string; quality: string; provider: string; /** Image Transformation runs: the operation and its settings. For them `model` holds a short description. */ operation?: string; options?: Record<string, number | string> };
  outputs: ImageAsset[];
  runKey?: string;
  /** Token usage as reported by the provider, when it reports it. */
  usage?: Record<string, number>;
  /** Estimated USD from usage and the model's published token prices. */
  costUsd?: number;
  startedAt?: number;
  endedAt?: number;
};

export type RunView = {
  id: string;
  boardId: string;
  revision: number;
  targetNodeId: string | null;
  status: RunStatusApi;
  createdAt: number;
  endedAt?: number;
  nodes: NodeExecutionView[];
};

/** Everything the app needs to show run results for a board after a reload. */
export type BoardRunState = {
  /** Successful outputs per node, newest first. */
  outputs: Record<string, ImageAsset[]>;
  /** The latest execution per node, whatever its outcome. */
  latest: Record<string, NodeExecutionView>;
  /** The latest successful execution per node: its runKey tells whether outputs are out of date. */
  lastSucceeded: Record<string, { runKey?: string; endedAt?: number }>;
  activeRunId: string | null;
  activity: NodeExecutionView[];
  /** Estimated USD: everything run on this board, and all boards since local midnight. */
  spend: { board: number; today: number; /** Counts and cost split for the whole board and for each node. */ all: SpendStats; byNode: Record<string, SpendStats> };
};

export type ApiError = { error: string; code?: string };

/** Which provider runs use and where its key comes from. Never includes the key itself. */
export type ProviderStatus = {
  provider: { id: string; label: string };
  /** The key in use: saved from the app, or OPENAI_API_KEY from .env. Only a short hint is shared. */
  key: { source: 'app' | 'env'; hint: string } | null;
  envKeyPresent: boolean;
  /** NODETRAIN_PROVIDER=simulated is set, so no model is called whatever the key. */
  forcedSimulated: boolean;
};
