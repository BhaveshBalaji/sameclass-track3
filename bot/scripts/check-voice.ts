import { getCiphers } from 'node:crypto';
import { loadConfig, ConfigurationError, safeFailure } from '../src/config/index.js';
import { ElevenAgent } from '../src/voice/elevenlabs.js';
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
  let bytes=0,toolCalls=0;
  await new Promise<void>((resolve,reject)=>{
    const timer=setTimeout(()=>{agent.close();reject(new Error('Voice provider proof timed out.'));},30000);
    const agent=new ElevenAgent(config,{
      audio:pcm=>{bytes+=pcm.length;},text:()=>{},
      tool:async call=>{
        if(call.tool_name!=='get_my_notes')throw new Error('Unexpected probe tool.');
        toolCalls++;
        return {name:'Synthetic Probe',facts:[],instruction:'This is a synthetic integration check. Say briefly that no preferences are saved.'};
      },
      complete:()=>{
        clearTimeout(timer);agent.close();
        if(!bytes||!toolCalls)reject(new Error('Voice proof needs both generated audio and a tool call.'));
        else{console.log(JSON.stringify({check:'voice_agent_protocol',synthetic:true,toolCalls,audioBytes:bytes,discordAudioVerified:false,scribeVerified:false}));resolve();}
      },
      failed:()=>{clearTimeout(timer);reject(new Error('Voice provider proof failed.'));},
    });
    void agent.start('Synthetic integration check. The current speaker is Synthetic Probe. No real student data.').then(()=>{
      agent.message('Hey Ray, please use your notes tool to read back my saved preferences.');
    }).catch(error=>{clearTimeout(timer);agent.close();reject(error);});
  });
}
main().catch(error=>safeFailure('voice',error));
