const { SlashCommandBuilder } = require('discord.js');
const leaveManager = require('../features/leaveManager');
const bindings = require('../features/bindings');
const attendanceTracker = require('../features/attendanceTracker');
const sheets = require('../sheets');
const time = require('../time');
const { SHEET_TABS } = require('../config');

const ALLOWED_ROLE_ID = '1537745685846163466';
const WARNING_LOG_HEADER = ['Discord', 'ตัวละคร', 'เหตุ', 'ได้รับใบ'];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ให้ใบ')
    .setDescription('[แอดมิน] ให้ใบเตือนหรือใบแดงกับสมาชิกโดยตรง')
    .addUserOption((opt) => opt.setName('ดิส').setDescription('บัญชี Discord ของสมาชิกคนนั้น').setRequired(true))
    .addStringOption((opt) =>
      opt
        .setName('ประเภท')
        .setDescription('ใบเตือนหรือใบแดง')
        .setRequired(true)
        .addChoices({ name: 'ใบเตือน', value: 'warning' }, { name: 'ใบแดง', value: 'redcard' })
    )
    .addStringOption((opt) => opt.setName('เหตุผล').setDescription('สาเหตุที่ให้ใบนี้').setRequired(true)),

  async execute(interaction) {
    if (!interaction.member.roles.cache.has(ALLOWED_ROLE_ID)) {
      return interaction.reply({ content: 'คำสั่งนี้ใช้ได้เฉพาะแอดมินครับ', ephemeral: true });
    }

    const targetUser = interaction.options.getUser('ดิส');
    const type = interaction.options.getString('ประเภท');
    const reason = interaction.options.getString('เหตุผล').trim();
    const gameName = bindings.getNameByUserId(targetUser.id);

    if (!gameName) {
      return interaction.reply({ content: `${targetUser.tag} ยังไม่ได้ผูกชื่อเกม`, ephemeral: true });
    }

    const monthKey = time.monthKey();
    const result =
      type === 'redcard'
        ? leaveManager.giveManualRedCard(targetUser.id, monthKey)
        : leaveManager.addManualWarning(targetUser.id, monthKey);

    const extra = type !== 'redcard' && result.newlyRedCarded ? ' (สะสมครบจนได้ใบแดงด้วย 🔴)' : '';
    await interaction.reply({
      content: `ให้${type === 'redcard' ? 'ใบแดง 🔴' : 'ใบเตือน 🟡'} **${gameName}** (${targetUser.tag}) แล้วครับ เหตุผล: ${reason}${extra}`,
      ephemeral: true,
    });

    try {
      await sheets.appendRow(SHEET_TABS.WARNING_LOG, WARNING_LOG_HEADER, [
        targetUser.tag,
        gameName,
        reason,
        type === 'redcard' ? 'ใบแดง' : 'ใบเตือน',
      ]);
    } catch (err) {
      console.error('[giveCard] เขียนชีตใบเตือนล้มเหลว:', err.message);
    }

    await attendanceTracker.upsertSummaryRow(targetUser.id, monthKey, interaction.guild);
  },
};
