import type { AuthClaims } from "../../auth/auth.types";

export interface Call {
  path: string;
  args: any;
  ok: boolean;
}

/** Every column a `knowledgeSource` row has, so a partial fake still renders. */
const ROW = {
  id: "src-1",
  kind: "FILE",
  title: "prices.pdf",
  mime: null,
  size: null,
  storagePath: null,
  text: null,
  status: "PENDING",
  error: null,
  charCount: 0,
  chunkCount: 0,
  embedTokens: 0,
  attempts: 0,
  indexedAt: null,
  sha256: null,
  uploadedByUserId: null,
  replacesSourceId: null,
  meta: null,
  extractTokens: 0,
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

/** Records every model call and can be told to refuse a specific one. */
export class FakePrisma {
  readonly calls: Call[] = [];
  private failOn = new Set<string>();

  refuse(path: string): void {
    this.failOn.add(path);
  }

  allow(path: string): void {
    this.failOn.delete(path);
  }

  private async invoke(path: string, args: any, run: () => any) {
    const ok = !this.failOn.has(path);
    this.calls.push({ path, args, ok });
    if (!ok) throw new Error(`${path} refused`);
    return run();
  }

  knowledgeSource = {
    create: (args: any) =>
      this.invoke("knowledgeSource.create", args, () => ({
        ...ROW,
        ...args.data,
      })),
    createMany: (args: any) =>
      this.invoke("knowledgeSource.createMany", args, () => ({
        count: args.data.length,
      })),
    findFirst: (args: any) =>
      this.invoke("knowledgeSource.findFirst", args, () => null),
    findUnique: (args: any) =>
      this.invoke("knowledgeSource.findUnique", args, () => null),
    findMany: (args: any) =>
      this.invoke("knowledgeSource.findMany", args, () => []),
    update: (args: any) =>
      this.invoke("knowledgeSource.update", args, () => ({
        ...ROW,
        ...args.data,
        id: args.where.id,
      })),
    updateMany: (args: any) =>
      this.invoke("knowledgeSource.updateMany", args, () => ({ count: 1 })),
    delete: (args: any) =>
      this.invoke("knowledgeSource.delete", args, () => ({ id: args.where.id })),
    deleteMany: (args: any) =>
      this.invoke("knowledgeSource.deleteMany", args, () => ({ count: 0 })),
  };

  knowledgeChunk = {
    deleteMany: (args: any) =>
      this.invoke("knowledgeChunk.deleteMany", args, () => ({ count: 0 })),
    createMany: (args: any) =>
      this.invoke("knowledgeChunk.createMany", args, () => ({
        count: args.data.length,
      })),
    findMany: (args: any) =>
      this.invoke("knowledgeChunk.findMany", args, () => []),
  };

  agent = {
    findFirst: (args: any) =>
      this.invoke("agent.findFirst", args, () => ({
        id: args.where.id,
        workspaceId: args.where.workspaceId,
      })),
    findUniqueOrThrow: (args: any) =>
      this.invoke("agent.findUniqueOrThrow", args, () => ({
        id: args.where.id,
      })),
  };

  $executeRaw = (...args: any[]) => this.invoke("$executeRaw", args, () => 1);
  $executeRawUnsafe = (...args: any[]) =>
    this.invoke("$executeRawUnsafe", args, () => 1);
  $queryRaw = (...args: any[]) => this.invoke("$queryRaw", args, () => []);
  $transaction = async (input: any) =>
    Array.isArray(input) ? Promise.all(input) : input(this);
}

/** Records bytes by path; `failRemove` proves the strict path throws. */
export class FakeStorage {
  readonly uploaded: { path: string; bytes: Buffer; mime: string }[] = [];
  readonly removed: string[][] = [];
  failRemove = false;
  failUpload = false;

  async upload(path: string, bytes: Buffer, mime: string) {
    if (this.failUpload) throw new Error("storage refused the upload");
    this.uploaded.push({ path, bytes, mime });
  }

  async download() {
    return Buffer.from("hello");
  }

  async signedUrl(path: string) {
    return `https://signed.test/${path}`;
  }

  async remove(paths: string[], options: { strict?: boolean } = {}) {
    if (this.failRemove && options.strict) {
      throw new Error("storage refused the delete");
    }
    this.removed.push(paths);
  }

  async list() {
    return [];
  }

  get configured() {
    return true;
  }
}

export class FakeProvider {
  embedTokens = 7;

  async embed(input: string[]) {
    return {
      vectors: input.map(() => new Array(1536).fill(0.01)),
      tokens: this.embedTokens,
    };
  }

  async chat() {
    return { text: "ok", tokensIn: 1, tokensOut: 1 };
  }

  get configured() {
    return true;
  }
}

export class FakeWorkspaces {
  constructor(
    readonly workspaceId = "ws-a",
    readonly userId = "user-a",
  ) {}

  async primaryFor(_claims: AuthClaims) {
    return {
      workspaceId: this.workspaceId,
      userId: this.userId,
      role: "OWNER" as const,
    };
  }
}

export const CLAIMS: AuthClaims = {
  id: "user-a",
  email: "a@example.test",
  role: "authenticated",
  metadata: {},
};
