import type pg from 'pg';
import type { Room } from '../domain/planning.js';
import type { ResearchTurn } from '../research/types.js';
import { roomId } from './planning-store.js';

/** Only explicit Ray questions/answers, never unrelated channel history or private planning facts. */
export class ResearchMemory {
  constructor(private pool:pg.Pool,private namespace:string){}
  async referenced(room:Room,messageId:string):Promise<ResearchTurn|null>{
    const saved=await this.pool.query('SELECT turn FROM ray_app.research_replies WHERE namespace=$1 AND room_id=$2 AND message_id=$3',[this.namespace,roomId(room),messageId]);
    if(saved.rowCount)return saved.rows[0].turn;
    // Upgrade path for replies to Ray answers delivered before conversation memory existed.
    const old=await this.pool.query(`SELECT body FROM ray_app.planning_outbox WHERE namespace=$1 AND room_id=$2
      AND deliveries @> $3::jsonb ORDER BY created_at DESC LIMIT 1`,[this.namespace,roomId(room),JSON.stringify([messageId])]);
    if(!old.rowCount||!/https:\/\/(?:catalog\.apps\.asu\.edu|www\.ratemyprofessors\.com)/.test(old.rows[0].body.text??''))return null;
    return {requestId:old.rows[0].body.requestId??messageId,question:'',answer:String(old.rows[0].body.text??'').slice(0,4000),tasks:[],instructors:[]};
  }
  async begin(room:Room,userId:string,replyTo?:string):Promise<{turns:ResearchTurn[];version:number}>{
    const ref=replyTo?await this.referenced(room,replyTo):null;
    const row=await this.pool.query(`INSERT INTO ray_app.research_context(namespace,room_id,user_id,version) VALUES($1,$2,$3,1)
      ON CONFLICT(namespace,room_id,user_id) DO UPDATE SET version=research_context.version+1 RETURNING turns,version`,[this.namespace,roomId(room),userId]);
    const own=(row.rows[0].turns as ResearchTurn[]).slice(-5);
    // An explicit reply picks its branch, rather than unrelated newer messages by this user.
    return {turns:ref?[ref]:own,version:Number(row.rows[0].version)};
  }
  async finish(room:Room,userId:string,version:number,history:ResearchTurn[],turn:ResearchTurn):Promise<void>{
    turn={...turn,userId};
    const turns=[...history.filter(t=>t.requestId!==turn.requestId),turn].slice(-6);
    const updated=await this.pool.query(`UPDATE ray_app.research_context SET turns=$4 WHERE namespace=$1 AND room_id=$2 AND user_id=$3 AND version=$5`,
      [this.namespace,roomId(room),userId,JSON.stringify(turns),version]);
    if(!updated.rowCount)return;
    // Store by request immediately; delivery aliases it to every actual Discord response ID.
    await this.pool.query(`INSERT INTO ray_app.research_replies(namespace,room_id,message_id,turn) VALUES($1,$2,$3,$4)
      ON CONFLICT(namespace,room_id,message_id) DO NOTHING`,[this.namespace,roomId(room),turn.requestId,JSON.stringify(turn)]);
    await this.pool.query(`DELETE FROM ray_app.research_replies WHERE namespace=$1 AND room_id=$2 AND message_id IN
      (SELECT message_id FROM ray_app.research_replies WHERE namespace=$1 AND room_id=$2 ORDER BY created_at DESC OFFSET 100)`,[this.namespace,roomId(room)]);
  }
  async clear(room:Room,userId?:string):Promise<void>{
    if(userId){
      await this.pool.query("UPDATE ray_app.research_context SET turns='[]',version=version+1 WHERE namespace=$1 AND room_id=$2 AND user_id=$3",[this.namespace,roomId(room),userId]);
      await this.pool.query("DELETE FROM ray_app.research_replies WHERE namespace=$1 AND room_id=$2 AND turn->>'userId'=$3",[this.namespace,roomId(room),userId]);
    }else{
      await this.pool.query("UPDATE ray_app.research_context SET turns='[]',version=version+1 WHERE namespace=$1 AND room_id=$2",[this.namespace,roomId(room)]);
      await this.pool.query('DELETE FROM ray_app.research_replies WHERE namespace=$1 AND room_id=$2',[this.namespace,roomId(room)]);
    }
  }
  async delivered(room:Room,requestId:string,messageId:string):Promise<void>{
    await this.pool.query(`INSERT INTO ray_app.research_replies(namespace,room_id,message_id,turn)
      SELECT namespace,room_id,$4,turn FROM ray_app.research_replies WHERE namespace=$1 AND room_id=$2 AND message_id=$3
      ON CONFLICT(namespace,room_id,message_id) DO NOTHING`,[this.namespace,roomId(room),requestId,messageId]);
  }
}
