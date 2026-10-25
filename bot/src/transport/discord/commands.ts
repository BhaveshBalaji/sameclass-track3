import { REST, Routes, SlashCommandBuilder } from 'discord.js';
import { ConfigurationError, type Config } from '../../config/index.js';

export const commandDefinitions = [
  new SlashCommandBuilder().setName('ping').setDescription('Check whether Ray is connected.'),
  new SlashCommandBuilder().setName('ask').setDescription('Ask Ray about courses, syllabi or professors (processed by OpenRouter).')
    .addStringOption(o => o.setName('question').setDescription('Your course/syllabus question').setRequired(true).setMaxLength(1000)),
  new SlashCommandBuilder().setName('plan').setDescription('Manage a shared class-planning session.')
    .addSubcommand(c => c.setName('start').setDescription('Create a planning workspace in this channel.')
      .addStringOption(o => o.setName('semester').setDescription('Semester, e.g. Spring 2027').setRequired(true).setAutocomplete(true).setMaxLength(40)))
    .addSubcommand(c => c.setName('recommend').setDescription('Find shared options using the joined students’ profiles.'))
    .addSubcommand(c => c.setName('status').setDescription('Show current participants and saved preferences.'))
    .addSubcommand(c => c.setName('profile').setDescription('Show your stored planning preferences.'))
    .addSubcommand(c => c.setName('reset-profile').setDescription('Remove your stored profile and source messages.'))
    .addSubcommand(c => c.setName('reset-session').setDescription('Request session reset (creator/moderator only).')),
].map(command => command.toJSON());

export function discordSettings(config: Config) {
  const snowflake = /^\d{17,20}$/;
  const channels = config.DISCORD_PLANNING_CHANNEL_IDS.split(',').map(v => v.trim()).filter(Boolean);
  if (!config.DISCORD_BOT_TOKEN || !snowflake.test(config.DISCORD_APPLICATION_ID) || !snowflake.test(config.DISCORD_GUILD_ID)
      || !channels.length || channels.some(id => !snowflake.test(id))) {
    throw new ConfigurationError('Set DISCORD_BOT_TOKEN, DISCORD_APPLICATION_ID, DISCORD_GUILD_ID and comma-separated DISCORD_PLANNING_CHANNEL_IDS.');
  }
  return { channels: new Set(channels), guildId: config.DISCORD_GUILD_ID };
}
export async function registerCommands(config: Config): Promise<void> {
  discordSettings(config);
  const rest = new REST({ version: '10' }).setToken(config.DISCORD_BOT_TOKEN);
  // POST upserts just Ray's named commands; it does not erase unrelated guild commands.
  for (const definition of commandDefinitions) {
    await rest.post(Routes.applicationGuildCommands(config.DISCORD_APPLICATION_ID,config.DISCORD_GUILD_ID), { body: definition });
  }
}
