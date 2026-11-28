/**
 * What the agents API answers with, mirroring `AgentView`, `SourceView`,
 * `RunView`, `AgentDetail` and `AskResult` on the server. Dates are ISO
 * strings; nothing here parses them.
 *
 * Kept apart from `api.ts` so a component can import a type without pulling the
 * Supabase session code into its module graph.
 */

export type SourceKind = "TEXT" | "FILE";

export type SourceStatus = "PENDING" | "PROCESSING" | "READY" | "FAILED";

export type RunKind = "REPLY" | "PLAYGROUND";

export type RunStatus = "QUEUED" | "CLAIMED" | "SENT" | "SKIPPED" | "FAILED";

export interface Agent {
  id: string;
  name: string;
  description: string | null;
  systemPrompt: string;
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
  | { kind: "document"; pages: number | null; ocr?: number }
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
  latencyMs: number | null;
  error: string | null;
  createdAt: string;
}

export interface Usage {
  runs: number;
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
  /** `no-context` when nothing cleared the floor; null for a normal answer. */
  reason: string | null;
}

export interface CreateAgentInput {
  name: string;
  description?: string;
  systemPrompt?: string;
  maxReplyChars?: number;
  escalateKeywords?: string[];
}

export interface UpdateAgentInput {
  name?: string;
  description?: string;
  systemPrompt?: string;
  maxReplyChars?: number;
  escalateKeywords?: string[];
}

export interface RunFilters {
  kind?: RunKind;
  status?: RunStatus;
  limit?: number;
  cursor?: string;
}
