const { SlashCommandBuilder } = require('discord.js');
const bindings = require('../features/bindings');

const ALLOWED_ROLE_ID = '1537745685846163466';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ลบผูก')
    .setDescription('[แอดมิน] ลบการผูกชื่อเกมออกจากระบบ')
    .addStringOption((opt) => opt.setName('ชื่อ').setDescription('ชื่อเกมที่จะลบการผูก').setRequired(true)),

  async execute(interaction) {
    if (!interaction.member.roles.cache.has(ALLOWED_ROLE_ID)) {
      return interaction.reply({ content: 'คำสั่งนี้ใช้ได้เฉพาะแอดมินครับ', ephemeral: true });
    }

    const name = interaction.options.getString('ชื่อ').trim();
    const result = bindings.unbind(name);

    if (!result.ok) {
      return interaction.reply({ content: `ไม่พบชื่อ **${name}** ในระบบผูก ID`, ephemeral: true });
    }

    await bindings.removeFromSheet(name);
    return interaction.reply({ content: `ลบการผูกชื่อ **${name}** เรียบร้อยครับ`, ephemeral: true });
  },
};
