const { ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const bindings = require('./bindings');
const attendanceTracker = require('./attendanceTracker');
const time = require('./../time');
const { CHECKS } = require('../config');

const CANCEL_ONE_CATEGORY_PREFIX = 'admin:absence:onecat:';
const CANCEL_ONE_DATE_PREFIX = 'admin:absence:onedate:';
const CANCEL_ALL_CATEGORY_PREFIX = 'admin:absence:allcat:';
const CANCEL_ALL_DATE_PREFIX = 'admin:absence:alldate:';

async function startCancelOne(interaction, targetUser) {
  const boundName = bindings.getNameByUserId(targetUser.id);
  if (!boundName) {
    await interaction.reply({ content: `${targetUser.tag} ยังไม่ได้ผูกชื่อเกม`, ephemeral: true });
    return;
  }

  const absences = attendanceTracker.getAbsences(targetUser.id);
  if (absences.length === 0) {
    await interaction.reply({ content: `${boundName} ไม่มีประวัติขาดที่ยกเลิกได้ครับ`, ephemeral: true });
    return;
  }

  const row = new ActionRowBuilder().addComponents(
    CHECKS.map((c) =>
      new ButtonBuilder()
        .setCustomId(`${CANCEL_ONE_CATEGORY_PREFIX}${targetUser.id}:${c.key}`)
        .setLabel(c.label)
        .setStyle(ButtonStyle.Secondary)
    )
  );

  await interaction.reply({
    content: `ยกเลิกขาดของ **${boundName}** (${targetUser.tag}) — เลือกก่อนว่าจะยกเลิกขาดของรอบไหน`,
    components: [row],
    ephemeral: true,
  });
}

async function handlePickOneCategory(interaction) {
  const [targetUserId, checkKey] = interaction.customId.slice(CANCEL_ONE_CATEGORY_PREFIX.length).split(':');
  const check = CHECKS.find((c) => c.key === checkKey);
  const boundName = bindings.getNameByUserId(targetUserId);

  const absences = attendanceTracker.getAbsences(targetUserId).filter((a) => a.checkKey === checkKey);
  if (absences.length === 0) {
    await interaction.update({ content: `${boundName} ไม่มีข้อมูลขาดของ **${check.label}** ที่ยกเลิกได้ครับ`, components: [] });
    return;
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`${CANCEL_ONE_DATE_PREFIX}${targetUserId}:${checkKey}`)
    .setPlaceholder('เลือกวันที่จะยกเลิกขาด')
    .addOptions(
      absences.slice(0, 25).map((a) => ({ label: time.formatThaiDate(a.date), value: `${a.monthKey}|${a.index}` }))
    );

  await interaction.update({
    content: `ยกเลิกขาด **${check.label}** ของ **${boundName}** — เลือกวันที่`,
    components: [new ActionRowBuilder().addComponents(menu)],
  });
}

async function startCancelAll(interaction) {
  const row = new ActionRowBuilder().addComponents(
    CHECKS.map((c) =>
      new ButtonBuilder().setCustomId(`${CANCEL_ALL_CATEGORY_PREFIX}${c.key}`).setLabel(c.label).setStyle(ButtonStyle.Secondary)
    )
  );

  await interaction.reply({
    content: 'ยกเลิกขาดทั้งหมด (ใช้ตอนวันนั้นไม่มีวอร์จริง หรือลืมย้ายห้องกันทั้งกิลด์) — เลือกก่อนว่าจะยกเลิกขาดของรอบไหน',
    components: [row],
    ephemeral: true,
  });
}

async function handlePickCategory(interaction) {
  const checkKey = interaction.customId.slice(CANCEL_ALL_CATEGORY_PREFIX.length);
  const check = CHECKS.find((c) => c.key === checkKey);
  const dates = attendanceTracker.listDatesWithAbsences(checkKey).slice(0, 25);

  if (dates.length === 0) {
    await interaction.update({ content: `ไม่มีข้อมูลขาดของ **${check.label}** ที่ยกเลิกได้ครับ`, components: [] });
    return;
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`${CANCEL_ALL_DATE_PREFIX}${checkKey}`)
    .setPlaceholder('เลือกวันที่จะยกเลิกขาดทั้งหมด')
    .addOptions(dates.map((d) => ({ label: time.formatThaiDate(d), value: d })));

  await interaction.update({
    content: `ยกเลิกขาดทั้งหมดของ **${check.label}** — เลือกวันที่`,
    components: [new ActionRowBuilder().addComponents(menu)],
  });
}

async function handlePickOne(interaction) {
  const [targetUserId] = interaction.customId.slice(CANCEL_ONE_DATE_PREFIX.length).split(':');
  const [monthKey, indexStr] = interaction.values[0].split('|');
  const boundName = bindings.getNameByUserId(targetUserId);

  const result = attendanceTracker.cancelAbsence(targetUserId, monthKey, Number(indexStr));
  if (!result.ok) {
    await interaction.update({ content: 'ไม่พบรายการขาดนี้แล้ว (อาจถูกยกเลิกไปก่อนหน้านี้)', components: [] });
    return;
  }

  await attendanceTracker.upsertSummaryRow(targetUserId, monthKey, interaction.guild);

  const extra = result.warningRevoked ? ' (คืนใบเตือนที่ได้จากขาดครบโควตาให้ด้วย)' : '';
  await interaction.update({
    content: `ยกเลิกขาดวันที่ ${time.formatThaiDate(result.removed.date)} (${result.removed.checkLabel}) ของ **${boundName}** แล้วครับ${extra}`,
    components: [],
  });
}

async function handlePickAll(interaction) {
  // ยกเลิกได้หลายสิบคนพร้อมกัน แต่ละคนต้องยิงชีตเพิ่ม เกิน 3 วิ (ที่ discord บังคับตอบสนอง) ได้ง่าย
  // defer ไว้ก่อนเลยให้มีเวลาทำงานได้ยาวขึ้น (สูงสุด 15 นาที) แทน
  await interaction.deferUpdate();

  const checkKey = interaction.customId.slice(CANCEL_ALL_DATE_PREFIX.length);
  const check = CHECKS.find((c) => c.key === checkKey);
  const dateStr = interaction.values[0];
  const results = attendanceTracker.cancelAllAbsencesForDate(dateStr, checkKey);

  if (results.length === 0) {
    await interaction.editReply({ content: 'ไม่พบข้อมูลขาดของวันนี้แล้ว (อาจถูกยกเลิกไปก่อนหน้านี้)', components: [] });
    return;
  }

  for (const { userId, monthKey } of results) {
    await attendanceTracker.upsertSummaryRow(userId, monthKey, interaction.guild);
  }

  const revokedCount = results.filter((r) => r.warningRevoked).length;
  const extra = revokedCount > 0 ? ` (คืนใบเตือนให้ ${revokedCount} คนด้วย)` : '';
  await interaction.editReply({
    content: `ยกเลิกขาด **${check.label}** วันที่ ${time.formatThaiDate(dateStr)} ให้ ${results.length} คนแล้วครับ${extra}`,
    components: [],
  });
}

async function handleButton(interaction) {
  if (interaction.customId.startsWith(CANCEL_ONE_CATEGORY_PREFIX)) {
    await handlePickOneCategory(interaction);
    return true;
  }
  if (interaction.customId.startsWith(CANCEL_ALL_CATEGORY_PREFIX)) {
    await handlePickCategory(interaction);
    return true;
  }
  return false;
}

async function handleSelect(interaction) {
  if (interaction.customId.startsWith(CANCEL_ONE_DATE_PREFIX)) {
    await handlePickOne(interaction);
    return true;
  }
  if (interaction.customId.startsWith(CANCEL_ALL_DATE_PREFIX)) {
    await handlePickAll(interaction);
    return true;
  }
  return false;
}

module.exports = { startCancelOne, startCancelAll, handleButton, handleSelect };
