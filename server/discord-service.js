// Discord integration service
const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

class DiscordService {
  constructor() {
    this.client = null;
    this.channelId = process.env.DISCORD_CHANNEL_ID;
    this.baseUrl = process.env.AUDIOPARTY_URL || 'http://localhost:3000';
    this.currentMessageId = null;
    this.isEnabled = false;
  }

  async initialize() {
    const token = process.env.DISCORD_BOT_TOKEN;
    
    if (!token || !this.channelId) {
      console.log('Discord integration disabled - missing bot token or channel ID');
      return;
    }

    try {
      this.client = new Client({
        intents: [GatewayIntentBits.Guilds]
      });

      this.client.once('ready', () => {
        console.log(`Discord bot logged in as ${this.client.user.tag}`);
        this.isEnabled = true;
      });

      this.client.on('error', (error) => {
        console.error('Discord client error:', error);
      });

      await this.client.login(token);
    } catch (error) {
      console.error('Failed to initialize Discord bot:', error);
      this.isEnabled = false;
    }
  }

  async updateNowPlaying(roomCode, songInfo, listenerCount) {
    if (!this.isEnabled) return;

    try {
      const channel = await this.client.channels.fetch(this.channelId);
      
      // Handle artists as either string or array
      const artistText = Array.isArray(songInfo.artists) 
        ? songInfo.artists.join(', ')
        : songInfo.artist || songInfo.artists || 'Unknown Artist';
      
      const embed = new EmbedBuilder()
        .setColor(0x1DB954) // Spotify green
        .setTitle('🎵 AudioParty - Now Playing')
        .setDescription(`**${songInfo.title}**\n${artistText}`)
        .addFields(
          { name: '💿 Album', value: songInfo.album || 'Unknown', inline: true },
          { name: '👥 Listeners', value: listenerCount.toString(), inline: true }
        )
        .setTimestamp()
        .setFooter({ text: `Room Code: ${roomCode}` });

      // Add album art if available
      if (songInfo.albumArt) {
        embed.setThumbnail(songInfo.albumArt);
      }

      const button = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setLabel('Join Party')
            .setStyle(ButtonStyle.Link)
            .setURL(`${this.baseUrl}/${roomCode}`)
            .setEmoji('🎧')
        );

      if (this.currentMessageId) {
        // Edit existing message
        try {
          const message = await channel.messages.fetch(this.currentMessageId);
          await message.edit({ embeds: [embed], components: [button] });
        } catch (error) {
          // Message not found, create new one
          console.log('Previous message not found, creating new one');
          const newMessage = await channel.send({ embeds: [embed], components: [button] });
          this.currentMessageId = newMessage.id;
        }
      } else {
        // Create new message
        const message = await channel.send({ embeds: [embed], components: [button] });
        this.currentMessageId = message.id;
      }
    } catch (error) {
      console.error('Error updating Discord message:', error);
    }
  }

  async partyEnded(roomCode) {
    if (!this.isEnabled || !this.currentMessageId) return;

    try {
      const channel = await this.client.channels.fetch(this.channelId);
      const message = await channel.messages.fetch(this.currentMessageId);

      const embed = new EmbedBuilder()
        .setColor(0xFF0000) // Red
        .setTitle('🎵 AudioParty - Ended')
        .setDescription('The party has ended. Thanks for listening!')
        .setTimestamp()
        .setFooter({ text: `Room Code: ${roomCode}` });

      await message.edit({ embeds: [embed], components: [] });
      this.currentMessageId = null;
    } catch (error) {
      console.error('Error updating party ended message:', error);
    }
  }

  async shutdown() {
    if (this.client) {
      await this.client.destroy();
      console.log('Discord bot shut down');
    }
  }
}

module.exports = new DiscordService();
