import {PassThrough} from 'node:stream';
import {AudioPlayerStatus,createAudioResource,StreamType,type AudioPlayer} from '@discordjs/voice';
import {discordPCM} from './audio.js';

/** A lookup can outlast Discord's missed-frame limit. Never reuse its abandoned stream. */
export class DiscordSpeechPlayback {
  private stream?:PassThrough;
  private held=false;
  constructor(private player:AudioPlayer,private idle:(finished:boolean)=>void=()=>{}){
    player.on(AudioPlayerStatus.Playing,()=>{if(this.held)player.pause(true);});
    player.on(AudioPlayerStatus.Idle,()=>{
      const stream=this.stream;
      this.stream=undefined;
      const finished=Boolean(stream?.writableEnded);
      stream?.destroy();
      this.idle(finished);
    });
  }
  write(pcm:Buffer,rate:number):void{
    if(!this.stream){
      this.stream=new PassThrough();
      this.player.play(createAudioResource(this.stream,{inputType:StreamType.Raw}));
    }
    if(this.stream.writableLength>12_000_000)throw new Error('Voice output buffer limit reached.');
    this.stream.write(discordPCM(pcm,rate));
  }
  pause():void{this.held=true;this.player.pause(true);}
  resume():void{this.held=false;this.player.unpause();}
  finish():boolean{
    if(!this.stream)return false;
    this.stream.end();return true;
  }
  stop():void{
    this.held=false;const stream=this.stream;this.stream=undefined;stream?.destroy();this.player.stop(true);
  }
}
