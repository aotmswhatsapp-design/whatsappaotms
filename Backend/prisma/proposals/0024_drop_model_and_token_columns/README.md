# Proposal 0024 — drop the model, prompt and token columns

**Status: NOT APPLIED.** This directory sits outside `prisma/migrations/`, so
`prisma migrate deploy` cannot see it. `schema.prisma` is deliberately unchanged:
it still matches the database, and a schema that ran ahead of its migrations is
the drift this proposal is trying to avoid.

## Why

Answering a customer is local. The reply is retrieved text, quoted and shaped by
`cleanReply` and `truncateAtSentence`; routing between agents is a term-overlap
score; search is Postgres full text plus `pg_trgm`. No code path calls a model,
embeds a question, or reads a picture, so the columns that recorded those calls
record nothing. They are dead weight in every `SELECT *`, and their presence
suggests a setting that no longer exists.

## Prisma model diff (what `schema.prisma` becomes)

```prisma
model Agent {
  name             String
  description      String?
- systemPrompt     String   @map("system_prompt")
- model            String   @default("gpt-5.4-mini")
- temperature      Float    @default(0.4)
  maxReplyChars    Int      @default(900) @map("max_reply_chars")
  escalateKeywords String[] @default([]) @map("escalate_keywords")
}

model KnowledgeSource {
  chunkCount   Int @default(0) @map("chunk_count")
- embedTokens  Int @default(0) @map("embed_tokens")
- extractTokens Int @default(0) @map("extract_tokens")
}

model KnowledgeChunk {
  heading   String?
- /// Nearest preceding heading …
- embedding Unsupported("vector(1536)")?
}

model AgentRun {
  reason String?
- tokensIn        Int @default(0) @map("tokens_in")
- tokensOut       Int @default(0) @map("tokens_out")
- embeddingTokens Int @default(0) @map("embedding_tokens")
  latencyMs Int? @map("latency_ms")
}
```

The HNSW index `knowledge_chunks_embedding_idx` goes with the column.

## Code edits that must land in the same change

Dropping the columns without these breaks the build or the first request:

1. `AgentsService.create` still writes `systemPrompt: dto.systemPrompt ?? DEFAULT_PROMPT` — delete the line, the `DEFAULT_PROMPT` constant, and the `changes.systemPrompt` branch in `update`.
2. `AgentView` (and `agentView()`) still carries `systemPrompt` — remove it, and the same field in `CreateAgentDto` / `UpdateAgentDto`.
3. `frontend/src/features/ai-assistant/types.ts` still declares `systemPrompt` on `Agent`, `CreateAgentInput` and `UpdateAgentInput` — remove all three. No screen reads it today, so nothing else moves.

Nothing else in `Backend/src` or `frontend/src` names a dropped column; the
`grep` for `systemPrompt|tokensIn|tokensOut|embedTokens|extractTokens|embedding`
is clean apart from the three items above.

## What it costs to be wrong

- `agents.*`: the settings are gone with no recovery. `model` and `temperature`
  have defaults, so they come back. `system_prompt` comes back empty for every
  row — any instructions a customer had written are unrecoverable, which is the
  reason this half is worth a decision rather than a default.
- `knowledge_*`: `knowledge_chunks.text` and `knowledge_sources.text` are not
  touched. A re-index from stored text is still possible; the vectors themselves
  are not reconstructible without a provider, which is the point.
- `agent_runs.*`: counters return as `0`. `latency_ms` is untouched.

## Rollback

`rollback.sql` in this directory. It restores the shape and the defaults, not the
deleted values — see the header of that file.
