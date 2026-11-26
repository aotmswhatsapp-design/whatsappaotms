/**
 * What the agents API answers with, mirroring `AgentView`, `SourceView`,
 * `RunView`, `AgentDetail` and `AskResult` on the server. Dates are ISO
 * strings; nothing here parses them.
 *
 * Kept apart from `api.ts` so a component can import a type without pulling the
 * Supabase session code into its module graph.
 */

/** The two models the server accepts. An unknown one is a 400, by design. */
export type AgentModel = "gpt-5.4-mini" | "gpt-4.1-mini";

export const AGENT_MODELS: { value: AgentModel; label: string; blurb: string }[] = [
  {
    value: "gpt-5.4-mini",
    label: "GPT-5.4 mini",
    blurb: "Reads images and answers in the shortest time. The default.",
  },
  {
    value: "gpt-4.1-mini",
    label: "GPT-4.1 mini",
    blurb: "Older, slightly cheaper, and fine for text-only material.",
  },
];

export type SourceKind = "TEXT" | "FILE";

export type SourceStatus = "PENDING" | "PROCESSING" | "READY" | "FAILED";

export type RunKind = "REPLY" | "PLAYGROUND";

export type RunStatus = "QUEUED" | "CLAIMED" | "SENT" | "SKIPPED" | "FAILED";

export interface Agent {
  id: string;
  name: string;
  description: string | null;
  systemPrompt: string;
  model: string;
  temperature: number;
  maxReplyChars: number;
  escalateKeywords: string[];
  isActive: boolean;
  sourceCount: number;
  readySourceCount: number;
  createdAt: string;
}

/** The number this workspace's agents answer on; null before one is connected. */
export interface Channel {
  display: string | null;
  phoneNumberId: string;
}

/**
 * What the extractor found about a source's shape, beside the row's counters.
 * A CSV is a `table` like a workbook; the MIME decides how it is described.
 */
export type SourceMeta =
  | {
      kind: "table";
      sheets: { name: string; headers: string[]; rowCount: number }[];
    }
  | { kind: "document"; pages: number | null }
  | { kind: "image"; mime: string; width: number | null; height: number | null };

export interface Source {
  id: string;
  kind: SourceKind;
  title: string;
  mime: string | null;
  size: number | null;
  status: SourceStatus;
  error: string | null;
  charCount: number;
  chunkCount: number;
  embedTokens: number;
  /** Tokens spent reading an image or a voice note; 0 for documents. */
  extractTokens: number;
  indexedAt: string | null;
  createdAt: string;
  /** Page count, sheet inventory or pixel size; null when the reader had none. */
  meta: SourceMeta | null;
  /** Set on the new row a replacement creates, naming the source it supersedes. */
  replacesSourceId: string | null;
}

export interface Run {
  id: string;
  kind: RunKind;
  status: RunStatus;
  /** `paused`, `superseded`, `window-closed`, `no-context`, `handoff`, … */
  reason: string | null;
  conversationId: string | null;
  tokensIn: number;
  tokensOut: number;
  embeddingTokens: number;
  latencyMs: number | null;
  error: string | null;
  createdAt: string;
}

export interface Usage {
  runs: number;
  tokensIn: number;
  tokensOut: number;
  embeddingTokens: number;
}

export interface AgentDetail {
  agent: Agent;
  sources: Source[];
  usage: Usage;
  runs: Run[];
}

/**
 * One retrieved slice, with the place in the file it came from. A PDF carries a
 * page; a worksheet carries its name and the rows it spans; a CSV carries
 * record numbers under the sheet name `CSV`.
 */
export interface Citation {
  sourceId: string;
  title: string;
  score: number;
  text: string;
  page: number | null;
  sheet: string | null;
  rowFrom: number | null;
  rowTo: number | null;
}

export interface AskResult {
  answer: string;
  citations: Citation[];
  tokens: { input: number; output: number; embedding: number };
  /** `no-context` when nothing cleared the floor; null for a normal answer. */
  reason: string | null;
}

export interface CreateAgentInput {
  name: string;
  description?: string;
  systemPrompt?: string;
  model?: AgentModel;
  temperature?: number;
  maxReplyChars?: number;
  escalateKeywords?: string[];
}

export interface UpdateAgentInput {
  name?: string;
  description?: string;
  systemPrompt?: string;
  model?: AgentModel;
  temperature?: number;
  maxReplyChars?: number;
  escalateKeywords?: string[];
}

export interface RunFilters {
  kind?: RunKind;
  status?: RunStatus;
  limit?: number;
  cursor?: string;
}
