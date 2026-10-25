import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { Outgoing, PlanningSession, Room } from '../domain/planning.js';

export function roomId(room: Room) { return `${room.guildId}:${room.channelId}`; }
export interface Transaction {
  state: PlanningSession | null;
  enqueue(response: Outgoing, guarded?: boolean): Promise<void>;
  erase(sessionId: string): Promise<void>;
}
export class PlanningStore {
  constructor(readonly pool: pg.Pool, readonly namespace = 'discord') {}
  async transact<T>(room: Room, eventId: string, apply: (tx: Transaction) => Promise<T>): Promise<{ duplicate: boolean; value?: T }> {
    const client = await this.pool.connect(), id = roomId(room);
    try {
      await client.query('BEGIN');
      await client.query(`INSERT INTO ray_app.planning_rooms(namespace,room_id) VALUES($1,$2) ON CONFLICT DO NOTHING`, [this.namespace,id]);
      const row = await client.query(`SELECT state FROM ray_app.planning_rooms WHERE namespace=$1 AND room_id=$2 FOR UPDATE`, [this.namespace,id]);
      const claim = await client.query(`INSERT INTO ray_app.planning_events(namespace,event_id,room_id) VALUES($1,$2,$3)
        ON CONFLICT DO NOTHING RETURNING event_id`, [this.namespace,eventId,id]);
      if (!claim.rowCount) { await client.query('ROLLBACK'); return { duplicate: true }; }
      const tx: Transaction = { state: row.rows[0].state,
        erase: async sessionId => {
          await client.query(`UPDATE ray_app.planning_outbox SET status='cancelled', body='{}', deliveries='[]'
            WHERE namespace=$1 AND room_id=$2 AND session_id=$3`, [this.namespace,id,sessionId]);
        },
        enqueue: async (response, guarded = false) => {
          await client.query(`INSERT INTO ray_app.planning_outbox(id,namespace,room_id,session_id,snapshot_version,body)
            VALUES($1,$2,$3,$4,$5,$6)`, [response.id,this.namespace,id,tx.state?.id ?? null,
              guarded ? tx.state?.version : null,JSON.stringify(response)]);
        } };
      const value = await apply(tx);
      await client.query(`UPDATE ray_app.planning_rooms SET state=$3 WHERE namespace=$1 AND room_id=$2`, [this.namespace,id,tx.state ? JSON.stringify(tx.state) : null]);
      await client.query('COMMIT'); return { duplicate: false, value };
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  async read(room: Room): Promise<PlanningSession | null> {
    const result = await this.pool.query('SELECT state FROM ray_app.planning_rooms WHERE namespace=$1 AND room_id=$2', [this.namespace,roomId(room)]);
    return result.rows[0]?.state ?? null;
  }
  async eraseResponses(tx: Transaction, sessionId: string) {
    // Invoked under the room lock; the session ID prevents a reset from touching a new session.
    await tx.erase(sessionId);
  }
  /** Sending state is conservative: restart never blindly repeats a possibly delivered message. */
  async recover(): Promise<void> {
    await this.pool.query(`UPDATE ray_app.planning_outbox SET status='uncertain' WHERE namespace=$1 AND status='sending'`, [this.namespace]);
    await this.pool.query(`UPDATE ray_app.planning_rooms SET state=state-'currentRequest' WHERE namespace=$1 AND state IS NOT NULL`, [this.namespace]);
  }
  async deliver(room: Room, send: (body: Outgoing, part: number, content: string) => Promise<string>): Promise<boolean> {
    let successful = true;
    const ids = await this.pool.query(`SELECT id FROM ray_app.planning_outbox WHERE namespace=$1 AND room_id=$2 AND status='pending' ORDER BY created_at`, [this.namespace,roomId(room)]);
    for (const { id } of ids.rows) {
      const client = await this.pool.connect();
      let body: Outgoing | undefined;
      try {
        await client.query('BEGIN');
        const current = await client.query(`SELECT state FROM ray_app.planning_rooms WHERE namespace=$1 AND room_id=$2 FOR UPDATE`, [this.namespace,roomId(room)]);
        const claimed = await client.query(`UPDATE ray_app.planning_outbox SET status='sending'
          WHERE id=$1 AND status='pending' RETURNING *`, [id]);
        const row = claimed.rows[0];
        if (row) {
          const session = current.rows[0]?.state as PlanningSession | null;
          body = row.body as Outgoing;
          if (row.session_id && session?.id !== row.session_id) {
            await client.query("UPDATE ray_app.planning_outbox SET status='cancelled' WHERE id=$1", [id]); body = undefined;
          } else if (row.snapshot_version !== null && session?.version !== Number(row.snapshot_version)) {
            body = { id, text: 'New planning messages arrived. Mention Ray again to refresh; the older snapshot has not overwritten newer preferences.', mentions: [], clarificationIds: [] };
            if (session) {
              const removed = session.clarifications.filter(q => q.responseId === id);
              session.clarifications = session.clarifications.filter(q => q.responseId !== id);
              for (const q of removed) if (q.field === 'participation' && !q.messageIds.length) {
                const person = session.participants[q.userId];
                if (person) person.silenceAsked = false;
              }
              await client.query('UPDATE ray_app.planning_rooms SET state=$3 WHERE namespace=$1 AND room_id=$2', [this.namespace,roomId(room),JSON.stringify(session)]);
            }
          }
        }
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
      if (!body) continue;
      const messageIds: string[] = [];
      try {
        // Small parts leave room for actual transport mentions, below Discord's 2000-char cap.
        const parts = body.text.match(/[\s\S]{1,1700}/g) ?? [''];
        for (const [part, content] of parts.entries()) {
          const externalId = await send(body,part,content); messageIds.push(externalId);
          await this.pool.query('UPDATE ray_app.planning_outbox SET deliveries=$2 WHERE id=$1', [id,JSON.stringify(messageIds)]);
          await this.transact(room,`delivery:${id}:${part}`,async tx => {
            if (tx.state) for (const q of tx.state.clarifications) if (body!.clarificationIds.includes(q.id)) q.messageIds.push(externalId);
          });
        }
        await this.pool.query("UPDATE ray_app.planning_outbox SET status='sent' WHERE id=$1", [id]);
      } catch {
        successful = false;
        await this.pool.query("UPDATE ray_app.planning_outbox SET status='uncertain' WHERE id=$1", [id]);
        // A new explicit request can regenerate a response; retries must not duplicate a send.
      }
    }
    return successful;
  }
}
export function response(text: string, mentions: string[] = []): Outgoing {
  return { id: randomUUID(), text, mentions: [...new Set(mentions)], clarificationIds: [] };
}
