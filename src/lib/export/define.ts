import type { ZodType } from "zod";
import { readQuery } from "@/lib/api";
import type { SessionUser } from "@/lib/auth-helpers";

/** Helpers for describing an exportable area. The areas themselves are in entities.ts and admin-entities.ts. */

export type Plan = {
  total: number;
  headers: string[];
  filters: Record<string, unknown>;
  batches: () => AsyncGenerator<unknown[][]>;
};

export type PlanOptions = { includeDeleted: boolean };

export type ExportEntity = {
  file: string;
  /** Only admins may export it. */
  adminOnly: boolean;
  /** Needs a fresh authenticator code, so it is only served over POST. */
  stepUp: boolean;
  /** Has soft-deleted rows that an admin may ask for (with a code). */
  softDeleted: boolean;
  plan: (user: SessionUser, req: Request, opts: PlanOptions) => Promise<Plan>;
};

/** The parsed filters plus the deleted-rows switch, which never comes from the URL. */
export type WithDeleted<Q> = Q & { includeDeleted?: boolean };

export type Page = { take: number; skip?: number; cursor?: { id: string } };
type Col<R, C> = readonly [header: string, get: (row: R, ctx: C) => unknown];

const BATCH = 500;

/**
 * The filters for the audit record: a hand-picked list (`ids` or stock `keys`, rows picked on screen, or
 * `dealIds`, deals picked) is written as a count (`pickedRows` / `pickedDeals`), never as the list itself.
 */
export function pickedCount(q: object): Record<string, unknown> {
  const { ids, keys, dealIds, ...rest } = q as { ids?: string[]; keys?: string[]; dealIds?: string[] } & Record<string, unknown>;
  const out: Record<string, unknown> = { ...rest };
  if (Array.isArray(ids)) out.pickedRows = ids.length;
  if (Array.isArray(keys)) out.pickedRows = keys.length;
  if (Array.isArray(dealIds)) out.pickedDeals = dealIds.length;
  return out;
}

export async function* paged<T extends { id: string }>(fetch: (page: Page) => Promise<T[]>) {
  let cursor: string | undefined;
  for (;;) {
    const rows = await fetch({ take: BATCH, ...(cursor && { skip: 1, cursor: { id: cursor } }) });
    if (rows.length === 0) return;
    yield rows;
    if (rows.length < BATCH) return;
    cursor = rows[rows.length - 1].id;
  }
}

type Flags = { adminOnly?: boolean; stepUp?: boolean; softDeleted?: boolean };

export function listing<Q extends object, R extends { id: string }, C = undefined>(
  o: Flags & {
    file: string;
    schema: ZodType<Q>;
    count: (user: SessionUser, q: WithDeleted<Q>) => Promise<number>;
    fetch: (user: SessionUser, q: WithDeleted<Q>, page: Page) => Promise<R[]>;
    prepare?: (rows: R[]) => Promise<C>;
    columns: Col<R, C>[];
  },
): ExportEntity {
  return {
    file: o.file,
    adminOnly: o.adminOnly ?? false,
    stepUp: o.stepUp ?? false,
    softDeleted: o.softDeleted ?? false,
    async plan(user, req, opts) {
      const q: WithDeleted<Q> = { ...readQuery(req, o.schema), includeDeleted: opts.includeDeleted };
      return {
        total: await o.count(user, q),
        headers: o.columns.map((c) => c[0]),
        // A hand-picked selection is recorded as how many rows were asked for, not as a long list of ids.
        filters: pickedCount(q),
        async *batches() {
          for await (const rows of paged((page) => o.fetch(user, q, page))) {
            const ctx = o.prepare ? await o.prepare(rows) : (undefined as C);
            yield rows.map((r) => o.columns.map((c) => c[1](r, ctx)));
          }
        },
      };
    },
  };
}

/** One computed batch (stock, cash flow): small, so no paging. */
export function computed<Q extends object>(o: {
  file: string;
  schema: ZodType<Q>;
  headers: string[];
  rows: (user: SessionUser, q: Q) => Promise<unknown[][]>;
}): ExportEntity {
  return {
    file: o.file,
    adminOnly: false,
    stepUp: false,
    softDeleted: false,
    async plan(user, req) {
      const q = readQuery(req, o.schema);
      const rows = await o.rows(user, q);
      return {
        total: rows.length,
        headers: o.headers,
        filters: pickedCount(q),
        async *batches() {
          yield rows;
        },
      };
    },
  };
}
