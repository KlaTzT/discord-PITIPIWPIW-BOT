const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const scheduleChecker = require('../features/scheduleChecker');
const storage = require('../storage');
const { TEST_DAYS, CHECKS } = require('../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ทดสอบจบ')
    .setDescription('[ทดสอบ] จบรอบทดสอบของวันที่เลือก เขียนชีต + ส่ง DM สรุปทันที')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((opt) =>
      opt
        .setName('วัน')
        .setDescription('เลือกวันที่จะจบ')
        .setRequired(true)
        .addChoices(...TEST_DAYS.map((d) => ({ name: d.label, value: d.key })))
    ),

  async execute(interaction) {
    const day = TEST_DAYS.find((d) => d.key === interaction.options.getString('วัน'));
    const all = storage.load('liveSessions', {});
    const anyActive = day.checkKeys.some((ck) => {
      const check = CHECKS.find((c) => c.key === ck);
      return check.sessionKeys.some((sk) => all[sk]?.active);
    });

    if (!anyActive) {
      return interaction.reply({ content: `รอบของ **${day.label}** ยังไม่ได้เริ่ม ใช้ /ทดสอบเริ่ม ก่อน`, ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });
    for (const checkKey of day.checkKeys) {
      await scheduleChecker.runCheckEnd(checkKey, interaction.guild, interaction.client);
    }
    return interaction.editReply(`จบรอบทดสอบ **${day.label}** แล้ว เช็คแท็บที่เกี่ยวข้องในชีต + DM ที่ส่งไปได้เลย`);
  },
};
