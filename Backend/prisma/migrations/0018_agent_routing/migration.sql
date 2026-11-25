-- Several agents may work one number.
--
-- Until now the partial unique index below allowed exactly one active agent per
-- number, and activation switched the previous one off. New conversations are
-- routed instead: the router reads each active agent's description, picks the
-- one that fits the first message, and the thread keeps that agent.
--
-- Dropped rather than relaxed: a partial index cannot express "one of several",
-- and the routing lookup is already served by
-- `agents_whatsapp_account_id_is_active_idx`.

DROP INDEX "agents_one_active_per_account";
