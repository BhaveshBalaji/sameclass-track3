import {voiceRouter} from '../src/voice/router.js';
import {ResearchAgent} from '../src/research/agent.js';
import {ResearchSources} from '../src/research/sources.js';
import {ResearchScheduler} from '../src/research/scheduler.js';
import {APIClient} from '../src/integrations/api.js';
import { getCiphers } from 'node:crypto';
import { loadConfig, ConfigurationError, safeFailure } from '../src/config/index.js';
import { ElevenAgent, ScribeUtterance } from '../src/voice/elevenlabs.js';
import { SpeechDecoder } from '../src/voice/audio.js';

async function main(){
  const config=loadConfig();
  const missing=['ELEVENLABS_API_KEY','ELEVENLABS_AGENT_ID','DISCORD_VOICE_CHANNEL_ID'].filter(key=>!config[key as keyof typeof config]);
  const decoder=new SpeechDecoder();decoder.close();
  await import('@snazzah/davey');
  console.log(JSON.stringify({check:'voice_setup',enabled:config.VOICE_ENABLED,opus:true,dave:true,
    aes256gcm:getCiphers().includes('aes-256-gcm'),missing,liveRequested:process.argv.includes('--live')}));
  if(missing.length)throw new ConfigurationError(`Missing voice configuration: ${missing.join(', ')}`);
  if(!process.argv.includes('--live'))return;
  if(process.argv.includes('--routing')){
    const route=voiceRouter(config),speaker={userId:'synthetic:alice',name:'Alice'},friend={userId:'synthetic:bob',name:'Bob'};
    const conversation=[{userId:speaker.userId,role:'human' as const,text:'Alice: We are planning for Spring 2027.'}];
    const cases=[
      {utterance:'Can you find database courses?',expected:'reply',semester:true},
      {utterance:'Bob, do you want lunch?',expected:'listen',semester:false},
      {utterance:'Actually, show me the CSE 412 syllabus instead.',expected:'reply',semester:true},
      {utterance:'Stop talking for a moment.',expected:'stop',semester:false},
    ];
    for(let index=0;index<cases.length;index++){
      const item=cases[index]!;
      const result=await route({speaker,utterance:item.utterance,participants:[speaker,friend],conversation,rayBusy:true},AbortSignal.timeout(10000));
      if(result.action!==item.expected||(item.semester&&!/Spring 2027/i.test(result.request)))throw new Error(`Synthetic voice routing case ${index+1} failed.`);
      console.log(JSON.stringify({check:'voice_routing',synthetic:true,case:index+1,action:result.action,passed:true}));
    }
    return;
  }
  // OPT-IN PAID: one synthetic generated conversation/tool round trip; no Discord posts.
  const research=process.argv.includes('--research');
  let bytes=0,toolCalls=0,toolReturned=false,postToolAudioBytes=0;const chunks:Buffer[]=[];
  await new Promise<void>((resolve,reject)=>{
    const timer=setTimeout(()=>{agent.close();reject(new Error('Voice provider proof timed out.'));},research?60000:30000);
    const agent=new ElevenAgent(config,{
      audio:(pcm,rate)=>{if(rate!==16000)throw new Error('Probe needs PCM 16 kHz.');bytes+=pcm.length;if(toolReturned)postToolAudioBytes+=pcm.length;chunks.push(pcm);},text:()=>{},
      tool:async call=>{
        if(call.tool_name!==(research?'research_course':'get_my_notes'))throw new Error('Unexpected probe tool.');
        toolCalls++;
        if(research){
          const scheduler=new ResearchScheduler();
          const sources=new ResearchSources(new APIClient(config.ASU_API_BASE_URL,config.RESEARCH_WORKER_TIMEOUT_MS),new APIClient(config.RMP_API_BASE_URL,config.RESEARCH_WORKER_TIMEOUT_MS),scheduler);
          const answer=await new ResearchAgent(config,sources,scheduler).answer('Find database-related courses in Spring 2027. Give course codes and titles.');
          toolReturned=true;return {answer,instruction:'Speak a short summary with two or three actual course names. This is a synthetic integration check; nothing is posted to Discord.'};
        }
        if(process.argv.includes('--slow-tool'))await new Promise(resolve=>setTimeout(resolve,3000));
        toolReturned=true;
        return {name:'Synthetic Probe',facts:[],instruction:'This is a synthetic integration check. Say briefly that no preferences are saved.'};
      },
      complete:reason=>{
        clearTimeout(timer);agent.close();
        console.log(JSON.stringify({check:'voice_agent_observation',completion:reason,toolCalls,audioBytes:bytes}));
        if(!bytes||!toolCalls||((research||process.argv.includes('--slow-tool'))&&!postToolAudioBytes))reject(new Error('Voice proof needs generated audio after the tool result.'));
        else{console.log(JSON.stringify({check:'voice_agent_protocol',synthetic:true,toolCalls,audioBytes:bytes,postToolAudioBytes,discordAudioVerified:false,scribeVerified:false}));resolve();}
      },
      failed:()=>{clearTimeout(timer);reject(new Error('Voice provider proof failed.'));},
    });
    void agent.start('Synthetic integration check. The current speaker is Synthetic Probe. No real student data.').then(()=>{
      agent.message(research?'Please find database-related courses for Spring 2027.':'Hey Ray, please use your notes tool to read back my saved preferences.');
    }).catch(error=>{clearTimeout(timer);agent.close();reject(error);});
  });
  if(process.argv.includes('--scribe')){
    await new Promise<void>((resolve,reject)=>{
      let settled=false;
      const scribe=new ScribeUtterance(config.ELEVENLABS_API_KEY,text=>{
        settled=true;
        if(!text.trim()){reject(new Error('Realtime transcription proof returned no speech.'));return;}
        console.log(JSON.stringify({check:'voice_scribe',synthetic:true,transcriptCharacters:text.length,audioBytes:bytes,discordAudioVerified:false}));resolve();
      },()=>{settled=true;reject(new Error('Realtime transcription proof failed.'));});
      // Reuse the generated synthetic answer: no extra speech generation or student audio.
      // Pace it like microphone input, respecting the bounded pre-readiness queue.
      void(async()=>{
        for(const chunk of chunks){
          if(settled)return;
          scribe.write(chunk);
          await new Promise(resolve=>setTimeout(resolve,Math.max(10,chunk.length/32)));
        }
        scribe.finish();
      })().catch(()=>{scribe.close();reject(new Error('Realtime transcription proof failed.'));});
    });
  }
}
main().catch(error=>safeFailure('voice',error));
