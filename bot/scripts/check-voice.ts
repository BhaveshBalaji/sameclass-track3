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
  // OPT-IN PAID: one synthetic generated conversation/tool round trip; no Discord posts.
  let bytes=0,toolCalls=0,toolReturned=false,postToolAudioBytes=0;const chunks:Buffer[]=[];
  await new Promise<void>((resolve,reject)=>{
    const timer=setTimeout(()=>{agent.close();reject(new Error('Voice provider proof timed out.'));},30000);
    const agent=new ElevenAgent(config,{
      audio:(pcm,rate)=>{if(rate!==16000)throw new Error('Probe needs PCM 16 kHz.');bytes+=pcm.length;if(toolReturned)postToolAudioBytes+=pcm.length;chunks.push(pcm);},text:()=>{},
      tool:async call=>{
        if(call.tool_name!=='get_my_notes')throw new Error('Unexpected probe tool.');
        toolCalls++;
        if(process.argv.includes('--slow-tool'))await new Promise(resolve=>setTimeout(resolve,3000));
        toolReturned=true;
        return {name:'Synthetic Probe',facts:[],instruction:'This is a synthetic integration check. Say briefly that no preferences are saved.'};
      },
      complete:reason=>{
        clearTimeout(timer);agent.close();
        console.log(JSON.stringify({check:'voice_agent_observation',completion:reason,toolCalls,audioBytes:bytes}));
        if(!bytes||!toolCalls||(process.argv.includes('--slow-tool')&&!postToolAudioBytes))reject(new Error('Voice proof needs generated audio after the tool result.'));
        else{console.log(JSON.stringify({check:'voice_agent_protocol',synthetic:true,toolCalls,audioBytes:bytes,postToolAudioBytes,discordAudioVerified:false,scribeVerified:false}));resolve();}
      },
      failed:()=>{clearTimeout(timer);reject(new Error('Voice provider proof failed.'));},
    });
    void agent.start('Synthetic integration check. The current speaker is Synthetic Probe. No real student data.').then(()=>{
      agent.message('Hey Ray, please use your notes tool to read back my saved preferences.');
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
