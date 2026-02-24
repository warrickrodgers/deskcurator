import {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Message,
  ButtonInteraction,
  MessageComponentInteraction,
  Colors,
  TextChannel,
  NewsChannel,
  ThreadChannel,
  ThreadAutoArchiveDuration,
} from 'discord.js';
import config from '../config/env';
import logger from '../utils/logger';
import { ApprovalRequest } from '../types';

type ResearchCommandHandler = (productQuery: string) => Promise<void>;
type WriteCommandHandler = (title: string) => Promise<void>;
type StatusCommandHandler = () => Promise<void>;
type CancelCommandHandler = (jobId: string) => Promise<void>;

type SendableChannel = TextChannel | NewsChannel | ThreadChannel;

function isSendable(channel: unknown): channel is SendableChannel {
  return (
    channel instanceof TextChannel ||
    channel instanceof NewsChannel ||
    channel instanceof ThreadChannel
  );
}

export class DiscordService {
  private client: Client;
  private isReady: boolean = false;
  private pendingApprovals: Map<string, ApprovalRequest> = new Map();
  private researchHandler: ResearchCommandHandler | null = null;
  private writeHandler: WriteCommandHandler | null = null;
  private statusHandler: StatusCommandHandler | null = null;
  private cancelHandler: CancelCommandHandler | null = null;

  constructor() {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
      ],
    });

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.client.once('ready', () => {
      logger.info(`✅ Discord bot logged in as ${this.client.user?.tag}`);
      this.isReady = true;
    });

    this.client.on('messageCreate', async (message) => {
      if (message.author.id !== config.discord.adminUserId || message.author.bot) return;

      const channelId = message.channelId;
      const content = message.content.trim();

      // ── Researcher channel: !research ────────────────────────────────────
      if (channelId === config.discord.researcherChannelId) {
        if (!content.startsWith('!research ')) return;

        const productQuery = content.slice('!research '.length).trim();
        if (!productQuery) {
          await message.reply('Usage: `!research <product name>`');
          return;
        }
        if (!this.researchHandler) {
          await message.reply('Research agent not initialized yet.');
          return;
        }
        await message.reply(`Starting research for: **${productQuery}**...`);
        this.researchHandler(productQuery).catch(async (err) => {
          logger.error('Research command failed:', err);
          await message.reply(`Research failed: ${err.message}`).catch(() => {});
        });
        return;
      }

      // ── Writer channel: !write / !status / !cancel ────────────────────────
      if (channelId === config.discord.writerChannelId) {
        if (content.startsWith('!write ')) {
          const titleRaw = content.slice('!write '.length).trim();
          const title =
            titleRaw.startsWith('"') && titleRaw.endsWith('"')
              ? titleRaw.slice(1, -1)
              : titleRaw;
          if (!title) {
            await message.reply('Usage: `!write "Article Title Here"`');
            return;
          }
          if (!this.writeHandler) {
            await message.reply('ContentWriter agent not initialized yet.');
            return;
          }
          await message.reply(`📝 Starting article: **"${title}"**...`);
          this.writeHandler(title).catch(async (err) => {
            logger.error('Write command failed:', err);
            await message.reply(`Write failed: ${err.message}`).catch(() => {});
          });
          return;
        }

        if (content === '!status') {
          if (!this.statusHandler) {
            await message.reply('Status handler not initialized yet.');
            return;
          }
          this.statusHandler().catch(async (err) => {
            logger.error('Status command failed:', err);
            await message.reply(`Status failed: ${err.message}`).catch(() => {});
          });
          return;
        }

        if (content.startsWith('!cancel ')) {
          const jobId = content.slice('!cancel '.length).trim();
          if (!jobId) {
            await message.reply('Usage: `!cancel <jobId>`');
            return;
          }
          if (!this.cancelHandler) {
            await message.reply('Cancel handler not initialized yet.');
            return;
          }
          await message.reply(`Cancelling job \`${jobId}\`...`);
          this.cancelHandler(jobId).catch(async (err) => {
            logger.error('Cancel command failed:', err);
            await message.reply(`Cancel failed: ${err.message}`).catch(() => {});
          });
          return;
        }
      }
    });

    this.client.on('error', (error) => {
      logger.error('Discord client error:', error);
    });
  }

  async connect(): Promise<void> {
    try {
      await this.client.login(config.discord.token);
      logger.info('🔌 Connecting to Discord...');
    } catch (error) {
      logger.error('Failed to connect to Discord:', error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    await this.client.destroy();
    this.isReady = false;
    logger.info('👋 Disconnected from Discord');
  }

  /**
   * Send a plain text notification to a channel or thread.
   * Defaults to the researcher channel if no channelId is provided.
   */
  async sendNotification(message: string, channelId?: string): Promise<void> {
    if (!this.isReady) {
      logger.warn('Discord bot not ready, cannot send notification');
      return;
    }

    const targetId = channelId ?? config.discord.researcherChannelId;
    try {
      const channel = await this.client.channels.fetch(targetId);
      if (isSendable(channel)) {
        await channel.send(message);
      } else {
        logger.warn(`Channel ${targetId} not found or not a sendable channel`);
      }
    } catch (error) {
      logger.error('Failed to send notification:', error);
    }
  }

  /**
   * Create a public thread in the writer channel for an article.
   * Returns the new thread's ID.
   */
  async createArticleThread(title: string): Promise<string> {
    if (!this.isReady) throw new Error('Discord bot not ready');

    const channel = await this.client.channels.fetch(config.discord.writerChannelId);
    if (!(channel instanceof TextChannel || channel instanceof NewsChannel)) {
      throw new Error('Writer channel must be a text or news channel to create threads');
    }

    const thread = await channel.threads.create({
      name: title.slice(0, 100),
      autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
    });

    logger.info(`Created article thread "${thread.name}" (${thread.id})`);
    return thread.id;
  }

  /**
   * Request approval from admin with interactive buttons.
   * Posts in the given channelId (defaults to researcher channel).
   */
  async requestApproval(
    approvalRequest: ApprovalRequest,
    channelId?: string
  ): Promise<{ approved: boolean; feedback?: string }> {
    if (!this.isReady) throw new Error('Discord bot not ready');

    const targetId = channelId ?? config.discord.researcherChannelId;

    return new Promise(async (resolve, reject) => {
      try {
        const channel = await this.client.channels.fetch(targetId);

        if (!isSendable(channel)) {
          reject(new Error(`Channel ${targetId} not found or not a supported text channel`));
          return;
        }

        const embed = this.createApprovalEmbed(approvalRequest);

        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(`approve_${approvalRequest.id}`)
            .setLabel('✅ Approve')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(`reject_${approvalRequest.id}`)
            .setLabel('❌ Reject')
            .setStyle(ButtonStyle.Danger),
          new ButtonBuilder()
            .setCustomId(`edit_${approvalRequest.id}`)
            .setLabel('✏️ Request Edit')
            .setStyle(ButtonStyle.Primary)
        );

        const message = await channel.send({
          content: `<@${config.discord.adminUserId}> 🔔 Approval needed!`,
          embeds: [embed],
          components: [row],
        });

        this.pendingApprovals.set(approvalRequest.id, approvalRequest);

        const timeout = setTimeout(() => {
          this.pendingApprovals.delete(approvalRequest.id);
          reject(new Error('Approval request timed out after 24 hours'));
        }, 24 * 60 * 60 * 1000);

        const filter = (i: MessageComponentInteraction) =>
          i.customId.endsWith(approvalRequest.id) &&
          i.user.id === config.discord.adminUserId;

        const collector = message.createMessageComponentCollector({
          filter,
          time: 24 * 60 * 60 * 1000,
        });

        collector.on('collect', async (interaction: MessageComponentInteraction) => {
          // Unused but kept for type narrowing
          void (interaction as ButtonInteraction);
          clearTimeout(timeout);
          collector.stop();

          const action = interaction.customId.split('_')[0];

          if (action === 'approve') {
            await interaction.update({
              embeds: [this.updateEmbedStatus(embed, 'approved')],
              components: [],
            });
            this.pendingApprovals.delete(approvalRequest.id);
            resolve({ approved: true });
          } else if (action === 'reject') {
            await interaction.update({
              embeds: [this.updateEmbedStatus(embed, 'rejected')],
              components: [],
            });
            this.pendingApprovals.delete(approvalRequest.id);
            resolve({ approved: false });
          } else if (action === 'edit') {
            await interaction.reply({
              content: 'Please reply to this message with your feedback:',
              ephemeral: true,
            });

            if (!isSendable(channel)) {
              this.pendingApprovals.delete(approvalRequest.id);
              resolve({ approved: false, feedback: 'Channel type not supported for feedback' });
              return;
            }

            const msgCollector = channel.createMessageCollector({
              filter: (m: Message) => m.author.id === config.discord.adminUserId,
              max: 1,
              time: 5 * 60 * 1000,
            });

            msgCollector.on('collect', async (msg: Message) => {
              await interaction.editReply({ content: '✅ Feedback received!' });
              await message.edit({
                embeds: [this.updateEmbedStatus(embed, 'needs-edit')],
                components: [],
              });
              this.pendingApprovals.delete(approvalRequest.id);
              resolve({ approved: false, feedback: msg.content });
            });
          }
        });
      } catch (error) {
        logger.error('Failed to request approval:', error);
        reject(error);
      }
    });
  }

  private createApprovalEmbed(request: ApprovalRequest): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setColor(Colors.Orange)
      .setTitle(`🤖 ${request.type.toUpperCase()} Approval Request`)
      .setTimestamp(request.requestedAt);

    if (typeof request.data === 'string') {
      embed.setDescription(request.data.substring(0, 4000));
    } else {
      embed.addFields(
        { name: '📦 Product', value: request.data.product.name, inline: true },
        { name: '🏷️ Category', value: request.data.product.category, inline: true },
        { name: '📊 Confidence', value: `${(request.data.confidence * 100).toFixed(0)}%`, inline: true },
        { name: '📝 Summary', value: request.data.summary.substring(0, 1000) }
      );

      if (request.data.pros.length > 0) {
        embed.addFields({ name: '✅ Pros', value: request.data.pros.slice(0, 3).join('\n') });
      }

      if (request.data.cons.length > 0) {
        embed.addFields({ name: '❌ Cons', value: request.data.cons.slice(0, 3).join('\n') });
      }
    }

    return embed;
  }

  private updateEmbedStatus(
    embed: EmbedBuilder,
    status: 'approved' | 'rejected' | 'needs-edit'
  ): EmbedBuilder {
    const statusEmoji = { approved: '✅', rejected: '❌', 'needs-edit': '✏️' };
    const statusColor = {
      approved: Colors.Green,
      rejected: Colors.Red,
      'needs-edit': Colors.Yellow,
    };

    return EmbedBuilder.from(embed)
      .setColor(statusColor[status])
      .setFooter({ text: `${statusEmoji[status]} ${status.toUpperCase()}` });
  }

  registerResearchHandler(handler: ResearchCommandHandler): void {
    this.researchHandler = handler;
    logger.info('Research command handler registered (!research <product>)');
  }

  registerWriteHandler(handler: WriteCommandHandler): void {
    this.writeHandler = handler;
    logger.info('Write command handler registered (!write "<title>")');
  }

  registerStatusHandler(handler: StatusCommandHandler): void {
    this.statusHandler = handler;
    logger.info('Status command handler registered (!status)');
  }

  registerCancelHandler(handler: CancelCommandHandler): void {
    this.cancelHandler = handler;
    logger.info('Cancel command handler registered (!cancel <jobId>)');
  }

  getClient(): Client {
    return this.client;
  }

  isConnected(): boolean {
    return this.isReady;
  }
}

export default new DiscordService();
