const { SlashCommandBuilder } = require('discord.js');
const absencePanel = require('../features/absencePanel');

const ALLOWED_ROLE_ID = '1537745685846163466';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ยกเลิกขาดทั้งหมด')
    .setDescription('[แอดมิน] ยกเลิกการนับขาดของทุกคนในวันที่เลือก (วันนั้นไม่มีวอร์/ลืมย้ายห้องกันทั้งกิลด์)'),

  async execute(interaction) {
    if (!interaction.member.roles.cache.has(ALLOWED_ROLE_ID)) {
      return interaction.reply({ content: 'คำสั่งนี้ใช้ได้เฉพาะแอดมินครับ', ephemeral: true });
    }

    await absencePanel.startCancelAll(interaction);
  },
};
