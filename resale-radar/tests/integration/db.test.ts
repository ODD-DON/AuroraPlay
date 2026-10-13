import { describe, expect, it } from "vitest";
import { getDb, withOwner, LOCAL_OWNER_ID } from "@/server/db";

const OTHER = "00000000-0000-4000-8000-000000000002";

describe("database", () => {
  it("migrates and enforces row-level security per owner", async () => {
    const db = await getDb();
    await db.query(`insert into auth.users (id, email) values ($1, 'other@local') on conflict do nothing`, [OTHER]);
    await withOwner(LOCAL_OWNER_ID, (q) => q.query(`insert into search_profiles (owner_id, name) values ($1, 'Mine')`, [LOCAL_OWNER_ID]));
    await withOwner(OTHER, (q) => q.query(`insert into search_profiles (owner_id, name) values ($1, 'Theirs')`, [OTHER]));
    const mine = await withOwner(LOCAL_OWNER_ID, (q) => q.query<{ name: string }>(`select name from search_profiles`));
    expect(mine.map((r) => r.name)).toEqual(["Mine"]);
    await expect(withOwner(LOCAL_OWNER_ID, (q) => q.query(`insert into search_profiles (owner_id, name) values ($1, 'Spoof')`, [OTHER]))).rejects.toThrow();
  });

  it("rejects unbalanced ledger entries and duplicate external refs", async () => {
    const insertEntry = (ref: string, debit: number, credit: number) =>
      withOwner(LOCAL_OWNER_ID, async (q) => {
        const [e] = await q.query<{ id: string }>(`insert into financial_entries (owner_id, kind, occurred_at, external_ref) values ($1, 'test', now(), $2) returning id`, [LOCAL_OWNER_ID, ref]);
        await q.query(`insert into financial_entry_lines (owner_id, entry_id, account_code, debit_cents) values ($1, $2, 'cash', $3)`, [LOCAL_OWNER_ID, e!.id, debit]);
        await q.query(`insert into financial_entry_lines (owner_id, entry_id, account_code, credit_cents) values ($1, $2, 'owner_equity', $3)`, [LOCAL_OWNER_ID, e!.id, credit]);
      });
    await insertEntry("ok-1", 100, 100);
    await expect(insertEntry("bad-1", 100, 90)).rejects.toThrow(/unbalanced/);
    await expect(insertEntry("ok-1", 100, 100)).rejects.toThrow();
  });
});
