const { SlashCommandBuilder } = require('discord.js');
const bindings = require('../features/bindings');

const ALLOWED_ROLE_ID = '1537745685846163466';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('name')
    .setDescription('[แอดมิน] ตั้ง/เปลี่ยนชื่อเกมให้สมาชิกคนอื่นโดยตรง ไม่ต้องรู้ชื่อเก่า')
    .addUserOption((opt) => opt.setName('ดิส').setDescription('บัญชี Discord ของสมาชิกคนนั้น').setRequired(true))
    .addStringOption((opt) => opt.setName('ชื่อใหม่').setDescription('ชื่อเกมใหม่').setRequired(true)),

  async execute(interaction) {
    if (!interaction.member.roles.cache.has(ALLOWED_ROLE_ID)) {
      return interaction.reply({ content: 'คำสั่งนี้ใช้ได้เฉพาะแอดมินครับ', ephemeral: true });
    }

    const targetUser = interaction.options.getUser('ดิส');
    const newName = interaction.options.getString('ชื่อใหม่').trim();
    const result = bindings.setName(targetUser.id, newName);

    if (!result.ok) {
      return interaction.reply({ content: `ชื่อ **${newName}** ถูกผูกกับบัญชีอื่นไปแล้ว`, ephemeral: true });
    }

    const content = result.oldName
      ? `เปลี่ยนชื่อ ${targetUser.tag} จาก **${result.oldName}** เป็น **${newName}** เรียบร้อยครับ`
      : `ตั้งชื่อ ${targetUser.tag} เป็น **${newName}** เรียบร้อยครับ`;
    await interaction.reply({ content, ephemeral: true });
    await bindings.syncToSheet(targetUser.tag, newName, result.oldName);
  },
};
