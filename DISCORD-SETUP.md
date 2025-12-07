# Discord Integration Setup Guide

This guide will help you set up the Discord bot integration for AudioParty.

## Prerequisites

- A Discord server where you have admin permissions
- Access to Discord Developer Portal

## Step 1: Create a Discord Bot

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **"New Application"**
3. Give it a name (e.g., "AudioParty Bot")
4. Click **"Create"**

## Step 2: Configure Bot Settings

1. In your application, go to the **"Bot"** tab in the left sidebar
2. Click **"Add Bot"** → **"Yes, do it!"**
3. Under the bot's username, click **"Reset Token"** → **"Copy"**
   - Save this token - you'll need it for your `.env` file
   - ⚠️ Keep this token secret! Never commit it to git

## Step 3: Set Bot Permissions

1. Still in the **"Bot"** tab, scroll down to **"Privileged Gateway Intents"**
2. You don't need to enable any intents for this bot (it only sends messages)
3. In the left sidebar, go to **"OAuth2"** → **"URL Generator"**
4. Under **"Scopes"**, select:
   - ✅ `bot`
5. Under **"Bot Permissions"**, select:
   - ✅ `Send Messages`
   - ✅ `Embed Links`
   - ✅ `Read Message History`
6. Copy the generated URL at the bottom

## Step 4: Add Bot to Your Server

1. Open the URL you copied in a browser
2. Select your Discord server from the dropdown
3. Click **"Authorize"**
4. Complete the CAPTCHA
5. The bot should now appear in your server (offline until configured)

## Step 5: Get Channel ID

1. In Discord, go to **User Settings** → **Advanced**
2. Enable **"Developer Mode"**
3. Right-click the channel where you want AudioParty updates
4. Click **"Copy Channel ID"**
5. Save this ID for your `.env` file

## Step 6: Configure Environment Variables

On your Docker01 server, update the `.env` file in the AudioParty directory:

```bash
# Discord Bot Configuration
DISCORD_BOT_TOKEN=your_bot_token_here
DISCORD_CHANNEL_ID=your_channel_id_here
AUDIOPARTY_URL=https://your-domain.com
```

Replace:
- `your_bot_token_here` - The bot token from Step 2
- `your_channel_id_here` - The channel ID from Step 5
- `https://your-domain.com` - Your AudioParty URL 

## Step 7: Deploy

Restart your Docker container to apply the changes:

```bash
docker compose up -d --build
```

## How It Works

Once configured, the Discord bot will:

1. **When a song is detected**: Updates a Discord embed with:
   - Song title and artist
   - Album name
   - Album art thumbnail
   - Current listener count
   - "Join Party" button with room code

2. **When songs change**: Edits the same message (no spam!)

3. **When the party ends**: Updates the message to show "Party Ended"

## Troubleshooting

### Bot shows as offline
- Check that `DISCORD_BOT_TOKEN` is correct
- Check Docker logs: `docker logs audioparty`

### No messages appear
- Verify `DISCORD_CHANNEL_ID` is correct
- Ensure the bot has permissions in that channel
- Check that a song has been detected (ACRCloud must be configured)

### "Join Party" button doesn't work
- Verify `AUDIOPARTY_URL` is set correctly in `.env`
- Make sure the URL is accessible from where users will click it

## Optional: Disable Discord Integration

To disable Discord integration, simply remove or comment out the Discord environment variables in `.env`:

```bash
# DISCORD_BOT_TOKEN=...
# DISCORD_CHANNEL_ID=...
```

The app will continue to work normally without Discord updates.
