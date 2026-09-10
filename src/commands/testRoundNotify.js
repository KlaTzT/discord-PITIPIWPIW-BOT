const { SlashCommandBuilder } = require('discord.js');
const dmNotify = require('../features/dmNotify');

const ALLOWED_ROLE_ID = '1537745685846163466';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('เทสแจ้งเตือน')
    .setDescription('[แอดมิน] ทดสอบส่ง DM แจ้งเตือนก่อนวอร์ทันที (ตอนนี้ส่งเข้า DM คนทดสอบคนเดียวเท่านั้น)')
    .addStringOption((opt) =>
      opt
        .setName('วัน')
        .setDescription('เลือกรูปแบบวันที่จะทดสอบ')
        .setRequired(true)
        .addChoices(
          { name: 'วันอังคาร', value: 'tuesday' },
          { name: 'วันพฤหัสบดี', value: 'thursday' },
          { name: 'วันอาทิตย์', value: 'sunday' }
        )
    ),

  async execute(interaction) {
    if (!interaction.member.roles.cache.has(ALLOWED_ROLE_ID)) {
      return interaction.reply({ content: 'คำสั่งนี้ใช้ได้เฉพาะแอดมินครับ', ephemeral: true });
    }

    const dayKind = interaction.options.getString('วัน');
    const result = await dmNotify.sendRoundNotifications(interaction.client, dayKind);
    return interaction.reply({
      content: `ส่งแจ้งเตือนแบบ "${dayKind}" แล้วครับ (สำเร็จ ${result.sent} คน, ล้มเหลว ${result.failed} คน)`,
      ephemeral: true,
    });
  },
};
