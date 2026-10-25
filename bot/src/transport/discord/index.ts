import { semesterChoices } from '../../domain/semester.js';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, Client, Events, GatewayIntentBits,
  MessageFlags, PermissionFlagsBits, type Interaction, type Message, type ChatInputCommandInteraction, type ButtonInteraction } from 'discord.js';
import type { Config } from '../../config/index.js';
import { PlanningError, type Outgoing, type Room } from '../../domain/planning.js';
import type { PlanningApplication } from '../../application/planning.js';
import { discordSettings,voiceCommandAllowed } from './commands.js';
import { DiscordVoice } from './voice.js';
import { PlanningVoiceBackend } from '../../application/voice.js';

export function allowedMentions(ids: string[]) {
  return { parse: [] as ('roles' | 'users' | 'everyone')[], users: [...new Set(ids)].filter(id => /^\d{17,20}$/.test(id)), repliedUser: false };
}
export function discordContent(body:Outgoing,part:number,text:string){
  const inline=body.inlineMentions??[],permitted=new Set(allowedMentions(body.mentions).users),users:string[]=[];
  for(const mention of inline){
    if(text.includes(mention.marker)&&permitted.has(mention.userId)){
      text=text.replaceAll(mention.marker,`<@${mention.userId}>`);users.push(mention.userId);
    }
  }
  const heading=part===0?[...permitted].filter(id=>!inline.some(m=>m.userId===id)):[];
  return {content:`${heading.map(id=>`<@${id}>`).join(' ')}${heading.length?'\n':''}${text}`,users:[...new Set([...heading,...users])]};
}
export function components(body: Outgoing) {
  if (!body.buttons?.length) return [];
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(body.buttons.map(button => new ButtonBuilder()
    .setLabel(button.label).setStyle(button.action === 'reset' ? ButtonStyle.Danger : ButtonStyle.Secondary)
    .setCustomId(`ray:${button.action}:${button.sessionId}${button.token ? `:${button.token}` : ''}`)))];
}
export async function connectDiscord(config: Config, app: PlanningApplication): Promise<Client> {
  const settings = discordSettings(config);
  const client = new Client({ intents: [GatewayIntentBits.Guilds,GatewayIntentBits.GuildMessages,GatewayIntentBits.MessageContent,
    ...(config.VOICE_ENABLED?[GatewayIntentBits.GuildVoiceStates]:[])],
    allowedMentions: allowedMentions([]) });
  const permitted = (guild: string | null, channel: string | null) => guild === settings.guildId && Boolean(channel && settings.channels.has(channel));
  async function deliver(room: Room, interaction?:ChatInputCommandInteraction | ButtonInteraction) {
    const channel = await client.channels.fetch(room.channelId);
    if (!channel || channel.type !== ChannelType.GuildText || channel.guildId !== room.guildId) throw new Error('Configured planning channel is not a server text channel.');
    const delivered = await app.store.deliver(room,async (body,part,text) => {
      const {content,users:mentions}=discordContent(body,part,text);
      if (part === 0 && interaction && body.requestId === interaction.id) {
        const message = await interaction.editReply({content,flags:MessageFlags.SuppressEmbeds,allowedMentions:allowedMentions(mentions),components:components(body)});
        return message.id;
      }
      const message = await channel.send({ content, ...(body.replyTo && /^\d{17,20}$/.test(body.replyTo) ? {reply:{messageReference:body.replyTo,failIfNotExists:false}} : {}), flags: MessageFlags.SuppressEmbeds, allowedMentions: allowedMentions(mentions), components: part === 0 ? components(body) : [],
        nonce: createHash('sha256').update(`${body.id}:${part}`).digest('hex').slice(0,24), enforceNonce: true });
      return message.id;
    });
    if (!delivered) throw new Error('Discord delivery could not be confirmed.');
  }
  const voice = new DiscordVoice(config,client,app,(room,sessionId)=>new PlanningVoiceBackend(app,room,sessionId,()=>deliver(room)));
  client.once(Events.ClientReady,()=>{if(config.VOICE_ENABLED)console.log('Voice Ray controls are enabled.');});
  client.on(Events.VoiceStateUpdate,(_before,after)=>{
    if(after.id===client.user?.id&&after.channelId!==config.DISCORD_VOICE_CHANNEL_ID)voice.close();
    else voice.departed(after.id,after.channelId);
  });
  const destroy=client.destroy.bind(client);
  client.destroy=async()=>{voice.close();await destroy();};
  async function onInteraction(interaction: Interaction) {
    if (interaction.isAutocomplete()) {
      await interaction.respond(permitted(interaction.guildId,interaction.channelId)
        ? semesterChoices(interaction.options.getFocused()) : []); return;
    }
    if (!interaction.isChatInputCommand() && !interaction.isButton()) return;
    if(interaction.isChatInputCommand()&&interaction.commandName==='voice'&&!voiceCommandAllowed(config,interaction.channelId)){
      await interaction.reply({content:`Use voice commands in <#${config.DISCORD_VOICE_TEXT_CHANNEL_ID}>.`,flags:MessageFlags.Ephemeral,allowedMentions:allowedMentions([])});return;
    }
    if (!permitted(interaction.guildId,interaction.channelId)) {
      await interaction.reply({ content: 'Use Ray in a configured planning channel.', flags: MessageFlags.Ephemeral, allowedMentions: allowedMentions([]) }); return;
    }
    const room = { guildId: interaction.guildId!, channelId: interaction.channelId! };
    const actor = { userId: interaction.user.id, name: interaction.user.displayName,
      moderator: Boolean(interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels) || interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) };
    // Acknowledge before any DB/model/network wait; all controls use persistent custom IDs.
    await interaction.deferReply();
    try {
      if (interaction.isChatInputCommand()) {
        if(interaction.commandName==='voice'){await voice.command(interaction,actor);return;}
        if (interaction.commandName === 'ping') {
          await interaction.editReply({ content: 'Ray is online.', allowedMentions: allowedMentions([]) }); return;
        }
        if (interaction.commandName === 'ask') {
          await app.ask(room,interaction.id,actor,interaction.options.getString('question',true));
        } else if (interaction.commandName === 'plan') {
          switch (interaction.options.getSubcommand()) {
            case 'start': await app.start(room,interaction.id,actor,interaction.options.getString('semester',true)); break;
            case 'recommend': await app.recommend(room,interaction.id,actor); break;
            case 'status': await app.status(room,interaction.id); break;
            case 'profile': await app.profile(room,interaction.id,actor); break;
            case 'reset-profile': await app.resetProfile(room,interaction.id,actor); voice.clearContext(room); break;
            case 'reset-session': await app.requestReset(room,interaction.id,actor); break;
          }
        } else { await interaction.editReply('This command is not handled by Ray.'); return; }
      } else {
        const [prefix,action,sessionId,token] = interaction.customId.split(':');
        if (prefix !== 'ray' || !sessionId) throw new Error('Unknown planning control.');
        if (action === 'join' || action === 'leave') await app.membership(room,interaction.id,actor,sessionId,action === 'join');
        else if (action === 'reset' && token) await app.confirmReset(room,interaction.id,actor,sessionId,token);
        else throw new Error('Unknown planning control.');
      }
      await voice.reconcile();
      await deliver(room,interaction);
    } catch (error) {
      // Domain messages have no credentials/model payload. Other failures get a generic diagnostic.
      const detail = error instanceof PlanningError ? error.message : 'Could not process this action. Please retry or check /plan status.';
      await interaction.editReply({ content: detail.slice(0,500), allowedMentions: allowedMentions([]) });
    }
  }
  async function onMessage(message: Message) {
    if (!permitted(message.guildId,message.channelId) || message.author.bot || message.webhookId || message.channel.type !== ChannelType.GuildText) return;
    const mentioned = Boolean(client.user && message.mentions.users.has(client.user.id));
    const room = { guildId: message.guildId!, channelId: message.channelId };
    const current = await app.store.read(room);
    const direct = current?.clarifications.some(q => q.state === 'pending' && q.userId === message.author.id && q.messageIds.includes(message.reference?.messageId ?? ''));
    const researchReply=message.reference?.messageId?Boolean(await app.memory.referenced(room,message.reference.messageId)):false;
    if (mentioned || direct || researchReply) {
      await message.channel.sendTyping().catch(() => {});
    }
    await app.message({ ...room, id: message.id, userId: message.author.id, name: message.member?.displayName ?? message.author.displayName,
      content: message.content, botMention: mentioned, replyTo: message.reference?.messageId });
    if (mentioned || direct || researchReply) await deliver(room);
  }
  client.on(Events.InteractionCreate,interaction => { void onInteraction(interaction).catch(() => console.error(JSON.stringify({ event: 'interaction_failed', id: interaction.id }))); });
  client.on(Events.MessageCreate,message => { void onMessage(message).catch(() => console.error(JSON.stringify({ event: 'message_failed', id: message.id }))); });
  client.on(Events.Error,() => console.error(JSON.stringify({ event: 'discord_connection_error' })));
  const readiness = new AbortController();
  const timeout = setTimeout(() => readiness.abort(),30000);
  const ready = once(client,Events.ClientReady,{ signal: readiness.signal });
  // Handle rejection immediately, even if login fails before we await readiness.
  void ready.catch(() => {});
  try {
    await client.login(config.DISCORD_BOT_TOKEN); await ready;
    if (client.application?.id !== config.DISCORD_APPLICATION_ID) throw new Error('Discord token and Application ID refer to different applications.');
    for (const channelId of settings.channels) {
      const channel = await client.channels.fetch(channelId);
      if (!channel || channel.type !== ChannelType.GuildText || channel.guildId !== settings.guildId) throw new Error('Check the configured planning channel and server.');
      await deliver({ guildId: settings.guildId, channelId });
    }
  } catch (error) { client.destroy(); throw error; }
  finally { clearTimeout(timeout); readiness.abort(); }
  return client;
}
