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
    return state?.id===this.sessionId&&Boolean(state.participants[actor.userId]?.active);
  }
  async intake(_actor:Actor,_sourceId:string,_text:string):Promise<void>{
    // Quiet discussion notes are added in V2; research questions never mutate profiles.
  }
  async tool(actor:Actor,call:VoiceToolCall,signal:AbortSignal):Promise<unknown>{
    signal.throwIfAborted();
    if(!await this.authorized(actor))throw new PlanningError('Voice planning membership expired.');
    if(call.tool_name!=='research_course')throw new PlanningError('This voice tool is not connected yet.');
    const {question}=questionSchema.parse(call.parameters);
    const answer=await this.app.voiceQuestion(this.room,this.sessionId,actor,question,signal);
    signal.throwIfAborted();await this.deliver();
    return {answer,sourceLinks:'Detailed source links were posted in the linked text channel. Do not read URLs aloud.'};
  }
}
