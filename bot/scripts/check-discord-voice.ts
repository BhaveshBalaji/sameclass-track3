import {once} from 'node:events';
import {Readable} from 'node:stream';
import {Client,Events,GatewayIntentBits,ChannelType,PermissionFlagsBits} from 'discord.js';
import {AudioPlayerStatus,createAudioPlayer,createAudioResource,entersState,joinVoiceChannel,StreamType,type VoiceConnection,VoiceConnectionStatus} from '@discordjs/voice';
import {loadConfig,ConfigurationError,safeFailure} from '../src/config/index.js';

/** OPT-IN: run with the normal Gateway worker stopped; never receive member audio. */
async function main(){
  if(!process.argv.includes('--connect'))throw new ConfigurationError('Use --connect with the normal Ray worker stopped to run the empty-channel transport proof.');
  const config=loadConfig();
  if(!config.DISCORD_BOT_TOKEN||!config.DISCORD_VOICE_CHANNEL_ID)throw new ConfigurationError('Discord bot and voice-channel configuration are required.');
  const client=new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildVoiceStates]});
  let connection:VoiceConnection|undefined;
  const player=createAudioPlayer();
  let failed=false;
  client.on(Events.Error,()=>{failed=true;});player.on('error',()=>{failed=true;});
  try{
    const ready=once(client,Events.ClientReady,{signal:AbortSignal.timeout(15000)});void ready.catch(()=>{});
    await client.login(config.DISCORD_BOT_TOKEN);await ready;
    const channel=await client.channels.fetch(config.DISCORD_VOICE_CHANNEL_ID);
    if(!channel||channel.type!==ChannelType.GuildVoice||channel.guildId!==config.DISCORD_GUILD_ID)throw new ConfigurationError('Configure a regular voice channel in the selected server.');
    const me=await channel.guild.members.fetchMe();
    if(me.voice.channelId)throw new ConfigurationError('Ray already has a voice connection. Stop the worker before this proof.');
    if(channel.members.size)throw new ConfigurationError('The proof requires an empty voice channel; use the normal opted-in rehearsal when members are present.');
    if(!channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel,PermissionFlagsBits.Connect,PermissionFlagsBits.Speak]))throw new ConfigurationError('Ray needs View Channel, Connect and Speak permissions.');
    connection=joinVoiceChannel({channelId:channel.id,guildId:channel.guildId,adapterCreator:channel.guild.voiceAdapterCreator,selfDeaf:true,selfMute:false});
    connection.on('error',()=>{failed=true;});
    await entersState(connection,VoiceConnectionStatus.Ready,15000);connection.subscribe(player);
    // Half a second of silence verifies the actual encoding/playback path without
    // speaking to anyone. No receiver subscription, transcription or chat posts.
    player.play(createAudioResource(Readable.from([Buffer.alloc(48000*4/2)]),{inputType:StreamType.Raw}));
    await entersState(player,AudioPlayerStatus.Playing,5000);await entersState(player,AudioPlayerStatus.Idle,5000);
    if(failed)throw new Error('Discord voice transport failed.');
    console.log(JSON.stringify({check:'discord_voice_transport',connection:'ready',silentPlayback:'finished',memberAudioCaptured:false,humanListeningVerified:false}));
  }finally{player.stop(true);connection?.destroy();await client.destroy();}
}
main().catch(error=>safeFailure('discord_voice',error));
