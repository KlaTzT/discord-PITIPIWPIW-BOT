const { SlashCommandBuilder } = require('discord.js');
const leaveManager = require('../features/leaveManager');
const bindings = require('../features/bindings');
const attendanceTracker = require('../features/attendanceTracker');
const time = require('../time');

const ALLOWED_ROLE_ID = '1537745685846163466';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ยกเลิกใบ')
    .setDescription('[แอดมิน] ล้างใบเตือน/ใบแดงที่เคยให้ด้วยมือของเดือนนี้')
    .addUserOption((opt) => opt.setName('ดิส').setDescription('บัญชี Discord ของสมาชิกคนนั้น').setRequired(true)),

  async execute(interaction) {
    if (!interaction.member.roles.cache.has(ALLOWED_ROLE_ID)) {
      return interaction.reply({ content: 'คำสั่งนี้ใช้ได้เฉพาะแอดมินครับ', ephemeral: true });
    }

    const targetUser = interaction.options.getUser('ดิส');
    const gameName = bindings.getNameByUserId(targetUser.id);
    if (!gameName) {
      return interaction.reply({ content: `${targetUser.tag} ยังไม่ได้ผูกชื่อเกม`, ephemeral: true });
    }

    const monthKey = time.monthKey();
    const result = leaveManager.clearManualCards(targetUser.id, monthKey);

    const status = result.redCard
      ? '🔴 ยังมีใบแดงอยู่ (มาจากลา/ขาดเกินเกณฑ์ ไม่ใช่ที่ให้ด้วยมือ)'
      : result.warnings > 0
        ? `🟡 ยังมีใบเตือน ${result.warnings} ใบอยู่ (มาจากระบบอัตโนมัติ)`
        : '🟢 ปกติ';

    await interaction.reply({
      content: `ล้างใบที่เคยให้ด้วยมือของ **${gameName}** (${targetUser.tag}) เดือนนี้แล้วครับ สถานะตอนนี้: ${status}`,
      ephemeral: true,
    });

    await attendanceTracker.upsertSummaryRow(targetUser.id, monthKey, interaction.guild);
  },
};
