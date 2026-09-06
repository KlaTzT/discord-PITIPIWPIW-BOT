const { SlashCommandBuilder } = require('discord.js');
const bindings = require('../features/bindings');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('เปลี่ยนชื่อ')
    .setDescription('แก้ไขชื่อเกมที่ผูกไว้กับสมาชิก')
    .addStringOption((opt) => opt.setName('ชื่อเก่า').setDescription('ชื่อเกมเดิมที่ผูกไว้').setRequired(true))
    .addUserOption((opt) => opt.setName('ดิส').setDescription('บัญชี Discord ของสมาชิกคนนั้น').setRequired(true))
    .addStringOption((opt) => opt.setName('ชื่อใหม่').setDescription('ชื่อเกมใหม่').setRequired(true)),

  async execute(interaction) {
    const oldName = interaction.options.getString('ชื่อเก่า').trim();
    const oldUser = interaction.options.getUser('ดิส');
    const newName = interaction.options.getString('ชื่อใหม่').trim();

    const result = bindings.rename(oldUser.id, oldName, newName);

    if (result.ok) {
      await bindings.syncToSheet(oldUser.tag, newName, oldName);
      return interaction.reply({
        content: `เปลี่ยนชื่อ **${oldName}** (${oldUser.tag}) เป็น **${newName}** เรียบร้อยครับ`,
        ephemeral: true,
      });
    }
    if (result.reason === 'NOT_MATCHED') {
      return interaction.reply({
        content: `ข้อมูลไม่ตรงกัน: ${oldUser.tag} ผูกชื่อ **${result.currentName || '(ไม่มี)'}** อยู่ ไม่ใช่ **${oldName}**`,
        ephemeral: true,
      });
    }
    if (result.reason === 'NAME_TAKEN') {
      return interaction.reply({ content: `ชื่อ **${newName}** ถูกใช้กับบัญชีอื่นอยู่แล้ว`, ephemeral: true });
    }
    return interaction.reply({ content: 'เกิดข้อผิดพลาด ลองใหม่อีกครั้ง', ephemeral: true });
  },
};
