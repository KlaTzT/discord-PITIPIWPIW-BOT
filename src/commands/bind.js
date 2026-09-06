const { SlashCommandBuilder } = require('discord.js');
const bindings = require('../features/bindings');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ผูก')
    .setDescription('ผูกชื่อเกมกับบัญชี Discord ของคุณ (ผูกได้ครั้งเดียว)')
    .addStringOption((opt) => opt.setName('ชื่อเกม').setDescription('ชื่อในเกมของคุณ').setRequired(true)),

  async execute(interaction) {
    const name = interaction.options.getString('ชื่อเกม').trim();
    const result = bindings.bind(interaction.user.id, name);

    if (result.ok) {
      await bindings.syncToSheet(interaction.user.tag, name);
      return interaction.reply({ content: `ผูกชื่อ **${name}** กับบัญชีนี้เรียบร้อยครับ`, ephemeral: true });
    }
    if (result.reason === 'USER_ALREADY_BOUND') {
      return interaction.reply({
        content: `บัญชีนี้ผูกกับชื่อ **${result.existingName}** ไว้แล้ว ถ้าต้องการเปลี่ยนให้ติดต่อแอดมินใช้คำสั่ง /เปลี่ยนชื่อ`,
        ephemeral: true,
      });
    }
    if (result.reason === 'NAME_TAKEN') {
      return interaction.reply({ content: `ชื่อ **${name}** ถูกผูกกับบัญชีอื่นไปแล้ว`, ephemeral: true });
    }
    return interaction.reply({ content: 'เกิดข้อผิดพลาด ลองใหม่อีกครั้ง', ephemeral: true });
  },
};
