import { Client, GatewayIntentBits } from 'discord.js';
import dotenv from 'dotenv';
import { research } from './index.js';
import { getWeeklyReport, resetWeekly } from './performance.js';

dotenv.config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.on('ready', () => {
  console.log('Content Researcher Bot is ready!');
  resetWeekly(); // Check for reset on start
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  if (message.content.startsWith('!research ')) {
    const query = message.content.slice(10).trim();
    if (!query) {
      await message.channel.send('Please provide a query: !research [topic]');
      return;
    }
    try {
      await message.channel.send('Researching... Please wait.');
      const result = await research(query);
      await message.channel.send(result.table);
      await message.channel.send(`\`\`\`json\n${JSON.stringify(result.json, null, 2)}\n\`\`\``);
    } catch (error) {
      console.error(error);
      await message.channel.send('An error occurred while researching. Please try again.');
    }
  } else if (message.content === '!report') {
    const report = getWeeklyReport();
    await message.channel.send(`${report}\n@CEO`);
  }
});

client.login(process.env.DISCORD_BOT_TOKEN);
