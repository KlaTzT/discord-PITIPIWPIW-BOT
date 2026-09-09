const { SlashCommandBuilder } = require('discord.js');
const bindings = require('../features/bindings');

const ALLOWED_ROLE_ID = '1537745685846163466';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('add')
    .setDescription('[แอดมิน] ผูกชื่อเกมให้สมาชิกคนอื่น')
    .addUserOption((opt) => opt.setName('ดิส').setDescription('บัญชี Discord ของสมาชิกที่จะผูก').setRequired(true))
    .addStringOption((opt) => opt.setName('ชื่อตัวละคร').setDescription('ชื่อในเกมของสมาชิกคนนั้น').setRequired(true)),

  async execute(interaction) {
    if (!interaction.member.roles.cache.has(ALLOWED_ROLE_ID)) {
      return interaction.reply({ content: 'คำสั่งนี้ใช้ได้เฉพาะแอดมินครับ', ephemeral: true });
    }

    const targetUser = interaction.options.getUser('ดิส');
    const name = interaction.options.getString('ชื่อตัวละคร').trim();
    const result = bindings.bind(targetUser.id, name);

    if (result.ok) {
      await interaction.reply({ content: `ผูกชื่อ **${name}** ให้ ${targetUser.tag} เรียบร้อยครับ`, ephemeral: true });
      await bindings.syncToSheet(targetUser.tag, name);
      return;
    }
    if (result.reason === 'USER_ALREADY_BOUND') {
      return interaction.reply({
        content: `${targetUser.tag} ผูกกับชื่อ **${result.existingName}** ไว้แล้ว ถ้าจะเปลี่ยนใช้ /เปลี่ยนชื่อ แทน`,
        ephemeral: true,
      });
    }
    if (result.reason === 'NAME_TAKEN') {
      return interaction.reply({ content: `ชื่อ **${name}** ถูกผูกกับบัญชีอื่นไปแล้ว`, ephemeral: true });
    }
    return interaction.reply({ content: 'เกิดข้อผิดพลาด ลองใหม่อีกครั้ง', ephemeral: true });
  },
};
