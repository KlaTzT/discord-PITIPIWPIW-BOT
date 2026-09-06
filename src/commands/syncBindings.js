const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const bindings = require('../features/bindings');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ซิงค์ผูกid')
    .setDescription('[แอดมิน] ส่งข้อมูลผูก ID ทั้งหมดที่มีอยู่แล้วขึ้นชีต ผูกID ใหม่ทั้งหมด')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    const entries = Object.entries(bindings.all());

    for (const [userId, name] of entries) {
      let discordTag = userId;
      try {
        const member = await interaction.guild.members.fetch(userId);
        discordTag = member.user.tag;
      } catch {
        // สมาชิกอาจออกจากดิสไปแล้ว ใช้ userId แทน
      }
      await bindings.syncToSheet(discordTag, name);
    }

    return interaction.editReply(`ซิงค์ข้อมูลผูก ID ขึ้นชีตแล้ว ${entries.length} คน`);
  },
};
