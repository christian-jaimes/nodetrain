import type { BoardDocument } from './graph/document';
import type { ImageAsset } from './graph/types';

/** Shapes exchanged between the app and the local server. */

export type BoardSummary = {
  id: string;
  name: string;
  revision: number;
  nodeCount: number;
  updatedAt: number;
};

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
  request?: { prompt: string; referenceIds: string[]; model: string; aspectRatio: string; quality: string; provider: string };
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
  spend: { board: number; today: number };
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
