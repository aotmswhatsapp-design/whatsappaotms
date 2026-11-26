import { request, upload } from "@/lib/api/http";

import type {
  Agent,
  AgentDetail,
  AskResult,
  Channel,
  CreateAgentInput,
  Run,
  RunFilters,
  Source,
  UpdateAgentInput,
  Usage,
} from "./types";

export { ApiError } from "@/lib/api/http";

/**
 * The agents API. Nothing here sends a WhatsApp message: replies are produced
 * by the server's own runner, and `askAgent` is the playground.
 */
export function fetchAgents(): Promise<{ agents: Agent[]; channel: Channel | null }> {
  return request<{ agents: Agent[]; channel: Channel | null }>("/v1/agents", {
    method: "GET",
  });
}

export function fetchAgent(id: string): Promise<AgentDetail> {
  return request<AgentDetail>(`/v1/agents/${id}`, { method: "GET" });
}

export function createAgent(input: CreateAgentInput): Promise<{ agent: Agent }> {
  return request<{ agent: Agent }>("/v1/agents", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateAgent(
  id: string,
  input: UpdateAgentInput,
): Promise<{ agent: Agent }> {
  return request<{ agent: Agent }>(`/v1/agents/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function deleteAgent(id: string): Promise<{ deleted: true }> {
  return request<{ deleted: true }>(`/v1/agents/${id}`, { method: "DELETE" });
}

/**
 * The one active agent for this number. 409 `AGENT_UNTRAINED` while no source
 * is READY — the screen disables the switch from `readySourceCount`, and this
 * is still the authority.
 */
export function activateAgent(id: string): Promise<{ agent: Agent }> {
  return request<{ agent: Agent }>(`/v1/agents/${id}/activate`, { method: "POST" });
}

/** The switch's off position. Answers 200 with the agent, now inactive. */
export function deactivateAgent(id: string): Promise<{ agent: Agent }> {
  return request<{ agent: Agent }>(`/v1/agents/${id}/deactivate`, {
    method: "POST",
  });
}

/** The playground. Answers from the local index, and sends nothing. */
export function askAgent(id: string, question: string): Promise<AskResult> {
  return request<AskResult>(`/v1/agents/${id}/ask`, {
    method: "POST",
    body: JSON.stringify({ question }),
  });
}

export function fetchRuns(
  id: string,
  filters: RunFilters = {},
): Promise<{ runs: Run[]; nextCursor: string | null; usage: Usage }> {
  const query = new URLSearchParams();

  if (filters.kind) query.set("kind", filters.kind);
  if (filters.status) query.set("status", filters.status);
  if (filters.limit) query.set("limit", String(filters.limit));
  if (filters.cursor) query.set("cursor", filters.cursor);

  const suffix = query.size > 0 ? `?${query.toString()}` : "";

  return request<{ runs: Run[]; nextCursor: string | null; usage: Usage }>(
    `/v1/agents/${id}/runs${suffix}`,
    { method: "GET" },
  );
}

export function fetchSources(id: string): Promise<{ sources: Source[] }> {
  return request<{ sources: Source[] }>(`/v1/agents/${id}/sources`, {
    method: "GET",
  });
}

export function addTextSource(
  id: string,
  input: { title: string; body: string },
): Promise<{ source: Source }> {
  return request<{ source: Source }>(`/v1/agents/${id}/sources/text`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function uploadSource(id: string, file: File): Promise<{ source: Source }> {
  const form = new FormData();
  form.append("file", file);

  return upload<{ source: Source }>(`/v1/agents/${id}/sources/file`, form);
}

/**
 * The new version of a file. The row that comes back is the *new* source, and
 * the old one keeps answering until this one is READY — the server retires it
 * then, so the list must show both until that happens.
 */
export function replaceSource(
  id: string,
  sourceId: string,
  file: File,
): Promise<{ source: Source }> {
  const form = new FormData();
  form.append("file", file);

  return upload<{ source: Source }>(
    `/v1/agents/${id}/sources/${sourceId}/file`,
    form,
    "PUT",
  );
}

export function deleteSource(
  id: string,
  sourceId: string,
): Promise<{ deleted: true }> {
  return request<{ deleted: true }>(
    `/v1/agents/${id}/sources/${sourceId}`,
    { method: "DELETE" },
  );
}

export function retrySource(
  id: string,
  sourceId: string,
): Promise<{ source: Source }> {
  return request<{ source: Source }>(
    `/v1/agents/${id}/sources/${sourceId}/retry`,
    { method: "POST" },
  );
}

/**
 * A short-lived link to the stored original — the API answers with a URL, not
 * with bytes. That URL is signed, so it is opened directly and never sent our
 * Bearer token: it is not this API, and the token is not its credential.
 */
export function sourceDownloadUrl(
  id: string,
  sourceId: string,
): Promise<{ url: string; expiresIn: number }> {
  return request<{ url: string; expiresIn: number }>(
    `/v1/agents/${id}/sources/${sourceId}/download`,
    { method: "GET" },
  );
}
