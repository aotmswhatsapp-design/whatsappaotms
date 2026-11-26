import assert from "node:assert/strict";
import { test } from "node:test";

import { AgentsRunner } from "./agents.runner";

/** `runPass` is private: the timer is its only production caller. */
const pass = (runner: AgentsRunner) =>
  (runner as unknown as { runPass(): Promise<void> }).runPass();

test("a failing index still lets the reply be answered", async () => {
  let answered = 0;

  const knowledge = {
    recoverStale: async () => undefined,
    claim: async () => "source-1",
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
      recoverStale: async () => undefined,
      claim: async () => "source-1",
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

test("a failing recovery does not cost the pass its work", async () => {
  const claimed: string[] = [];

  const runner = new AgentsRunner(
    {
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
