const { SlashCommandBuilder } = require('discord.js');
const leavePanel = require('../features/leavePanel');

const ALLOWED_ROLE_ID = '1537745685846163466';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ลาแทน')
    .setDescription('[แอดมิน] แจ้งลากิจแทนสมาชิกคนอื่น')
    .addUserOption((opt) => opt.setName('ดิส').setDescription('บัญชี Discord ของสมาชิกที่จะลาแทน').setRequired(true)),

  async execute(interaction) {
    if (!interaction.member.roles.cache.has(ALLOWED_ROLE_ID)) {
      return interaction.reply({ content: 'คำสั่งนี้ใช้ได้เฉพาะแอดมินครับ', ephemeral: true });
    }

    const targetUser = interaction.options.getUser('ดิส');
    await leavePanel.startAdminLeave(interaction, targetUser);
  },
};
