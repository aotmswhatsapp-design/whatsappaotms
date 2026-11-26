import assert from "node:assert/strict";
import { test } from "node:test";

import { AgentsRunner } from "./agents.runner";

/**
 * The timer is the only production caller, so a test drives the lifecycle
 * itself: the boot probe decides whether indexing runs at all.
 */
const pass = async (runner: AgentsRunner) => {
  const internal = runner as unknown as {
    onModuleInit(): Promise<void>;
    onModuleDestroy(): void;
    runPass(): Promise<void>;
  };

  await internal.onModuleInit();

  try {
    await internal.runPass();
  } finally {
    internal.onModuleDestroy();
  }
};

test("a failing index still lets the reply be answered", async () => {
  let answered = 0;

  const knowledge = {
    leaseSchemaReady: async () => true,
    recoverStale: async () => undefined,
    claim: async () => ({ id: "source-1", leaseToken: "tok-1" }),
    index: async () => {
      throw new Error("index exploded");
    },
  };
  const replies = {
    releaseStale: async () => undefined,
    claim: async () => {
      answered += 1;
      return "run-1";
    },
    answer: async () => undefined,
  };

  const runner = new AgentsRunner(knowledge as never, replies as never);
  await pass(runner);

  assert.equal(answered, 1);
});

test("a failing reply still lets the source be indexed", async () => {
  let indexed = 0;

  const runner = new AgentsRunner(
    {
      leaseSchemaReady: async () => true,
      recoverStale: async () => undefined,
      claim: async () => ({ id: "source-1", leaseToken: "tok-1" }),
      index: async () => {
        indexed += 1;
      },
    } as never,
    {
      releaseStale: async () => undefined,
      claim: async () => "run-1",
      answer: async () => {
        throw new Error("answer exploded");
      },
    } as never,
  );

  await pass(runner);

  assert.equal(indexed, 1);
});

test("both kinds are claimed in the same pass", async () => {
  const claimed: string[] = [];

  const runner = new AgentsRunner(
    {
      leaseSchemaReady: async () => true,
      recoverStale: async () => undefined,
      claim: async () => {
        claimed.push("source");
        return null;
      },
      index: async () => undefined,
    } as never,
    {
      releaseStale: async () => undefined,
      claim: async () => {
        claimed.push("run");
        return null;
      },
      answer: async () => undefined,
    } as never,
  );

  await pass(runner);

  assert.deepEqual(claimed.sort(), ["run", "source"]);
});

test("a missing lease column pauses indexing and leaves replies running", async () => {
  let claimed = 0;
  let answered = 0;

  const runner = new AgentsRunner(
    {
      leaseSchemaReady: async () => false,
      recoverStale: async () => undefined,
      claim: async () => {
        claimed += 1;
        return null;
      },
      index: async () => undefined,
    } as never,
    {
      releaseStale: async () => undefined,
      claim: async () => {
        answered += 1;
        return "run-1";
      },
      answer: async () => undefined,
    } as never,
  );

  await pass(runner);

  // No claim, no recovery: the row would be written under a NULL token. The
  // reply side is untouched.
  assert.equal(claimed, 0);
  assert.equal(answered, 1);
});

test("a failing recovery does not cost the pass its work", async () => {
  const claimed: string[] = [];

  const runner = new AgentsRunner(
    {
      leaseSchemaReady: async () => true,
      recoverStale: async () => {
        throw new Error("recovery exploded");
      },
      claim: async () => {
        claimed.push("source");
        return null;
      },
      index: async () => undefined,
    } as never,
    {
      releaseStale: async () => {
        throw new Error("release exploded");
      },
      claim: async () => {
        claimed.push("run");
        return null;
      },
      answer: async () => undefined,
    } as never,
  );

  await pass(runner);

  assert.deepEqual(claimed.sort(), ["run", "source"]);
});
