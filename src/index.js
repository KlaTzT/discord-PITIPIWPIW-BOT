const { Client, GatewayIntentBits, Events } = require('discord.js');
const commands = require('./commands');
const voiceTracker = require('./features/voiceTracker');
const scheduleChecker = require('./features/scheduleChecker');
const leavePanel = require('./features/leavePanel');
const sheetSetup = require('./features/sheetSetup');
const { DISCORD_TOKEN, GUILD_ID } = require('./config');

const commandMap = new Map(commands.map((c) => [c.data.name, c]));

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
  ],
});

client.once(Events.ClientReady, async () => {
  console.log(`ล็อกอินสำเร็จ: ${client.user.tag}`);
  voiceTracker.registerVoiceEvents(client);
  scheduleChecker.setupSchedules(client);
  await leavePanel.ensurePanel(client);
  await sheetSetup.ensureAllTabs();
  console.log('สร้าง/ตรวจสอบแท็บในชีตครบแล้ว');

  const guild = client.guilds.cache.get(GUILD_ID);
  if (guild) {
    await voiceTracker.warmMemberCache(guild);
    console.log(`โหลดรายชื่อสมาชิกล่วงหน้าแล้ว (${guild.members.cache.size} คน)`);
  }
});

async function replyError(interaction, err, label) {
  console.error(`[${label}]`, err);
  const payload = { content: 'เกิดข้อผิดพลาด ลองใหม่อีกครั้ง', ephemeral: true };
  if (interaction.replied || interaction.deferred) {
    await interaction.followUp(payload);
  } else {
    await interaction.reply(payload);
  }
}

client.on(Events.MessageCreate, async (message) => {
  try {
    await leavePanel.handleMessage(message);
  } catch (err) {
    console.error('[leavePanel] repost ล้มเหลว:', err.message);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      const command = commandMap.get(interaction.commandName);
      if (!command) return;
      await command.execute(interaction);
      return;
    }
    if (interaction.isButton()) {
      if (await leavePanel.handleButton(interaction)) return;
    }
    if (interaction.isStringSelectMenu()) {
      if (await leavePanel.handleSelect(interaction)) return;
    }
  } catch (err) {
    await replyError(interaction, err, interaction.commandName || interaction.customId || 'interaction');
  }
});

if (!DISCORD_TOKEN) {
  throw new Error('ต้องตั้งค่า DISCORD_TOKEN ใน .env ก่อน');
}
client.login(DISCORD_TOKEN);
