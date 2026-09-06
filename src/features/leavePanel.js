const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  EmbedBuilder,
} = require('discord.js');
const storage = require('../storage');
const time = require('../time');
const bindings = require('./bindings');
const leaveManager = require('./leaveManager');
const attendanceTracker = require('./attendanceTracker');
const sheets = require('../sheets');
const { LEAVE_CHANNEL_ID, LEAVE_DAYS, LEAVE_RULES, SHEET_TABS } = require('../config');

const OPEN_BUTTON_ID = 'leave:open';
const SELECT_MENU_ID = 'leave:pick';
const CANCEL_BUTTON_ID = 'leave:cancel:open';
const CANCEL_SELECT_ID = 'leave:cancel:pick';

const LEAVE_LOG_HEADER = ['ตัวละคร', 'ลาวันวอร์วันที่', 'แจ้งเมื่อ'];
const WARNING_LOG_HEADER = ['Discord', 'ตัวละคร', 'เหตุ', 'ได้รับใบ'];

const WEEKDAY_NAME = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];

function warDateLabel({ dateKey, weekday }) {
  return `${WEEKDAY_NAME[weekday]} ${time.formatThaiDate(dateKey)}`;
}

function buildEmbed() {
  return new EmbedBuilder()
    .setTitle('แจ้งลากิจ')
    .setDescription(
      'กดปุ่มด้านล่างเพื่อแจ้งลากิจ (ต้องผูกชื่อเกมด้วย /ผูก ก่อน)\nลาก่อน 15:00 ไม่มีผล ลาหลัง 15:00 จะโดนใบเตือน\nหากเลยกำหนดจะโดนใบแดง'
    )
    .setColor(0x5865f2);
}

function buildButtonRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(OPEN_BUTTON_ID).setLabel('แจ้งลากิจ').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(CANCEL_BUTTON_ID).setLabel('ยกเลิกลา').setStyle(ButtonStyle.Danger)
  );
}

async function ensurePanel(client) {
  if (!LEAVE_CHANNEL_ID) return console.error('[leavePanel] ยังไม่ได้ตั้งค่า LEAVE_CHANNEL_ID');
  const channel = await client.channels.fetch(LEAVE_CHANNEL_ID).catch(() => null);
  if (!channel) return console.error(`[leavePanel] ไม่พบห้อง ${LEAVE_CHANNEL_ID}`);

  const saved = storage.load('leavePanel', {});
  if (saved.messageId) {
    const existing = await channel.messages.fetch(saved.messageId).catch(() => null);
    if (existing) {
      await existing.edit({ embeds: [buildEmbed()], components: [buildButtonRow()] });
      return;
    }
  }

  const msg = await channel.send({ embeds: [buildEmbed()], components: [buildButtonRow()] });
  storage.save('leavePanel', { messageId: msg.id, channelId: channel.id });
}

// ลบข้อความปุ่มเดิมแล้วโพสต์ใหม่ท้ายห้อง เรียกหลังมีข้อความประกาศใหม่ กันปุ่มจมหาย
async function repost(channel) {
  const saved = storage.load('leavePanel', {});
  if (saved.messageId) {
    const old = await channel.messages.fetch(saved.messageId).catch(() => null);
    if (old) await old.delete().catch(() => {});
  }
  const msg = await channel.send({ embeds: [buildEmbed()], components: [buildButtonRow()] });
  storage.save('leavePanel', { messageId: msg.id, channelId: channel.id });
}

async function handleOpenButton(interaction) {
  const boundName = bindings.getNameByUserId(interaction.user.id);
  if (!boundName) {
    await interaction.reply({ content: 'บัญชีนี้ยังไม่ได้ผูกชื่อเกม ใช้คำสั่ง /ผูก ก่อนครับ', ephemeral: true });
    return;
  }

  const choices = LEAVE_DAYS.map((wd) => time.nextOccurrenceOf(wd));
  const menu = new StringSelectMenuBuilder()
    .setCustomId(SELECT_MENU_ID)
    .setPlaceholder('เลือกวันวอร์ที่จะลา')
    .addOptions(choices.map((c) => ({ label: warDateLabel(c), value: c.dateKey })));

  await interaction.reply({
    content: `ผูกชื่อ **${boundName}** — เลือกวันวอร์ที่จะลา`,
    components: [new ActionRowBuilder().addComponents(menu)],
    ephemeral: true,
  });
}

async function handleCancelOpenButton(interaction) {
  const userId = interaction.user.id;
  const boundName = bindings.getNameByUserId(userId);
  if (!boundName) {
    await interaction.reply({ content: 'บัญชีนี้ยังไม่ได้ผูกชื่อเกม ใช้คำสั่ง /ผูก ก่อนครับ', ephemeral: true });
    return;
  }

  const cancellable = leaveManager.getCancellableLeaves(userId);
  if (cancellable.length === 0) {
    await interaction.reply({ content: 'ไม่มีใบลาที่ยกเลิกได้ครับ (ต้องเป็นวันที่ยังไม่ถึงเท่านั้น)', ephemeral: true });
    return;
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId(CANCEL_SELECT_ID)
    .setPlaceholder('เลือกวันที่จะยกเลิกลา')
    .addOptions(
      cancellable.map((c) => ({
        label: time.formatThaiDate(c.warDate),
        value: `${c.monthKey}|${c.index}`,
      }))
    );

  await interaction.reply({
    content: `ผูกชื่อ **${boundName}** — เลือกใบลาที่จะยกเลิก`,
    components: [new ActionRowBuilder().addComponents(menu)],
    ephemeral: true,
  });
}

async function logWarning(discordTag, gameName, reason, cardType) {
  try {
    await sheets.appendRow(SHEET_TABS.WARNING_LOG, WARNING_LOG_HEADER, [discordTag, gameName, reason, cardType]);
  } catch (err) {
    console.error('[leavePanel] เขียนชีตใบเตือนล้มเหลว:', err.message);
  }
}

async function handlePickDate(interaction) {
  const userId = interaction.user.id;
  const boundName = bindings.getNameByUserId(userId);
  if (!boundName) {
    await interaction.update({ content: 'บัญชีนี้ยังไม่ได้ผูกชื่อเกม ใช้คำสั่ง /ผูก ก่อนครับ', components: [] });
    return;
  }

  const warDateKey = interaction.values[0];

  if (!leaveManager.canRequestLeave(userId, warDateKey)) {
    await interaction.update({
      content: `โควตาลาของเดือน ${leaveManager.monthKeyOf(warDateKey)} ครบ ${LEAVE_RULES.MAX_LEAVES_PER_MONTH} ครั้งแล้ว ไม่สามารถลาเพิ่มได้ กรุณาติดต่อแอดมิน`,
      components: [],
    });
    return;
  }

  const now = new Date();
  const result = leaveManager.recordLeave(userId, warDateKey, now);
  const warDateDisplay = time.formatThaiDate(warDateKey);

  await interaction.update({ content: `บันทึกการลาวันวอร์ ${warDateDisplay} เรียบร้อยครับ`, components: [] });

  const statusLines = [
    `<@${userId}> **${boundName}** ขอลาวันวอร์ **${warDateDisplay}**`,
    `เดือนนี้ลาไปแล้ว ${result.count}/${LEAVE_RULES.MAX_LEAVES_PER_MONTH} ครั้ง (เหลือ ${result.remaining} ครั้ง)`,
    result.late ? 'แจ้งหลัง 15:00 ของวันวอร์นั้น ⚠️' : 'แจ้งก่อน 15:00 ของวันวอร์นั้น ✅',
  ];
  if (result.newWarning) statusLines.push(`ได้รับใบเตือน (สะสม ${result.warnings}/${LEAVE_RULES.WARNINGS_TO_RED_CARD} ใบ)`);
  if (result.newlyRedCarded) statusLines.push('🔴 ได้รับใบแดง');

  await interaction.channel.send(statusLines.join('\n'));

  const discordTag = interaction.user.tag;
  try {
    await sheets.appendRow(SHEET_TABS.LEAVE_LOG, LEAVE_LOG_HEADER, [boundName, warDateDisplay, time.dateTimeLabel(now)]);
  } catch (err) {
    console.error('[leavePanel] เขียนชีตแจ้งลาล้มเหลว:', err.message);
  }
  if (result.newWarning) {
    await logWarning(discordTag, boundName, 'แจ้งลาหลัง 15:00 ของวันวอร์ที่เลือก', 'ใบเตือน');
  }
  if (result.newlyRedCarded) {
    const reason = result.overQuota ? `ลาเกินโควตา ${LEAVE_RULES.MAX_LEAVES_PER_MONTH} ครั้ง/เดือน` : 'ใบเตือนสะสมครบ 2 ใบ';
    await logWarning(discordTag, boundName, reason, 'ใบแดง');
  }

  await attendanceTracker.upsertSummaryRow(userId, result.monthKey, interaction.guild);
}

async function handlePickCancel(interaction) {
  const userId = interaction.user.id;
  const boundName = bindings.getNameByUserId(userId);
  if (!boundName) {
    await interaction.update({ content: 'บัญชีนี้ยังไม่ได้ผูกชื่อเกม ใช้คำสั่ง /ผูก ก่อนครับ', components: [] });
    return;
  }

  const [monthKey, indexStr] = interaction.values[0].split('|');
  const result = leaveManager.cancelLeave(userId, monthKey, Number(indexStr));

  if (!result.ok) {
    await interaction.update({ content: 'ไม่พบใบลานี้แล้ว (อาจถูกยกเลิกไปก่อนหน้านี้)', components: [] });
    return;
  }

  const dateDisplay = time.formatThaiDate(result.canceledDate);
  await interaction.update({ content: `ยกเลิกการลาวันวอร์ ${dateDisplay} เรียบร้อยครับ`, components: [] });

  await interaction.channel.send(`<@${userId}> **${boundName}** ยกเลิกการลาวันวอร์ **${dateDisplay}** แล้ว ❌`);

  try {
    await sheets.appendRow(SHEET_TABS.LEAVE_LOG, LEAVE_LOG_HEADER, [boundName, `ยกเลิก: ${dateDisplay}`, time.dateTimeLabel(new Date())]);
  } catch (err) {
    console.error('[leavePanel] เขียนชีตยกเลิกลาล้มเหลว:', err.message);
  }

  await attendanceTracker.upsertSummaryRow(userId, monthKey, interaction.guild);
}

// เรียกทุกครั้งที่มีข้อความใหม่โผล่ในห้องแจ้งลา ลบปุ่มเดิมแล้วโพสต์ใหม่ท้ายห้องเสมอ กันปุ่มจมหาย
async function handleMessage(message) {
  if (message.channelId !== LEAVE_CHANNEL_ID) return;
  const saved = storage.load('leavePanel', {});
  if (message.id === saved.messageId) return; // ข้อความนี้คือปุ่มที่เพิ่ง repost เอง กันวนลูปไม่รู้จบ
  await repost(message.channel);
}

async function handleButton(interaction) {
  if (interaction.customId === OPEN_BUTTON_ID) {
    await handleOpenButton(interaction);
    return true;
  }
  if (interaction.customId === CANCEL_BUTTON_ID) {
    await handleCancelOpenButton(interaction);
    return true;
  }
  return false;
}

async function handleSelect(interaction) {
  if (interaction.customId === SELECT_MENU_ID) {
    await handlePickDate(interaction);
    return true;
  }
  if (interaction.customId === CANCEL_SELECT_ID) {
    await handlePickCancel(interaction);
    return true;
  }
  return false;
}

module.exports = { ensurePanel, handleButton, handleSelect, handleMessage, LEAVE_LOG_HEADER, WARNING_LOG_HEADER };
