import { z } from 'zod';
import type { PlanningApplication } from './planning.js';
import { PlanningError, type Actor, type Room } from '../domain/planning.js';
import type { VoiceBackend } from '../voice/session.js';
import type { VoiceToolCall } from '../voice/elevenlabs.js';

const questionSchema=z.object({question:z.string().trim().min(1).max(2000)}).strict();

export class PlanningVoiceBackend implements VoiceBackend {
  constructor(private app:PlanningApplication,private room:Room,private sessionId:string,private deliver:()=>Promise<void>){}
  async authorized(actor:Actor):Promise<boolean>{
    const state=await this.app.store.read(this.room);
    return state?.id===this.sessionId&&Boolean(state.participants[actor.userId]);
  }
  async intake(actor:Actor,sourceId:string,text:string,signal:AbortSignal):Promise<void>{
    await this.app.voiceIntake(this.room,this.sessionId,actor,sourceId,text,signal);
  }
  async tool(actor:Actor,call:VoiceToolCall,signal:AbortSignal,utterance=''):Promise<unknown>{
    signal.throwIfAborted();
    if(!await this.authorized(actor))throw new PlanningError('Voice planning membership expired.');
    if(call.tool_name==='get_my_notes'){
      z.object({}).strict().parse(call.parameters);
      return this.app.voiceNotes(this.room,this.sessionId,actor,signal);
    }
    if(call.tool_name==='session_recap'){
      z.object({}).strict().parse(call.parameters);
      const result=await this.app.voiceRecap(this.room,this.sessionId,actor,signal);
      signal.throwIfAborted();void this.deliver().catch(()=>{ /* The durable outbox can retry; speech must still receive the result. */ });return result;
    }
    if(call.tool_name==='recommend_group'){
      z.object({}).strict().parse(call.parameters);
      if(!/\b(?:recommend(?:ation)?s?|(?:find|suggest|plan|choose|pick)\b.*\b(?:us|our|group|together|classes|courses))\b/i.test(utterance))throw new PlanningError('Ask Ray explicitly for a group recommendation first.');
      const result=await this.app.voiceRecommend(this.room,this.sessionId,actor,signal);
      signal.throwIfAborted();void this.deliver().catch(()=>{ /* The durable outbox can retry; speech must still receive the result. */ });return result;
    }
    if(call.tool_name==='research_course'){
      const {question}=questionSchema.parse(call.parameters);
      const answer=await this.app.voiceQuestion(this.room,this.sessionId,actor,question,signal);
      signal.throwIfAborted();void this.deliver().catch(()=>{ /* The durable outbox can retry; speech must still receive the result. */ });
      return {answer,sourceLinks:'Detailed source links are queued for the linked text channel. Do not read URLs aloud.'};
    }
    throw new PlanningError('This voice tool is not connected yet.');
  }
}
