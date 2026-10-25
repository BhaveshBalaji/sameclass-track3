import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import OpusScript from 'opusscript';
import type WebSocket from 'ws';
import { parseConfig } from '../src/config/index.js';
import { discordPCM, SpeechDecoder } from '../src/voice/audio.js';
import { ElevenAgent, ScribeUtterance, type AgentCallbacks } from '../src/voice/elevenlabs.js';
import { VoiceSession, type ConversationalConnection } from '../src/voice/session.js';
import { PlanningVoiceBackend } from '../src/application/voice.js';
import type { PlanningApplication } from '../src/application/planning.js';
import { commandDefinitions } from '../src/transport/discord/commands.js';

class Socket extends EventEmitter {
  readyState = 1;
  sent: any[] = [];
  send(value: string) { this.sent.push(JSON.parse(value)); }
  close() { this.readyState=3;this.emit('close'); }
  event(value:unknown) {this.emit('message',Buffer.from(JSON.stringify(value)));}
}
const config=parseConfig({});
const actor={userId:'alice',name:'Alice'};
const other={userId:'bob',name:'Bob'};
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('voice is opt-in and errors identify configuration names without exposing keys',()=>{
  assert.equal(config.VOICE_ENABLED,false);
  assert.throws(()=>parseConfig({VOICE_ENABLED:'true',ELEVENLABS_API_KEY:'secret-value'}),error=>{
    assert.match(String(error),/ELEVENLABS_AGENT_ID/);assert.doesNotMatch(String(error),/secret-value/);return true;
  });
});

test('voice controls require explicit consent and backend tool arguments cannot impersonate a member',async()=>{
  const commands=commandDefinitions.find(c=>c.name==='voice')!;
  const join=commands.options!.find(c=>c.name==='join')!;
  assert.ok('options' in join&&join.options?.some(o=>o.name==='consent'&&o.required));
  let called=0;const app={store:{read:async()=>({id:'session',participants:{alice:{active:true}}})},voiceQuestion:async()=>{called++;return 'answer';}};
  const backend=new PlanningVoiceBackend(app as unknown as PlanningApplication,{guildId:'guild',channelId:'text'},'session',async()=>{});
  await assert.rejects(()=>backend.tool(actor,{tool_name:'research_course',tool_call_id:'forged',parameters:{question:'test',userId:'bob'}},new AbortController().signal));
  await assert.rejects(()=>backend.tool(other,{tool_name:'research_course',tool_call_id:'outsider',parameters:{question:'test'}},new AbortController().signal),/expired/);
  await assert.rejects(()=>backend.tool(actor,{tool_name:'delete_session',tool_call_id:'unknown',parameters:{}},new AbortController().signal));
  await assert.rejects(()=>backend.tool(actor,{tool_name:'recommend_group',tool_call_id:'unasked',parameters:{}},new AbortController().signal,'Hey Ray, what is CSE 445 about?'),/explicitly/);
  assert.equal(called,0);
  const answer=await backend.tool(actor,{tool_name:'research_course',tool_call_id:'valid',parameters:{question:'test'}},new AbortController().signal);
  assert.equal(called,1);assert.equal((answer as {answer:string}).answer,'answer');
});

test('real Opus packets decode into Scribe audio; output converts to Discord PCM',()=>{
  const encoder=new OpusScript(48000,2,OpusScript.Application.VOIP),decoder=new SpeechDecoder();
  try{
    const decoded=decoder.decode(encoder.encode(Buffer.alloc(960*4),960));
    assert.equal(decoded.length,320*2);
    const pcm=Buffer.alloc(4);pcm.writeInt16LE(123,0);pcm.writeInt16LE(-321,2);
    const output=discordPCM(pcm,16000);
    assert.equal(output.length,24);assert.equal(output.readInt16LE(0),123);assert.equal(output.readInt16LE(12),-321);
    assert.throws(()=>discordPCM(pcm,22050),/Unsupported/);
  }finally{decoder.close();encoder.delete();}
});

test('agent protocol authenticates, dispatches tools and suppresses late output after cancellation',async()=>{
  const socket=new Socket();let completeTool!:(value:unknown)=>void;let toolSignal:AbortSignal|undefined;let played=0;
  const callbacks:AgentCallbacks={audio:()=>played++,text:()=>{},complete:()=>{},failed:()=>assert.fail('unexpected failure'),
    tool:async(call,signal)=>{if(call.tool_call_id==='successful')return {status:'ok'};toolSignal=signal;return new Promise(resolve=>{completeTool=resolve;});}};
  const agent=new ElevenAgent({ELEVENLABS_API_KEY:'synthetic',ELEVENLABS_AGENT_ID:'synthetic'},callbacks,()=>{
    queueMicrotask(()=>{socket.emit('open');socket.event({type:'conversation_initiation_metadata',conversation_initiation_metadata_event:{agent_output_audio_format:'pcm_16000'}});});
    return socket as unknown as WebSocket;
  },async(input,options)=>{
    assert.equal(new URL(String(input)).hostname,'api.elevenlabs.io');
    assert.equal((options!.headers as Record<string,string>)['xi-api-key'],'synthetic');
    return Response.json({signed_url:'wss://api.elevenlabs.io/v1/convai/conversation?token=synthetic'});
  });
  await agent.start('synthetic context');agent.message('Hey Ray, research this course.');
  assert.ok(socket.sent.some(e=>e.type==='contextual_update'));
  socket.event({type:'client_tool_call',client_tool_call:{tool_name:'get_my_notes',tool_call_id:'successful',parameters:{}}});
  await tick();
  assert.deepEqual(socket.sent.find(e=>e.type==='client_tool_result'),{type:'client_tool_result',tool_call_id:'successful',result:'{"status":"ok"}',is_error:false});
  socket.event({type:'client_tool_call',client_tool_call:{tool_name:'research_course',tool_call_id:'call1',parameters:{question:'test'}}});
  socket.event({type:'audio',audio_event:{audio_base_64:Buffer.alloc(4).toString('base64')}});
  assert.equal(played,1);agent.close();assert.equal(toolSignal?.aborted,true);
  completeTool({answer:'late'});await tick();
  socket.event({type:'audio',audio_event:{audio_base_64:'AAAA'}});
  assert.equal(played,1);assert.equal(socket.sent.filter(e=>e.type==='client_tool_result'&&e.tool_call_id==='call1').length,0);
});

test('Scribe buffers before readiness and returns only completed transcripts',()=>{
  const socket=new Socket();const transcripts:string[]=[];
  const scribe=new ScribeUtterance('synthetic',text=>transcripts.push(text),()=>assert.fail('unexpected failure'),()=>socket as unknown as WebSocket);
  scribe.write(Buffer.alloc(20000));scribe.finish();assert.equal(socket.sent.length,0);
  socket.event({message_type:'session_started'});
  assert.equal(socket.sent[0].message_type,'input_audio_chunk');assert.equal(socket.sent.at(-1).commit,true);
  socket.event({message_type:'partial_transcript',text:'wrong partial'});assert.equal(transcripts.length,0);
  socket.event({message_type:'committed_transcript',text:'Hey Ray, hello.'});assert.deepEqual(transcripts,['Hey Ray, hello.']);
});
test('an empty Scribe result still releases the caller capture exactly once',()=>{
  const socket=new Socket(),results:string[]=[];
  const scribe=new ScribeUtterance('synthetic',text=>results.push(text),()=>assert.fail('unexpected failure'),url=>{
    assert.equal(new URL(url).searchParams.get('commit_strategy'),'vad');return socket as unknown as WebSocket;
  });
  socket.event({message_type:'session_started'});
  socket.event({message_type:'committed_transcript',text:'   '});
  socket.event({message_type:'committed_transcript',text:'late'});
  assert.deepEqual(results,['']);assert.equal(socket.readyState,3);scribe.close();
});

test('the next agent waits for the prior socket to close in a one-conversation workspace',async()=>{
  const first=new Socket(),second=new Socket();let requests=0;
  const callbacks:AgentCallbacks={audio:()=>{},text:()=>{},complete:()=>{},failed:()=>assert.fail('unexpected failure'),tool:async()=>({})};
  const create=(socket:Socket)=>new ElevenAgent({ELEVENLABS_API_KEY:'synthetic',ELEVENLABS_AGENT_ID:'synthetic'},callbacks,()=>{
    queueMicrotask(()=>{socket.emit('open');socket.event({type:'conversation_initiation_metadata',conversation_initiation_metadata_event:{agent_output_audio_format:'pcm_16000'}});});
    return socket as unknown as WebSocket;
  },async()=>{requests++;return Response.json({signed_url:'wss://api.elevenlabs.io/v1/convai/conversation?token=synthetic'});},2000,0);
  const a=create(first);await a.start('first');
  first.close=()=>{first.readyState=2;};a.close();
  const b=create(second),starting=b.start('second');await tick();assert.equal(requests,1);
  first.readyState=3;first.emit('close');await starting;assert.equal(requests,2);b.close();
});

test('audio-idle completion waits for tool results and final answer text when the provider omits its completion event',async()=>{
  const socket=new Socket();let release!:(result:unknown)=>void,completions=0;
  const agent=new ElevenAgent({ELEVENLABS_API_KEY:'synthetic',ELEVENLABS_AGENT_ID:'synthetic'},{
    audio:()=>{},text:()=>{},failed:()=>assert.fail('unexpected failure'),
    tool:async()=>new Promise(resolve=>{release=resolve;}),complete:reason=>{assert.equal(reason,'audio_idle');completions++;agent.close();},
  },()=>{
    queueMicrotask(()=>{socket.emit('open');socket.event({type:'conversation_initiation_metadata',conversation_initiation_metadata_event:{agent_output_audio_format:'pcm_16000'}});});
    return socket as unknown as WebSocket;
  },async()=>Response.json({signed_url:'wss://api.elevenlabs.io/v1/convai/conversation?token=synthetic'}),10);
  await agent.start('test');agent.message('Hey Ray, research this course.');
  socket.event({type:'agent_response_complete'});assert.equal(completions,0);
  socket.event({type:'agent_response',agent_response_event:{agent_response:'Let me check.'}});
  socket.event({type:'audio',audio_event:{audio_base_64:'AAAA'}});
  socket.event({type:'client_tool_call',client_tool_call:{tool_call_id:'pending',tool_name:'research_course',parameters:{question:'test'}}});
  await new Promise(resolve=>setTimeout(resolve,25));assert.equal(completions,0);
  release({answer:'Synthetic result'});await tick();
  await new Promise(resolve=>setTimeout(resolve,25));assert.equal(completions,0);
  socket.event({type:'agent_response',agent_response_event:{agent_response:'Here is the result.'}});
  socket.event({type:'audio',audio_event:{audio_base_64:'AAAA'}});
  await new Promise(resolve=>setTimeout(resolve,25));assert.equal(completions,1);
});

test('roster consent, follow-up ownership, pause and stale callbacks are enforced',async()=>{
  let now=1000,authorized=true;const intake:string[]=[],tools:string[]=[],callbacks:AgentCallbacks[]=[];let plays=0,stops=0;
  const session=new VoiceSession(config,{
    authorized:async()=>authorized,intake:async(a,_id,text)=>{intake.push(a.userId+':'+text);},
    tool:async(a)=>{tools.push(a.userId);return {};},
  },{audio:()=>plays++,stop:()=>stops++,finish:()=>{},status:()=>{}},cb=>{
    callbacks.push(cb);return {start:async()=>{},message:()=>{},close:()=>{}} satisfies ConversationalConnection;
  },()=>now);
  await session.transcript('alice','Hey Ray, hello');assert.equal(callbacks.length,0);
  session.join(actor);session.join(other);
  await session.transcript('alice','I work Tuesdays.');assert.equal(callbacks.length,0);assert.equal(intake.length,1);
  await session.transcript('alice','Hey Ray, what about CSE 445?');assert.equal(callbacks.length,1);
  await callbacks[0]!.tool({tool_call_id:'1',tool_name:'research_course',parameters:{userId:'bob'}},new AbortController().signal);
  assert.deepEqual(tools,['alice']);
  session.interrupt();callbacks[0]!.audio(Buffer.alloc(4),16000);assert.equal(plays,0);
  await assert.rejects(()=>callbacks[0]!.tool({tool_call_id:'2',tool_name:'x',parameters:{}},new AbortController().signal),/expired/);
  await session.transcript('alice','And its grading?');assert.equal(callbacks.length,2);
  await session.transcript('bob','I prefer mornings.');assert.equal(callbacks.length,2);
  await session.transcript('alice','Another question.');assert.equal(callbacks.length,2);
  session.pause();await session.transcript('alice','Hey Ray, listen.');assert.equal(callbacks.length,2);
  session.resume();now+=31000;await session.transcript('alice','No wake phrase.');assert.equal(callbacks.length,2);
  authorized=false;await session.transcript('alice','Hey Ray, hello');assert.equal(session.participants.has('alice'),false);
  assert.ok(stops>0);session.close();
});
test('addressed-turn budget pauses before making another provider connection',async()=>{
  let connections=0;
  const session=new VoiceSession({...config,VOICE_MAX_TURNS:1},{authorized:async()=>true,intake:async()=>{},tool:async()=>({})},
    {audio:()=>{},stop:()=>{},finish:()=>{},status:()=>{}},()=>{connections++;return {start:async()=>{},message:()=>{},close:()=>{}};});
  session.join(actor);await session.transcript(actor.userId,'Hey Ray, hello.');
  await session.transcript(actor.userId,'Hey Ray, another question.');
  assert.equal(connections,1);assert.equal(session.listening,false);session.close();
});
test('the observed E-RAY transcription variant can address Ray',async()=>{
  let requests=0;
  const session=new VoiceSession(config,{authorized:async()=>true,intake:async()=>{},tool:async()=>({})},
    {audio:()=>{},stop:()=>{},finish:()=>{},status:()=>{}},()=>({start:async()=>{},message:()=>{requests++;},close:()=>{}}));
  session.join(actor);await session.transcript(actor.userId,'E-RAY, what have you noted for me?');
  assert.equal(requests,1);session.close();
});

test('pause/resume, context reset and leave/rejoin invalidate transcripts awaiting authorization or storage',async()=>{
  for(const phase of ['authorization','storage'] as const){
    for(const change of ['pause','reset','rejoin'] as const){
      let release!:()=>void,started!:()=>void,connections=0,intakeSignal:AbortSignal|undefined;
      const pendingStep=new Promise<void>(resolve=>{release=resolve;});
      const entered=new Promise<void>(resolve=>{started=resolve;});
      const session=new VoiceSession(config,{
        authorized:async()=>{if(phase==='authorization'){started();await pendingStep;}return true;},
        intake:async(_actor,_source,_text,signal)=>{intakeSignal=signal;if(phase==='storage'){started();await pendingStep;}},
        tool:async()=>({}),
      },{audio:()=>{},stop:()=>{},finish:()=>{},status:()=>{}},()=>{
        connections++;return {start:async()=>{},message:()=>{},close:()=>{}};
      });
      session.join(actor);
      const transcript=session.transcript(actor.userId,'Hey Ray, what are my notes?');
      await entered;
      if(change==='pause'){session.pause();session.resume();}
      if(change==='reset')session.clearContext();
      if(change==='rejoin'){session.leave(actor.userId);session.join(actor);}
      release();await transcript;
      assert.equal(connections,0,`${phase}/${change} must not reopen voice`);
      if(phase==='storage')assert.equal(intakeSignal?.aborted,true);
      session.close();
    }
  }
});
