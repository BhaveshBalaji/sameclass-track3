import { PassThrough } from 'node:stream';
import { AudioPlayerStatus, createAudioPlayer, createAudioResource, entersState, EndBehaviorType, joinVoiceChannel,
  NoSubscriberBehavior, StreamType, VoiceConnectionStatus, type VoiceConnection } from '@discordjs/voice';
import { ChannelType, PermissionFlagsBits, type Client, type ChatInputCommandInteraction, type Message } from 'discord.js';
import type { Config } from '../../config/index.js';
import type { PlanningApplication } from '../../application/planning.js';
import { PlanningError, type Actor, type Room } from '../../domain/planning.js';
import { discordPCM, SpeechDecoder, speechEnergy } from '../../voice/audio.js';
import { ScribeUtterance } from '../../voice/elevenlabs.js';
import { VoiceSession, type VoiceBackend } from '../../voice/session.js';

export const voiceNotice = 'Voice Ray sends opted-in audio to ElevenLabs for transcription and conversation. '
  + 'Say “Hey Ray” followed by your question; ordinary group discussion is noted quietly. '
  + 'Saved planning notes may also be processed by OpenRouter. Use /voice join consent:True to opt yourself in, '
  + '/voice leave to stop including yourself. Session owner/moderators can pause or end listening. '
  + 'Ray does not save raw audio locally; provider transcript retention is separate.';

interface LiveVoice {
  room: Room; sessionId: string; ownerId: string; connection: VoiceConnection; session: VoiceSession;
  status?: Message; captures: Map<string, () => void>; timer: ReturnType<typeof setTimeout>;
  stream?: PassThrough; player: ReturnType<typeof createAudioPlayer>;
}

/** One voice room per worker. All controls originate in its linked text channel. */
export class DiscordVoice {
  private live?: LiveVoice;
  private joining = false;
  private diagnostic(phase:string,data:Record<string,unknown>={}):void{
    if(this.config.VOICE_DIAGNOSTICS)console.log(JSON.stringify({event:'voice_diagnostic',phase,...data}));
  }
  constructor(private config: Config, private client: Client, private app: PlanningApplication,
    private backend: (room: Room, sessionId: string) => VoiceBackend) {}

  async command(interaction: ChatInputCommandInteraction, actor: Actor): Promise<void> {
    if (!this.config.VOICE_ENABLED) throw new PlanningError('Voice Ray is not enabled. Text planning is available.');
    const action = interaction.options.getSubcommand();
    const room = {guildId:interaction.guildId!,channelId:interaction.channelId!};
    if (action === 'join') {
      if (interaction.options.getBoolean('consent') !== true) {
        await interaction.editReply(voiceNotice); return;
      }
      const state = await this.app.store.read(room);
      if (!state?.participants[actor.userId]?.active) throw new PlanningError('Start or join planning before opting into voice.');
      const guild = await this.client.guilds.fetch(room.guildId);
      const member = await guild.members.fetch(actor.userId);
      if (member.voice.channelId !== this.config.DISCORD_VOICE_CHANNEL_ID) throw new PlanningError('Join the configured voice channel first.');
      if (this.joining) throw new PlanningError('Ray is joining voice. Try again in a moment.');
      if (this.live && (this.live.room.channelId !== room.channelId || this.live.sessionId !== state.id)) throw new PlanningError('Ray already has a voice session in another planning workspace.');
      if (!this.live) {
        this.joining = true;
        try { await this.start(room,state.id,state.creatorId); } finally { this.joining = false; }
      }
      // Starting a connection may take seconds; do not grant stale consent after reset/leave.
      const latest = await this.app.store.read(room);
      const currentMember = await guild.members.fetch(actor.userId);
      if (latest?.id !== state.id || !latest.participants[actor.userId]?.active || currentMember.voice.channelId !== this.config.DISCORD_VOICE_CHANNEL_ID) {
        if (!this.live?.session.participants.size) this.close();
        throw new PlanningError('Planning or voice membership changed. Join voice again to opt in.');
      }
      try { this.live!.session.join(actor); } catch { throw new PlanningError('This demo supports up to four voice participants.'); }
      await interaction.editReply({content:`You joined Voice Ray. ${voiceNotice}`,allowedMentions:{parse:[]}});
      return;
    }
    const live = this.live;
    if (!live || live.room.channelId !== room.channelId) throw new PlanningError('No voice session is active in this planning channel.');
    if (action === 'leave') {
      live.captures.get(actor.userId)?.(); live.session.leave(actor.userId);
      if (!live.session.participants.size) this.close();
      await interaction.editReply('You left Voice Ray. Your future audio will not be included.'); return;
    }
    if (live.ownerId !== actor.userId && !actor.moderator) throw new PlanningError('Only the session owner or a moderator can pause, resume or end Voice Ray.');
    if (action === 'pause') { this.stopCaptures(); live.session.pause(); }
    if (action === 'resume') live.session.resume();
    if (action === 'end') this.close();
    await interaction.editReply(action === 'end' ? 'Voice Ray ended.' : `Voice Ray ${action === 'pause' ? 'paused' : 'is listening'}.`);
  }

  private async start(room: Room, sessionId: string, ownerId: string): Promise<void> {
    const channel = await this.client.channels.fetch(this.config.DISCORD_VOICE_CHANNEL_ID);
    if (!channel || channel.type !== ChannelType.GuildVoice || channel.guildId !== room.guildId) throw new PlanningError('Configure a regular voice channel in this server.');
    const me = await channel.guild.members.fetchMe();
    if (!channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak])) throw new PlanningError('Ray needs View Channel, Connect and Speak in the voice channel.');
    const connection = joinVoiceChannel({channelId:channel.id,guildId:room.guildId,adapterCreator:channel.guild.voiceAdapterCreator,selfDeaf:false,selfMute:false});
    const player = createAudioPlayer({behaviors:{noSubscriber:NoSubscriberBehavior.Stop}});
    const captures = new Map<string,()=>void>();
    let lastStatus = '';
    const status = (value:string) => {
      if (lastStatus === value) return;
      lastStatus = value;
      void this.live?.status?.edit({content:`Voice Ray: **${value}**\n${voiceNotice}`,allowedMentions:{parse:[]}}).catch(()=>{});
    };
    const stop = () => { const live = this.live; live?.stream?.destroy(); if (live) live.stream=undefined; player.stop(true); };
    const session = new VoiceSession(this.config,this.backend(room,sessionId),{
      stop,status,
      finish:()=>{if(this.live?.stream)this.live.stream.end();else status('listening');},
      audio:(pcm,rate)=>{
        const live=this.live;if(!live)return;
        if(!live.stream){
          live.stream=new PassThrough();
          player.play(createAudioResource(live.stream,{inputType:StreamType.Raw}));
        }
        if(live.stream.writableLength>12_000_000){session.interrupt();status('Voice output was too long. Ask for a shorter answer.');return;}
        live.stream.write(discordPCM(pcm,rate));
      },
    });
    const timer=setTimeout(()=>this.close(),this.config.VOICE_MAX_DURATION_SECONDS*1000);
    this.live={room,sessionId,ownerId,connection,session,player,captures,timer};
    player.on('error',()=>{session.interrupt();status('Audio playback failed. Ask Ray again.');});
    player.on(AudioPlayerStatus.Idle,()=>{
      if(this.live?.stream?.writableEnded){this.live.stream=undefined;status('listening');}
    });
    connection.on('error',()=>this.close());
    connection.on(VoiceConnectionStatus.Disconnected,()=>this.close());
    connection.receiver.speaking.on('start',userId=>{void this.capture(userId).catch(()=>status('Could not hear that turn. Please try again.'));});
    try{
      await entersState(connection,VoiceConnectionStatus.Ready,15000);connection.subscribe(player);
      const text=await this.client.channels.fetch(room.channelId);
      if(!text||text.type!==ChannelType.GuildText)throw new Error('Planning channel unavailable.');
      this.live.status=await text.send({content:`Voice Ray: **listening**\n${voiceNotice}`,allowedMentions:{parse:[]}});
    }catch{this.close();throw new PlanningError('Ray could not connect to voice. Check voice permissions, UDP access and encryption support.');}
  }

  private async capture(userId:string):Promise<void>{
    const live=this.live;
    if(!live?.session.accepts(userId)){this.diagnostic('speaking_not_opted_in_or_paused');return;}
    if(live.captures.has(userId)){this.diagnostic('speaking_during_pending_capture');return;}
    const captureId=Date.now();let packets=0,pcmBytes=0,peakEnergy=0;
    this.diagnostic('capture_started',{captureId});
    // Subscribe immediately to retain the wake phrase while authorization is checked.
    const receive=live.connection.receiver.subscribe(userId,{end:{behavior:EndBehaviorType.AfterSilence,duration:700}});
    const decoder=new SpeechDecoder();let scribe:ScribeUtterance|undefined,pending:Buffer[]=[],bytes=0,voiced=0,ended=false,closed=false;
    const close=()=>{if(closed)return;closed=true;clearTimeout(timeout);receive.destroy();decoder.close();scribe?.close();live.captures.delete(userId);};
    const timeout=setTimeout(()=>{receive.destroy();scribe?.finish();},30000);
    live.captures.set(userId,close);
    receive.on('error',(error)=>{this.diagnostic('receive_error',{captureId,packets,pcmBytes,type:error.name});close();});
    receive.on('data',(packet:Buffer)=>{
      if(closed||!live.session.accepts(userId)){close();return;}
      try{
        const pcm=decoder.decode(packet);
        packets++;pcmBytes+=pcm.length;peakEnergy=Math.max(peakEnergy,Math.round(speechEnergy(pcm)));
        if(speechEnergy(pcm)>300){voiced++;if(voiced===3)live.session.interrupt();}else voiced=0;
        if(scribe)scribe.write(pcm);else{bytes+=pcm.length;if(bytes>160000){close();return;}pending.push(pcm);}
      }catch{this.diagnostic('decode_error',{captureId,packets,pcmBytes});close();}
    });
    receive.on('end',()=>{this.diagnostic('capture_ended',{captureId,packets,pcmBytes,peakEnergy});ended=true;scribe?.finish();});
    const actor=live.session.participants.get(userId);
    if(!actor||!await this.backend(live.room,live.sessionId).authorized(actor)||closed||this.live!==live){close();return;}
    scribe=new ScribeUtterance(this.config.ELEVENLABS_API_KEY,text=>{
      this.diagnostic('transcript_completed',{captureId,characters:text.length,packets,pcmBytes});
      close();if(this.live===live&&live.session.accepts(userId))void live.session.transcript(userId,text).catch(()=>{});
    },()=>{this.diagnostic('transcription_failed',{captureId,packets,pcmBytes});close();if(this.live===live)void live.status?.edit({content:'Voice transcription failed. Please try again or use text.',allowedMentions:{parse:[]}}).catch(()=>{});});
    for(const pcm of pending)scribe.write(pcm);pending=[];
    if(ended)scribe.finish();
  }
  async reconcile():Promise<void>{
    const live=this.live;if(!live)return;
    const state=await this.app.store.read(live.room);
    if(this.live!==live)return;
    if(state?.id!==live.sessionId){this.close();return;}
    for(const userId of live.session.participants.keys())if(!state.participants[userId]?.active){live.captures.get(userId)?.();live.session.leave(userId);}
    if(!live.session.participants.size)this.close();
  }
  departed(userId:string,channelId:string|null):void{
    const live=this.live;if(!live||!live.session.participants.has(userId)||channelId===this.config.DISCORD_VOICE_CHANNEL_ID)return;
    live.captures.get(userId)?.();live.session.leave(userId);
    if(!live.session.participants.size)this.close();
  }
  clearContext():void{this.stopCaptures();this.live?.session.clearContext();}
  private stopCaptures():void{for(const close of [...this.live?.captures.values()??[]])close();}
  close():void{
    const live=this.live;if(!live)return;
    clearTimeout(live.timer);this.stopCaptures();live.session.close();live.connection.destroy();this.live=undefined;
  }
}
