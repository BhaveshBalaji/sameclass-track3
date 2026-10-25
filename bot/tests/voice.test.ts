import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import OpusScript from 'opusscript';
import type WebSocket from 'ws';
import { parseConfig } from '../src/config/index.js';
import { discordPCM, SpeechDecoder,SpeechActivityGate } from '../src/voice/audio.js';
import { ElevenAgent, ScribeUtterance, type AgentCallbacks } from '../src/voice/elevenlabs.js';
import { addressesRay, VoiceSession, type ConversationalConnection } from '../src/voice/session.js';
import { voiceRouter } from '../src/voice/router.js';
import { PlanningVoiceBackend } from '../src/application/voice.js';
import type { PlanningApplication } from '../src/application/planning.js';
import { commandDefinitions,discordSettings,voiceCommandAllowed } from '../src/transport/discord/commands.js';

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
test('voice commands are limited to the dedicated text channel while main planning remains available',()=>{
  const c=parseConfig({DISCORD_BOT_TOKEN:'synthetic',DISCORD_APPLICATION_ID:'111111111111111111',DISCORD_GUILD_ID:'111111111111111111',
    DISCORD_PLANNING_CHANNEL_IDS:'222222222222222222',DISCORD_VOICE_TEXT_CHANNEL_ID:'333333333333333333'});
  assert.equal(voiceCommandAllowed(c,'222222222222222222'),false);
  assert.equal(voiceCommandAllowed(c,'333333333333333333'),true);
  assert.ok(discordSettings(c).channels.has('222222222222222222'));assert.ok(discordSettings(c).channels.has('333333333333333333'));
});
test('quiet background audio and a single loud click do not interrupt a response',()=>{
  const gate=new SpeechActivityGate(1000),quiet=Buffer.alloc(640),speech=Buffer.alloc(640);
  for(let i=0;i<640;i+=2){quiet.writeInt16LE(450,i);speech.writeInt16LE(5000,i);}
  for(let i=0;i<20;i++)assert.equal(gate.push(quiet),false);
  assert.equal(gate.push(speech),false);assert.equal(gate.push(quiet),false);
  assert.equal(gate.push(speech),false);assert.equal(gate.push(speech),false);assert.equal(gate.push(speech),true);
  assert.equal(gate.detected,true);assert.equal(gate.push(speech),false);
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
  socket.event({type:'agent_response_complete'});
  await new Promise(resolve=>setTimeout(resolve,25));assert.equal(completions,0,'acknowledgement audio must not complete the final answer before its speech arrives');
  socket.event({type:'audio',audio_event:{audio_base_64:'AAAA'}});
  await new Promise(resolve=>setTimeout(resolve,25));assert.equal(completions,1);
});

test('roster consent, direct-address outage fallback, pause and stale callbacks are enforced',async()=>{
  let authorized=true;const intake:string[]=[],tools:string[]=[],callbacks:AgentCallbacks[]=[];let plays=0,stops=0;
  const session=new VoiceSession(config,{
    authorized:async()=>authorized,intake:async(a,_id,text)=>{intake.push(a.userId+':'+text);},
    tool:async(a)=>{tools.push(a.userId);return {};},
  },{audio:()=>plays++,stop:()=>stops++,finish:()=>{},status:()=>{}},cb=>{
    callbacks.push(cb);return {start:async()=>{},message:()=>{},close:()=>{}} satisfies ConversationalConnection;
  });
  await session.transcript('alice','Hey Ray, hello');assert.equal(callbacks.length,0);
  session.join(actor);session.join(other);
  await session.transcript('alice','I work Tuesdays.');assert.equal(callbacks.length,0);assert.equal(intake.length,1);
  await session.transcript('alice','Hey Ray, what about CSE 445?');assert.equal(callbacks.length,1);
  await callbacks[0]!.tool({tool_call_id:'1',tool_name:'research_course',parameters:{userId:'bob'}},new AbortController().signal);
  assert.deepEqual(tools,['alice']);
  session.interrupt();callbacks[0]!.audio(Buffer.alloc(4),16000);assert.equal(plays,0);
  await assert.rejects(()=>callbacks[0]!.tool({tool_call_id:'2',tool_name:'x',parameters:{}},new AbortController().signal),/expired/);
  await session.transcript('alice','And its grading?');assert.equal(callbacks.length,1);
  await session.transcript('alice','Ray, and its grading?');assert.equal(callbacks.length,2);
  await session.transcript('bob','I prefer mornings.');assert.equal(callbacks.length,2);
  await session.transcript('alice','Another question.');assert.equal(callbacks.length,2);
  session.pause();await session.transcript('alice','Hey Ray, listen.');assert.equal(callbacks.length,2);
  session.resume();await session.transcript('alice','No wake phrase.');assert.equal(callbacks.length,2);
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
test('joining greeting is conversational, never becomes student evidence, and cannot call tools',async()=>{
  let intake=0,requests=0;const callbacks:AgentCallbacks[]=[];
  const session=new VoiceSession(config,{authorized:async()=>true,intake:async()=>{intake++;},tool:async()=>assert.fail('greeting must not use tools')},
    {audio:()=>{},stop:()=>{},finish:()=>{},status:()=>{}},cb=>{callbacks.push(cb);return {start:async()=>{},message:()=>{requests++;},close:()=>{}};});
  await session.greet(actor);assert.equal(requests,0);
  session.join(actor);await session.greet(actor);assert.equal(requests,1);assert.equal(intake,0);
  await assert.rejects(()=>callbacks[0]!.tool({tool_name:'get_my_notes',tool_call_id:'bad',parameters:{}},new AbortController().signal),/Greeting/);
  callbacks[0]!.complete();
  await session.transcript(actor.userId,'Hello!');assert.equal(requests,1);assert.equal(intake,1);
  session.close();
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

test('passive conversation while research is pending preserves the final spoken answer',async()=>{
  let callback!:AgentCallbacks,closed=0,plays=0;const retained:string[]=[];
  const session=new VoiceSession(config,{authorized:async()=>true,intake:async(_a,_id,text)=>{retained.push(text);},tool:async()=>({})},
    {audio:()=>plays++,stop:()=>{},finish:()=>{},status:()=>{}},cb=>{callback=cb;return {start:async()=>{},message:()=>{},close:()=>{closed++;}};});
  session.join(actor);session.join(other);
  await session.transcript(actor.userId,'Hey Ray, explain CSE 445.');
  await session.transcript(other.userId,'Do you want lunch?');
  await session.transcript(actor.userId,'Yes, how about noon?');
  assert.equal(closed,0);assert.equal(retained.length,3);
  callback.audio(Buffer.alloc(8),16000);assert.equal(plays,1);
  callback.complete();assert.equal(closed,1);session.close();
});

test('a failed text delivery cannot discard a successful guest voice tool answer',async()=>{
  const app={store:{read:async()=>({id:'session',participants:{alice:{active:false}}})},voiceQuestion:async()=> 'A supported answer'};
  const backend=new PlanningVoiceBackend(app as unknown as PlanningApplication,{guildId:'guild',channelId:'voice-text'},'session',async()=>{throw new Error('Synthetic Discord outage');});
  assert.equal(await backend.authorized(actor),true);
  const result=await backend.tool(actor,{tool_name:'research_course',tool_call_id:'guest',parameters:{question:'test'}},new AbortController().signal) as {answer:string};
  assert.equal(result.answer,'A supported answer');await tick();
});

test('partial transcription can identify a Ray interruption without admitting friend speech as a request',()=>{
  const socket=new Socket();let interruptions=0,finals=0;
  const scribe=new ScribeUtterance('synthetic',()=>finals++,()=>assert.fail('unexpected failure'),()=>socket as unknown as WebSocket,
    text=>{if(addressesRay(text))interruptions++;});
  socket.event({message_type:'partial_transcript',text:'What do you think about Ray?'});
  assert.equal(interruptions,0);
  socket.event({message_type:'partial_transcript',text:'Hey Ray, wait'});
  assert.equal(interruptions,1);assert.equal(finals,0);scribe.close();
});

test('bare Ray requests work and shared context preserves speaker attribution and the original topic',async()=>{
  const contexts:string[]=[],callbacks:AgentCallbacks[]=[];
  const session=new VoiceSession(config,{authorized:async()=>true,intake:async()=>{},tool:async()=>({})},
    {audio:()=>{},stop:()=>{},finish:()=>{},status:()=>{}},cb=>{callbacks.push(cb);return {start:async context=>{contexts.push(context);},message:()=>{},close:()=>{}};});
  session.join(actor);session.join(other);
  await session.transcript(actor.userId,'Ray, find database courses next semester.');
  callbacks[0]!.text('Let me check.');callbacks[0]!.text('Which semester?');callbacks[0]!.complete();
  await session.transcript(other.userId,'Ray, tell me about biology.');callbacks[1]!.complete();
  await session.transcript(actor.userId,'Ray, Spring 2027.');
  assert.match(contexts[2]!,/database courses/);assert.match(contexts[2]!,/Which semester/);assert.match(contexts[2]!,/biology/);assert.match(contexts[2]!,/bob/);assert.doesNotMatch(contexts[2]!,/Let me check/);
  callbacks[2]!.complete();await session.transcript(actor.userId,'Ray');assert.equal(callbacks.length,4);session.close();
});

test('audio completion waits for queued PCM playback across gaps in fast provider synthesis',async()=>{
  const socket=new Socket();let completions=0;
  const agent=new ElevenAgent({ELEVENLABS_API_KEY:'synthetic',ELEVENLABS_AGENT_ID:'synthetic'},
    {audio:()=>{},text:()=>{},tool:async()=>({}),failed:()=>assert.fail('unexpected failure'),complete:()=>{completions++;agent.close();}},()=>{
      queueMicrotask(()=>{socket.emit('open');socket.event({type:'conversation_initiation_metadata',conversation_initiation_metadata_event:{agent_output_audio_format:'pcm_16000'}});});
      return socket as unknown as WebSocket;
    },async()=>Response.json({signed_url:'wss://api.elevenlabs.io/v1/convai/conversation?token=synthetic'}),10,0);
  await agent.start('synthetic');agent.message('Ray, explain.');
  socket.event({type:'agent_response',agent_response_event:{agent_response:'First sentence. Second sentence.'}});
  socket.event({type:'audio',audio_event:{audio_base_64:Buffer.alloc(3200).toString('base64')}}); // 100ms PCM
  socket.event({type:'agent_response_complete'});
  await new Promise(resolve=>setTimeout(resolve,35));assert.equal(completions,0);
  socket.event({type:'audio',audio_event:{audio_base_64:Buffer.alloc(3200).toString('base64')}});
  await new Promise(resolve=>setTimeout(resolve,100));assert.equal(completions,0);
  await new Promise(resolve=>setTimeout(resolve,110));assert.equal(completions,1);
});

test('ambient routing retains passive shared context, answers without a name, and only interrupts for a routed request',async()=>{
  const callbacks:AgentCallbacks[]=[],messages:string[]=[],contexts:string[]=[],toolRequests:string[]=[],inputs:import('../src/voice/session.js').VoiceRoutingInput[]=[];
  let closed=0,played=0;
  const session=new VoiceSession(config,{authorized:async()=>true,intake:async()=>{},
    route:async input=>{inputs.push(input);return {action:input.utterance.startsWith('Can you')?'reply':'listen',request:input.utterance+' for Spring 2027'};},
    tool:async(_actor,_call,_signal,utterance)=>{toolRequests.push(utterance);return {};},
  },{audio:()=>played++,stop:()=>{},finish:()=>{},status:()=>{}},cb=>{callbacks.push(cb);return {start:async context=>{contexts.push(context);},message:text=>messages.push(text),close:()=>closed++};});
  session.join(actor);session.join(other);
  await session.transcript(actor.userId,'We are choosing Spring 2027.');assert.equal(callbacks.length,0);
  await session.transcript(other.userId,'Can you find database courses?');assert.equal(callbacks.length,1);
  assert.match(contexts[0]!,/Spring 2027/);assert.match(contexts[0]!,/alice/);
  await callbacks[0]!.tool({tool_name:'research_course',tool_call_id:'1',parameters:{}},new AbortController().signal);
  assert.match(toolRequests[0]!,/Spring 2027/);
  await session.transcript(actor.userId,'Bob, do you want lunch?');assert.equal(closed,0);
  callbacks[0]!.audio(Buffer.alloc(8),16000);assert.equal(played,1);
  await session.transcript(actor.userId,'Can you show the CSE 412 syllabus instead?');assert.equal(closed,1);assert.equal(callbacks.length,2);
  assert.equal(inputs.at(-1)!.rayBusy,true);assert.match(messages[1]!,/CSE 412/);
  callbacks[0]!.audio(Buffer.alloc(8),16000);assert.equal(played,1);
  await assert.rejects(()=>callbacks[0]!.tool({tool_name:'research_course',tool_call_id:'stale',parameters:{}},new AbortController().signal),/expired/);
  callbacks[1]!.audio(Buffer.alloc(8),16000);assert.equal(played,2);session.close();
});

test('ambient routing accepts a clarification answer and supports stop without another provider call',async()=>{
  const messages:string[]=[];let callback!:AgentCallbacks,closed=0;
  const session=new VoiceSession(config,{authorized:async()=>true,intake:async()=>{},tool:async()=>({}),route:async input=>{
    if(input.utterance==='Stop talking for a moment.')return {action:'stop',request:''};
    return {action:'reply',request:input.utterance==='Spring 2027.'?'Find database courses in Spring 2027.':input.utterance};
  }},{audio:()=>{},stop:()=>{},finish:()=>{},status:()=>{}},cb=>{callback=cb;return {start:async()=>{},message:text=>messages.push(text),close:()=>closed++};});
  session.join(actor);await session.transcript(actor.userId,'Find database courses next semester.');
  callback.text('Which semester?');callback.complete();
  await session.transcript(actor.userId,'Spring 2027.');assert.equal(messages.length,2);assert.match(messages[1]!,/Find database courses in Spring 2027/);
  await session.transcript(actor.userId,'Stop talking for a moment.');assert.equal(messages.length,2);assert.equal(closed,2);session.close();
});

test('queued conversational decisions preserve order, and pause invalidates a pending semantic decision',async()=>{
  let release!:()=>void,entered!:()=>void;const waiting=new Promise<void>(r=>{entered=r;}),pending=new Promise<void>(r=>{release=r;});
  const messages:string[]=[];let first=true;
  const session=new VoiceSession(config,{authorized:async()=>true,intake:async()=>{},tool:async()=>({}),route:async input=>{
    if(first){first=false;entered();await pending;}return {action:'reply',request:input.utterance};
  }},{audio:()=>{},stop:()=>{},finish:()=>{},status:()=>{}},()=>({start:async()=>{},message:text=>messages.push(text),close:()=>{}}));
  session.join(actor);
  const a=session.transcript(actor.userId,'Find database courses.');await waiting;
  const b=session.transcript(actor.userId,'Actually, use Spring 2027.');release();await Promise.all([a,b]);
  assert.equal(messages.length,2);assert.match(messages[0]!,/Find database/);assert.match(messages[1]!,/Spring 2027/);session.close();
  let resolve!:()=>void,started!:()=>void;const hold=new Promise<void>(r=>{resolve=r;}),ready=new Promise<void>(r=>{started=r;});let calls=0;
  const paused=new VoiceSession(config,{authorized:async()=>true,intake:async()=>{},tool:async()=>({}),route:async()=>{started();await hold;return {action:'reply',request:'stale'};}},
    {audio:()=>{},stop:()=>{},finish:()=>{},status:()=>{}},()=>({start:async()=>{calls++;},message:()=>{},close:()=>{}}));
  paused.join(actor);const stale=paused.transcript(actor.userId,'Can you find courses?');await ready;paused.pause();paused.resume();resolve();await stale;assert.equal(calls,0);paused.close();
});

test('a routing outage keeps ordinary speech as context and preserves the optional direct-address fallback',async()=>{
  let calls=0;const contexts:string[]=[];
  const session=new VoiceSession(config,{authorized:async()=>true,intake:async()=>{},tool:async()=>({}),route:async()=>{throw new Error('Synthetic timeout');}},
    {audio:()=>{},stop:()=>{},finish:()=>{},status:()=>{}},()=>({start:async text=>{contexts.push(text);calls++;},message:()=>{},close:()=>{}}));
  session.join(actor);await session.transcript(actor.userId,'I need Spring 2027.');assert.equal(calls,0);
  await session.transcript(actor.userId,'Ray, find database courses.');assert.equal(calls,1);assert.match(contexts[0]!,/Spring 2027/);session.close();
});


test('semantic routing uses the configured model with attributed bounded context and a constrained decision',async()=>{
  const c=parseConfig({OPENROUTER_API_KEY:'synthetic'});
  const route=voiceRouter(c,async(_input,init)=>{
    const body=JSON.parse(String(init?.body)),input=JSON.parse(body.messages.at(-1).content);
    assert.equal(body.model,c.OPENROUTER_MODEL);assert.equal(input.speaker.userId,'alice');assert.equal(input.conversation[0].userId,'bob');
    assert.match(JSON.stringify(body.messages[0].content),/No wake word is required/);
    return Response.json({id:'test',provider:'Relace',model:c.OPENROUTER_MODEL,object:'chat.completion',created:1,
      choices:[{index:0,message:{role:'assistant',content:JSON.stringify({action:'reply',request:'Find database courses in Spring 2027.'})},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:10,total_tokens:20}});
  });
  const result=await route({speaker:actor,utterance:'Can you find database courses?',participants:[actor,other],rayBusy:false,
    conversation:[{userId:'bob',role:'human',text:'Bob: We chose Spring 2027.'}]},new AbortController().signal);
  assert.deepEqual(result,{action:'reply',request:'Find database courses in Spring 2027.'});
});
