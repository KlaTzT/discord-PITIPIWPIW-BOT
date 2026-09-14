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
const { GUILD_ID, LEAVE_CHANNEL_ID, LEAVE_DAYS, LEAVE_RULES, SHEET_TABS } = require('../config');

const OPEN_BUTTON_ID = 'leave:open';
const PICK_BUTTON_PREFIX = 'leave:pickday:';
const CANCEL_BUTTON_ID = 'leave:cancel:open';
const CANCEL_SELECT_ID = 'leave:cancel:pick';
const ADMIN_LEAVE_PREFIX = 'admin:leave:pick:';
const ADMIN_CANCEL_PREFIX = 'admin:cancel:pick:';

const LEAVE_LOG_HEADER = ['ตัวละคร', 'ลาวันวอร์วันที่', 'แจ้งเมื่อ', 'ลาอะไร'];
const WARNING_LOG_HEADER = ['Discord', 'ตัวละคร', 'เหตุ', 'ได้รับใบ'];

const WEEKDAY_NAME = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];

function warDateLabel({ dateKey, weekday }) {
  return `${WEEKDAY_NAME[weekday]} ${time.formatThaiDate(dateKey)}`;
}

async function resolveTag(guild, userId) {
  const cached = guild.members.cache.get(userId);
  if (cached) return cached.user.tag;
  try {
    const member = await guild.members.fetch(userId);
    return member.user.tag;
  } catch {
    return userId;
  }
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

// หาข้อความปุ่มที่หลงเหลืออยู่ทั้งหมดในห้อง (ไม่ใช่แค่ไอดีที่จำไว้) เผื่อมีตัวเก่าตกค้างจากบั๊ก/รีสตาร์ทก่อนหน้า
async function findStrayPanels(channel) {
  const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  if (!recent) return [];
  const botId = channel.client.user.id;
  return [...recent.values()].filter((m) => m.author.id === botId && m.components.length > 0);
}

async function clearStrayPanels(channel) {
  const strays = await findStrayPanels(channel);
  for (const m of strays) {
    await m.delete().catch(() => {});
  }
}

async function ensurePanel(client) {
  if (!LEAVE_CHANNEL_ID) return console.error('[leavePanel] ยังไม่ได้ตั้งค่า LEAVE_CHANNEL_ID');
  const channel = await client.channels.fetch(LEAVE_CHANNEL_ID).catch(() => null);
  if (!channel) return console.error(`[leavePanel] ไม่พบห้อง ${LEAVE_CHANNEL_ID}`);

  await clearStrayPanels(channel);
  const msg = await channel.send({ embeds: [buildEmbed()], components: [buildButtonRow()] });
  storage.save('leavePanel', { messageId: msg.id, channelId: channel.id });
}

// กัน repost() ยิงซ้อนตัวเอง (ข้อความใหม่ที่ส่งเองก็ทำให้ event ยิงกลับมาเรียกซ้ำได้)
let repostInFlight = false;

async function repost(channel) {
  if (repostInFlight) return;
  repostInFlight = true;
  try {
    await clearStrayPanels(channel);
    const msg = await channel.send({ embeds: [buildEmbed()], components: [buildButtonRow()] });
    storage.save('leavePanel', { messageId: msg.id, channelId: channel.id });
  } finally {
    repostInFlight = false;
  }
}

async function handleOpenButton(interaction) {
  const boundName = bindings.getNameByUserId(interaction.user.id);
  if (!boundName) {
    await interaction.reply({ content: 'บัญชีนี้ยังไม่ได้ผูกชื่อเกม ใช้คำสั่ง /ผูก ก่อนครับ', ephemeral: true });
    return;
  }

  const choices = LEAVE_DAYS.map((wd) => time.nextOccurrenceOf(wd));
  const row = new ActionRowBuilder().addComponents(
    choices.map((c) =>
      new ButtonBuilder().setCustomId(`${PICK_BUTTON_PREFIX}${c.dateKey}`).setLabel(warDateLabel(c)).setStyle(ButtonStyle.Primary)
    )
  );

  await interaction.reply({
    content: `ผูกชื่อ **${boundName}** — เลือกวันวอร์ที่จะลา`,
    components: [row],
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
        label: c.label ? `${time.formatThaiDate(c.warDate)} - ${c.label}` : time.formatThaiDate(c.warDate),
        value: `${c.monthKey}|${c.index}`,
      }))
    );

  await interaction.reply({
    content: `ผูกชื่อ **${boundName}** — เลือกใบลาที่จะยกเลิก`,
    components: [new ActionRowBuilder().addComponents(menu)],
    ephemeral: true,
  });
}

async function startAdminLeave(interaction, targetUser) {
  const boundName = bindings.getNameByUserId(targetUser.id);
  if (!boundName) {
    await interaction.reply({ content: `${targetUser.tag} ยังไม่ได้ผูกชื่อเกม ใช้ /ผูก หรือ /add ให้ก่อนครับ`, ephemeral: true });
    return;
  }

  const choices = LEAVE_DAYS.map((wd) => time.nextOccurrenceOf(wd));
  const row = new ActionRowBuilder().addComponents(
    choices.map((c) =>
      new ButtonBuilder()
        .setCustomId(`${ADMIN_LEAVE_PREFIX}${targetUser.id}:${c.dateKey}`)
        .setLabel(warDateLabel(c))
        .setStyle(ButtonStyle.Primary)
    )
  );

  await interaction.reply({
    content: `แจ้งลาแทน **${boundName}** (${targetUser.tag}) — เลือกวันวอร์ที่จะลา`,
    components: [row],
    ephemeral: true,
  });
}

async function startAdminCancel(interaction, targetUser) {
  const boundName = bindings.getNameByUserId(targetUser.id);
  if (!boundName) {
    await interaction.reply({ content: `${targetUser.tag} ยังไม่ได้ผูกชื่อเกม`, ephemeral: true });
    return;
  }

  const cancellable = leaveManager.getCancellableLeaves(targetUser.id);
  if (cancellable.length === 0) {
    await interaction.reply({ content: `${boundName} ไม่มีใบลาที่ยกเลิกได้ครับ (ต้องเป็นวันที่ยังไม่ถึงเท่านั้น)`, ephemeral: true });
    return;
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`${ADMIN_CANCEL_PREFIX}${targetUser.id}`)
    .setPlaceholder('เลือกวันที่จะยกเลิก')
    .addOptions(
      cancellable.map((c) => ({
        label: c.label ? `${time.formatThaiDate(c.warDate)} - ${c.label}` : time.formatThaiDate(c.warDate),
        value: `${c.monthKey}|${c.index}`,
      }))
    );

  await interaction.reply({
    content: `ยกเลิกลาแทน **${boundName}** (${targetUser.tag}) — เลือกวันที่จะยกเลิก`,
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

// opts.guild/opts.announceChannel ไว้ให้ตัวเรียกที่ไม่ได้มาจากห้องกิลด์ (เช่น DM) ส่ง guild จริง + ห้องประกาศมาแทนได้
// opts.weight/label/exemptChecks ไว้สำหรับลาแค่บางรอบ (ไม่ใส่ = ลาเต็มวันแบบเดิมทุกอย่าง)
function cancelOnlyRow() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(CANCEL_BUTTON_ID).setLabel('ยกเลิกลา').setEmoji('↩️').setStyle(ButtonStyle.Secondary)
    ),
  ];
}

async function finalizeLeave(interaction, targetUserId, warDateKey, adminActor, opts = {}) {
  const {
    guild = interaction.guild,
    announceChannel = interaction.channel,
    weight = 1,
    label = '',
    exemptChecks,
    successComponents = [],
  } = opts;
  const boundName = bindings.getNameByUserId(targetUserId);
  if (!boundName) {
    await interaction.update({ content: 'บัญชีนี้ยังไม่ได้ผูกชื่อเกม', components: [] });
    return;
  }

  if (!leaveManager.canRequestLeave(targetUserId, warDateKey)) {
    await interaction.update({
      content: `โควตาลาของเดือน ${leaveManager.monthKeyOf(warDateKey)} ครบ ${LEAVE_RULES.MAX_LEAVES_PER_MONTH} ครั้งแล้ว ไม่สามารถลาเพิ่มได้`,
      components: [],
    });
    return;
  }

  const now = new Date();
  const result = leaveManager.recordLeave(targetUserId, warDateKey, now, { weight, label, exemptChecks });
  const warDateDisplay = time.formatThaiDate(warDateKey);
  const labelSuffix = label ? ` (${label})` : '';

  await interaction.update({
    content: `บันทึกการลาวันวอร์ ${warDateDisplay}${labelSuffix} ${adminActor ? `ให้ ${boundName} ` : ''}เรียบร้อยครับ`,
    components: successComponents,
  });

  const statusLines = [
    `<@${targetUserId}> **${boundName}** ขอลาวันวอร์ **${warDateDisplay}**${labelSuffix}${adminActor ? ` (แจ้งแทนโดย ${adminActor})` : ''}`,
    `เดือนนี้ลาไปแล้ว ${result.count}/${LEAVE_RULES.MAX_LEAVES_PER_MONTH} ครั้ง (เหลือ ${result.remaining} ครั้ง)`,
    result.late ? 'แจ้งหลัง 15:00 ของวันวอร์นั้น ⚠️' : 'แจ้งก่อน 15:00 ของวันวอร์นั้น ✅',
  ];
  if (result.newWarning) statusLines.push(`ได้รับใบเตือน (สะสม ${result.warnings}/${LEAVE_RULES.WARNINGS_TO_RED_CARD} ใบ)`);
  if (result.newlyRedCarded) statusLines.push('🔴 ได้รับใบแดง');

  if (announceChannel) await announceChannel.send(statusLines.join('\n'));

  const discordTag = await resolveTag(guild, targetUserId);
  try {
    await sheets.appendRow(SHEET_TABS.LEAVE_LOG, LEAVE_LOG_HEADER, [boundName, warDateDisplay, time.dateTimeLabel(now), label]);
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

  await attendanceTracker.upsertSummaryRow(targetUserId, result.monthKey, guild);
}

async function finalizeCancelLeave(interaction, targetUserId, monthKey, index, adminActor, opts = {}) {
  const { guild = interaction.guild, announceChannel = interaction.channel, successComponents = [] } = opts;
  const boundName = bindings.getNameByUserId(targetUserId);
  if (!boundName) {
    await interaction.update({ content: 'บัญชีนี้ยังไม่ได้ผูกชื่อเกม', components: [] });
    return;
  }

  const result = leaveManager.cancelLeave(targetUserId, monthKey, index);
  if (!result.ok) {
    await interaction.update({ content: 'ไม่พบใบลานี้แล้ว (อาจถูกยกเลิกไปก่อนหน้านี้)', components: [] });
    return;
  }

  const dateDisplay = time.formatThaiDate(result.canceledDate);
  const labelSuffix = result.canceledLabel ? ` (${result.canceledLabel})` : '';
  await interaction.update({
    content: `ยกเลิกการลาวันวอร์ ${dateDisplay}${labelSuffix} ${adminActor ? `ของ ${boundName} ` : ''}เรียบร้อยครับ`,
    components: successComponents,
  });

  if (announceChannel) {
    await announceChannel.send(
      `<@${targetUserId}> **${boundName}** ยกเลิกการลาวันวอร์ **${dateDisplay}**${labelSuffix} แล้ว ❌${adminActor ? ` (ดำเนินการโดย ${adminActor})` : ''}`
    );
  }

  try {
    await sheets.deleteRowByKeys(SHEET_TABS.LEAVE_LOG, LEAVE_LOG_HEADER, [
      [0, boundName],
      [1, dateDisplay],
      [3, result.canceledLabel || ''],
    ]);
  } catch (err) {
    console.error('[leavePanel] ลบแถวแจ้งลาล้มเหลว:', err.message);
  }

  await attendanceTracker.upsertSummaryRow(targetUserId, monthKey, guild);
}

// ถ้ากดมาจาก DM (ไม่มี interaction.guild) ต้องหา guild จริง + ห้องแจ้งลาจริงมาแทน guild/channel ของ DM เอง
// ใน DM ไม่มี panel หลักให้กดยกเลิกทีหลังได้เหมือนในห้อง เลยฝากปุ่มยกเลิกลาไว้ในข้อความเดิมต่อด้วย
async function resolveAnnounceContext(interaction) {
  if (interaction.guild) return {};
  const guild = interaction.client.guilds.cache.get(GUILD_ID);
  const announceChannel = guild ? await interaction.client.channels.fetch(LEAVE_CHANNEL_ID).catch(() => null) : null;
  return { guild, announceChannel, successComponents: cancelOnlyRow() };
}

async function handlePickCancel(interaction) {
  const [monthKey, indexStr] = interaction.values[0].split('|');
  const opts = await resolveAnnounceContext(interaction);
  await finalizeCancelLeave(interaction, interaction.user.id, monthKey, Number(indexStr), undefined, opts);
}

async function handleMessage(message) {
  if (message.channelId !== LEAVE_CHANNEL_ID) return;
  const saved = storage.load('leavePanel', {});
  if (message.id === saved.messageId) return;
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
  if (interaction.customId.startsWith(PICK_BUTTON_PREFIX)) {
    const dateKey = interaction.customId.slice(PICK_BUTTON_PREFIX.length);
    await finalizeLeave(interaction, interaction.user.id, dateKey);
    return true;
  }
  if (interaction.customId.startsWith(ADMIN_LEAVE_PREFIX)) {
    const [targetUserId, dateKey] = interaction.customId.slice(ADMIN_LEAVE_PREFIX.length).split(':');
    await finalizeLeave(interaction, targetUserId, dateKey, interaction.user.tag);
    return true;
  }
  return false;
}

async function handleSelect(interaction) {
  if (interaction.customId === CANCEL_SELECT_ID) {
    await handlePickCancel(interaction);
    return true;
  }
  if (interaction.customId.startsWith(ADMIN_CANCEL_PREFIX)) {
    const targetUserId = interaction.customId.slice(ADMIN_CANCEL_PREFIX.length);
    const [monthKey, indexStr] = interaction.values[0].split('|');
    await finalizeCancelLeave(interaction, targetUserId, monthKey, Number(indexStr), interaction.user.tag);
    return true;
  }
  return false;
}

module.exports = {
  ensurePanel,
  handleButton,
  handleSelect,
  handleMessage,
  startAdminLeave,
  startAdminCancel,
  finalizeLeave,
  finalizeCancelLeave,
  resolveAnnounceContext,
  cancelOnlyRow,
  CANCEL_BUTTON_ID,
  LEAVE_LOG_HEADER,
  WARNING_LOG_HEADER,
};
