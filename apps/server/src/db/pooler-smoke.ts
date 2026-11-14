// The pooler smoke check (testing.md › Pooler behaviour, ADR 0004). Neon doesn't document
// that set_config(..., true) stays inside one transaction through its pooler, so this
// proves it: several connections run transactions that each set their own app.staff_id,
// and nothing may see another's, or any, outside its own transaction.
//
// Read-only: it writes no rows, so it is safe on staging. It reads the setting directly
// rather than through current_staff_id(), so it needs no Staff member.
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const CONNECTIONS = 4;

type Seen = { staffId: string | null; pid: number };

export type PoolerSmokeResult = {
  /**
   * passed: no leaks, and at least one backend served two connections, so a leak had
   * the chance to show. inconclusive: no leaks, but no backend was ever shared.
   */
  outcome: 'passed' | 'failed' | 'inconclusive';
  transactions: number;
  /** Did any backend serve more than one of the client connections? */
  sharedBackend: boolean;
  leaks: string[];
};

async function seen(client: pg.Client): Promise<Seen> {
  const result = await client.query<{ staff_id: string | null; pid: number }>(
    `select nullif(current_setting('app.staff_id', true), '') as staff_id, pg_backend_pid() as pid`,
  );
  const row = result.rows[0];
  if (!row) throw new Error('The pooler smoke check got no row back');
  return { staffId: row.staff_id, pid: row.pid };
}

export async function checkPoolerIsolation(
  url: string,
  options: { rounds?: number } = {},
): Promise<PoolerSmokeResult> {
  const rounds = options.rounds ?? 20;
  const clients = Array.from(
    { length: CONNECTIONS },
    () => new pg.Client({ connectionString: url }),
  );
  const leaks: string[] = [];
  const connectionsByBackend = new Map<number, Set<number>>();
  let transactions = 0;

  const note = (connection: number, pid: number) => {
    const connections = connectionsByBackend.get(pid) ?? new Set<number>();
    connections.add(connection);
    connectionsByBackend.set(pid, connections);
  };

  // One request: a transaction that sets its own app.staff_id and reads it twice, with a
  // pause between so a concurrent request can interleave. Then a read outside any
  // transaction, which must see no Staff member at all.
  const request = async (connection: number) => {
    const client = clients[connection];
    if (!client) throw new Error(`No connection ${connection}`);
    const staffId = randomUUID();
    await client.query('begin');
    try {
      await client.query(`select set_config('app.staff_id', $1, true)`, [staffId]);
      const first = await seen(client);
      await client.query('select pg_sleep(0.01)');
      const second = await seen(client);
      await client.query('commit');
      transactions++;
      note(connection, first.pid);
      for (const view of [first, second]) {
        if (view.staffId !== staffId) {
          leaks.push(
            `connection ${connection} set ${staffId} but saw ${view.staffId} (backend ${view.pid})`,
          );
        }
      }
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    }
    const after = await seen(client);
    note(connection, after.pid);
    if (after.staffId !== null) {
      leaks.push(
        `connection ${connection} saw ${after.staffId} outside a transaction (backend ${after.pid})`,
      );
    }
  };

  try {
    await Promise.all(clients.map((client) => client.connect()));
    for (let round = 0; round < rounds; round++) {
      // One after another, so an idle backend is handed from one connection to the next.
      for (let connection = 0; connection < CONNECTIONS; connection++) {
        await request(connection);
      }
      // All at once, so transactions interleave on the pooler.
      await Promise.all(clients.map((_, connection) => request(connection)));
    }
  } finally {
    await Promise.allSettled(clients.map((client) => client.end()));
  }

  const sharedBackend = [...connectionsByBackend.values()].some((set) => set.size > 1);
  return {
    outcome: leaks.length > 0 ? 'failed' : sharedBackend ? 'passed' : 'inconclusive',
    transactions,
    sharedBackend,
    leaks,
  };
}
