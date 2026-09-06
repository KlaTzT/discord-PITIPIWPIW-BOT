const { ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const bindings = require('./bindings');
const attendanceTracker = require('./attendanceTracker');
const time = require('./../time');

const CANCEL_ONE_PREFIX = 'admin:absence:one:';
const CANCEL_ALL_ID = 'admin:absence:all';

async function startCancelOne(interaction, targetUser) {
  const boundName = bindings.getNameByUserId(targetUser.id);
  if (!boundName) {
    await interaction.reply({ content: `${targetUser.tag} ยังไม่ได้ผูกชื่อเกม`, ephemeral: true });
    return;
  }

  const absences = attendanceTracker.getAbsences(targetUser.id).slice(0, 25);
  if (absences.length === 0) {
    await interaction.reply({ content: `${boundName} ไม่มีประวัติขาดที่ยกเลิกได้ครับ`, ephemeral: true });
    return;
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`${CANCEL_ONE_PREFIX}${targetUser.id}`)
    .setPlaceholder('เลือกวันที่จะยกเลิกขาด')
    .addOptions(
      absences.map((a) => ({
        label: `${time.formatThaiDate(a.date)} - ${a.checkLabel}`,
        value: `${a.monthKey}|${a.index}`,
      }))
    );

  await interaction.reply({
    content: `ยกเลิกขาดของ **${boundName}** (${targetUser.tag}) — เลือกวันที่จะยกเลิก`,
    components: [new ActionRowBuilder().addComponents(menu)],
    ephemeral: true,
  });
}

async function startCancelAll(interaction) {
  const dates = attendanceTracker.listDatesWithAbsences().slice(0, 25);
  if (dates.length === 0) {
    await interaction.reply({ content: 'ไม่มีข้อมูลขาดที่ยกเลิกได้ครับ', ephemeral: true });
    return;
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId(CANCEL_ALL_ID)
    .setPlaceholder('เลือกวันที่จะยกเลิกขาดทั้งหมด')
    .addOptions(dates.map((d) => ({ label: time.formatThaiDate(d), value: d })));

  await interaction.reply({
    content: 'เลือกวันที่จะยกเลิกขาดทั้งหมด (ใช้ตอนวันนั้นไม่มีวอร์จริง หรือลืมย้ายห้องกันทั้งกิลด์)',
    components: [new ActionRowBuilder().addComponents(menu)],
    ephemeral: true,
  });
}

async function handlePickOne(interaction) {
  const targetUserId = interaction.customId.slice(CANCEL_ONE_PREFIX.length);
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
  const dateStr = interaction.values[0];
  const results = attendanceTracker.cancelAllAbsencesForDate(dateStr);

  if (results.length === 0) {
    await interaction.update({ content: 'ไม่พบข้อมูลขาดของวันนี้แล้ว (อาจถูกยกเลิกไปก่อนหน้านี้)', components: [] });
    return;
  }

  for (const { userId, monthKey } of results) {
    await attendanceTracker.upsertSummaryRow(userId, monthKey, interaction.guild);
  }

  const revokedCount = results.filter((r) => r.warningRevoked).length;
  const extra = revokedCount > 0 ? ` (คืนใบเตือนให้ ${revokedCount} คนด้วย)` : '';
  await interaction.update({
    content: `ยกเลิกขาดวันที่ ${time.formatThaiDate(dateStr)} ให้ ${results.length} คนแล้วครับ${extra}`,
    components: [],
  });
}

async function handleSelect(interaction) {
  if (interaction.customId.startsWith(CANCEL_ONE_PREFIX)) {
    await handlePickOne(interaction);
    return true;
  }
  if (interaction.customId === CANCEL_ALL_ID) {
    await handlePickAll(interaction);
    return true;
  }
  return false;
}

module.exports = { startCancelOne, startCancelAll, handleSelect };
