-- Removes the chatbot table.
--
-- Destructive by nature: the cards the owner wrote are in `data` and nowhere
-- else. Take a copy first if a flow is worth keeping:
--
--   \copy (SELECT agent_id, data FROM "bot_flows") TO 'bot_flows.csv' CSV HEADER
--
-- After this runs, GET /v1/agents/:agentId/bot answers 503 BOT_STORE_MISSING and
-- the editor shows the install instruction instead of a card list.

DROP INDEX IF EXISTS "bot_flows_workspace_id_idx";
DROP INDEX IF EXISTS "bot_flows_agent_id_key";

DROP TABLE IF EXISTS "bot_flows";
