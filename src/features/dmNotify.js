const cron = require('node-cron');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const bindings = require('./bindings');
const leaveManager = require('./leaveManager');
const leavePanel = require('./leavePanel');
const time = require('../time');
const { GUILD_ID, TIMEZONE, ROUND_NOTIFY_ROLE_IDS, ROUND_NOTIFY_TEST_USER_ID, ROUND_NOTIFY_LIVE } = require('../config');

const PREFIX = 'round:';

// ทุกวันเหลือแค่ปุ่มเดียวต่อสถานะ (ไม่แยก "พร้อม" กับ "ลา" อีก) เพราะพร้อมแค่รอบเดียวก็แปลว่าลาอีกรอบอยู่แล้วในตัว
// leaveLabel/exemptChecks ไม่ใส่ = ไม่มีผลอะไรกับโควตา (พร้อมทั้งวัน แค่รับทราบ)
const DAY_CONFIGS = {
  tuesday: {
    weekday: 2,
    title: 'แจ้งเตือนวอร์วันอังคาร',
    buttons: [
      { id: 'both', label: 'พร้อมทั้ง2รอบ', style: 'Primary' },
      { id: 'r1_only', label: 'พร้อมแค่รอบ1 (ลารอบ2ให้)', style: 'Secondary', weight: 0.5, leaveLabel: 'รอบ2', exemptChecks: [] },
      { id: 'r2_only', label: 'พร้อมแค่รอบ2 (ลารอบ1ให้)', style: 'Secondary', weight: 0.5, leaveLabel: 'รอบ1', exemptChecks: [] },
      { id: 'leave_both', label: 'ลาทั้ง2รอบ', style: 'Danger', weight: 1, leaveLabel: 'ทั้ง2รอบ', exemptChecks: ['war'] },
    ],
  },
  thursday: {
    weekday: 4,
    title: 'แจ้งเตือนวอร์วันพฤหัสบดี',
    buttons: [
      { id: 'ready', label: 'พร้อมวอร์1รอบ', style: 'Primary' },
      { id: 'leave', label: 'ลา', style: 'Danger', weight: 1, leaveLabel: '', exemptChecks: ['war'] },
    ],
  },
  sunday: {
    weekday: 0,
    title: 'แจ้งเตือนวันอาทิตย์',
    buttons: [
      { id: 'both', label: 'พร้อมทั้ง2รอบ', style: 'Primary' },
      {
        id: 'r1_only',
        label: 'พร้อมแค่รอบ1 บอสกิลด์ (ลารอบ2ให้)',
        style: 'Secondary',
        weight: 0.5,
        leaveLabel: 'รอบ2 ตีปราสาท',
        exemptChecks: ['sun_war'],
      },
      {
        id: 'r2_only',
        label: 'พร้อมแค่รอบ2 ตีปราสาท (ลารอบ1ให้)',
        style: 'Secondary',
        weight: 0.5,
        leaveLabel: 'รอบ1 บอสกิลด์',
        exemptChecks: ['sun_boss'],
      },
      {
        id: 'leave_both',
        label: 'ลาทั้ง2รอบ',
        style: 'Danger',
        weight: 1,
        leaveLabel: 'ทั้ง2รอบ',
        exemptChecks: ['sun_boss', 'sun_war'],
      },
    ],
  },
};

function chunk(arr, size) {
  const rows = [];
  for (let i = 0; i < arr.length; i += size) rows.push(arr.slice(i, i + size));
  return rows;
}

function buildComponents(dayKind, dateKey) {
  const day = DAY_CONFIGS[dayKind];
  const buttons = day.buttons.map((b) =>
    new ButtonBuilder()
      .setCustomId(`${PREFIX}${dayKind}:${b.id}:${dateKey}`)
      .setLabel(b.label)
      .setStyle(ButtonStyle[b.style])
  );
  buttons.push(new ButtonBuilder().setCustomId(leavePanel.CANCEL_BUTTON_ID).setLabel('ยกเลิกลา').setStyle(ButtonStyle.Secondary));
  return chunk(buttons, 5).map((row) => new ActionRowBuilder().addComponents(row));
}

function getRecipients(guild) {
  if (!ROUND_NOTIFY_LIVE) return [ROUND_NOTIFY_TEST_USER_ID];
  const ids = new Set();
  for (const roleId of ROUND_NOTIFY_ROLE_IDS) {
    const role = guild.roles.cache.get(roleId);
    if (!role) continue;
    for (const memberId of role.members.keys()) ids.add(memberId);
  }
  return [...ids];
}

async function sendRoundNotifications(client, dayKind) {
  const day = DAY_CONFIGS[dayKind];
  const guild = client.guilds.cache.get(GUILD_ID);
  if (!guild || !day) return { sent: 0, failed: 0 };

  const dateKey = time.nextOccurrenceOf(day.weekday).dateKey;
  const embed = new EmbedBuilder()
    .setTitle(day.title)
    .setDescription(`วันที่ ${time.formatThaiDate(dateKey)} — เลือกปุ่มที่ตรงกับที่คุณจะมาได้เลยครับ (เลือกได้ปุ่มเดียว)`)
    .setColor(0x5865f2);
  const components = buildComponents(dayKind, dateKey);

  const recipients = getRecipients(guild);
  let sent = 0;
  let failed = 0;
  for (const userId of recipients) {
    try {
      const user = await client.users.fetch(userId);
      await user.send({ embeds: [embed], components });
      sent += 1;
    } catch (err) {
      failed += 1;
      console.error(`[dmNotify] ส่ง DM แจ้งเตือนไม่สำเร็จ (${userId}):`, err.message);
    }
  }
  return { sent, failed };
}

function alreadyDeclared(userId, dateKey, leaveLabel) {
  return leaveManager.getCancellableLeaves(userId).some((c) => c.warDate === dateKey && (c.label || '') === leaveLabel);
}

async function handleButton(interaction) {
  if (!interaction.customId.startsWith(PREFIX)) return false;

  const [dayKind, btnId, dateKey] = interaction.customId.slice(PREFIX.length).split(':');
  const day = DAY_CONFIGS[dayKind];
  const btn = day && day.buttons.find((b) => b.id === btnId);
  if (!btn) return true;

  if (btn.leaveLabel === undefined) {
    await interaction.update({
      content: `✅ รับทราบ — ${btn.label} วันที่ ${time.formatThaiDate(dateKey)} ครับ`,
      components: leavePanel.cancelOnlyRow(),
    });
    return true;
  }

  const boundName = bindings.getNameByUserId(interaction.user.id);
  if (!boundName) {
    await interaction.update({ content: 'บัญชีนี้ยังไม่ได้ผูกชื่อเกม ใช้คำสั่ง /ผูก ก่อนครับ', components: [] });
    return true;
  }
  if (alreadyDeclared(interaction.user.id, dateKey, btn.leaveLabel)) {
    await interaction.update({
      content: `แจ้งลา${btn.leaveLabel ? ' ' + btn.leaveLabel : ''} วันที่ ${time.formatThaiDate(dateKey)} ไปแล้วครับ`,
      components: leavePanel.cancelOnlyRow(),
    });
    return true;
  }

  const ctx = await leavePanel.resolveAnnounceContext(interaction);
  await leavePanel.finalizeLeave(interaction, interaction.user.id, dateKey, undefined, {
    ...ctx,
    weight: btn.weight,
    label: btn.leaveLabel,
    exemptChecks: btn.exemptChecks,
  });
  return true;
}

function setupSchedule(client) {
  cron.schedule(
    '0 12 * * 0,2,4',
    () => {
      const p = time.nowParts();
      const dayKind = { 2: 'tuesday', 4: 'thursday', 0: 'sunday' }[p.weekday];
      if (!dayKind) return;
      sendRoundNotifications(client, dayKind).catch((err) => console.error('[dmNotify] ส่งแจ้งเตือนล้มเหลว:', err.message));
    },
    { timezone: TIMEZONE }
  );
}

module.exports = { setupSchedule, sendRoundNotifications, handleButton, DAY_CONFIGS };
