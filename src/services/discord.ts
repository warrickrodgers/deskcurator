import {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Message,
  Interaction,
  ButtonInteraction,
  MessageComponentInteraction,
  Colors,
  TextChannel,
  NewsChannel,
  ThreadChannel,
} from 'discord.js';
import config from '../config/env';
import logger from '../utils/logger';
import { ApprovalRequest } from '../types';

export class DiscordService {
  private client: Client;
  private isReady: boolean = false;
  private pendingApprovals: Map<string, ApprovalRequest> = new Map();

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

    // Button interactions are handled within requestApproval method
    // No global handler needed

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
   * Send a notification to the designated notification channel
   */
  async sendNotification(message: string): Promise<void> {
    if (!this.isReady) {
      logger.warn('Discord bot not ready, cannot send notification');
      return;
    }

    try {
      const channel = await this.client.channels.fetch(
        config.discord.notificationChannelId
      );

      if (
        channel &&
        (channel instanceof TextChannel ||
          channel instanceof NewsChannel ||
          channel instanceof ThreadChannel)
      ) {
        await channel.send(message);
        logger.info('Notification sent to Discord');
      } else {
        logger.warn('Notification channel not found or not a supported text channel');
      }
    } catch (error) {
      logger.error('Failed to send notification:', error);
    }
  }

  /**
   * Request approval from admin with interactive buttons
   */
  async requestApproval(
    approvalRequest: ApprovalRequest
  ): Promise<{ approved: boolean; feedback?: string }> {
    if (!this.isReady) {
      throw new Error('Discord bot not ready');
    }

    return new Promise(async (resolve, reject) => {
      try {
        const channel = await this.client.channels.fetch(
          config.discord.notificationChannelId
        );

        if (
          !channel ||
          !(channel instanceof TextChannel ||
            channel instanceof NewsChannel ||
            channel instanceof ThreadChannel)
        ) {
          reject(new Error('Notification channel not found or not a supported text channel'));
          return;
        }

        // Create embed based on approval type
        const embed = this.createApprovalEmbed(approvalRequest);

        // Create action buttons
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

        // Ping admin
        const message = await channel.send({
          content: `<@${config.discord.adminUserId}> 🔔 Approval needed!`,
          embeds: [embed],
          components: [row],
        });

        // Store the approval request
        this.pendingApprovals.set(approvalRequest.id, approvalRequest);

        // Set up timeout (24 hours)
        const timeout = setTimeout(() => {
          this.pendingApprovals.delete(approvalRequest.id);
          reject(new Error('Approval request timed out after 24 hours'));
        }, 24 * 60 * 60 * 1000);

        // Wait for button interaction
        const filter = (i: MessageComponentInteraction) =>
          i.customId.endsWith(approvalRequest.id) &&
          i.user.id === config.discord.adminUserId;

        const collector = message.createMessageComponentCollector({
          filter,
          time: 24 * 60 * 60 * 1000,
        });

        collector.on('collect', async (interaction: MessageComponentInteraction) => {
          const buttonInteraction = interaction as ButtonInteraction;
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

            // Type guard to ensure channel supports message collectors
            if (
              !(
                channel instanceof TextChannel ||
                channel instanceof NewsChannel ||
                channel instanceof ThreadChannel
              )
            ) {
              logger.error('Channel does not support message collectors');
              this.pendingApprovals.delete(approvalRequest.id);
              resolve({ approved: false, feedback: 'Channel type not supported for feedback' });
              return;
            }

            const msgFilter = (m: Message) =>
              m.author.id === config.discord.adminUserId;
            const msgCollector = channel.createMessageCollector({
              filter: msgFilter,
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
      // Research findings
      embed
        .addFields(
          {
            name: '📦 Product',
            value: request.data.product.name,
            inline: true,
          },
          {
            name: '🏷️ Category',
            value: request.data.product.category,
            inline: true,
          },
          {
            name: '📊 Confidence',
            value: `${(request.data.confidence * 100).toFixed(0)}%`,
            inline: true,
          },
          {
            name: '📝 Summary',
            value: request.data.summary.substring(0, 1000),
          }
        );

      if (request.data.pros.length > 0) {
        embed.addFields({
          name: '✅ Pros',
          value: request.data.pros.slice(0, 3).join('\n'),
        });
      }

      if (request.data.cons.length > 0) {
        embed.addFields({
          name: '❌ Cons',
          value: request.data.cons.slice(0, 3).join('\n'),
        });
      }
    }

    return embed;
  }

  private updateEmbedStatus(
    embed: EmbedBuilder,
    status: 'approved' | 'rejected' | 'needs-edit'
  ): EmbedBuilder {
    const statusEmoji = {
      approved: '✅',
      rejected: '❌',
      'needs-edit': '✏️',
    };

    const statusColor = {
      approved: Colors.Green,
      rejected: Colors.Red,
      'needs-edit': Colors.Yellow,
    };

    return EmbedBuilder.from(embed)
      .setColor(statusColor[status])
      .setFooter({ text: `${statusEmoji[status]} ${status.toUpperCase()}` });
  }

  getClient(): Client {
    return this.client;
  }

  isConnected(): boolean {
    return this.isReady;
  }
}

export default new DiscordService();
