const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const scheduleChecker = require('../features/scheduleChecker');
const storage = require('../storage');
const { TEST_DAYS, CHECKS } = require('../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ทดสอบเริ่ม')
    .setDescription('[ทดสอบ] เริ่มนับเวลาของวันที่เลือกทันที ไม่ต้องรอตารางจริง')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((opt) =>
      opt
        .setName('วัน')
        .setDescription('เลือกวันที่จะทดสอบ')
        .setRequired(true)
        .addChoices(...TEST_DAYS.map((d) => ({ name: d.label, value: d.key })))
    ),

  async execute(interaction) {
    const day = TEST_DAYS.find((d) => d.key === interaction.options.getString('วัน'));
    const all = storage.load('liveSessions', {});
    const alreadyActive = day.checkKeys.some((ck) => {
      const check = CHECKS.find((c) => c.key === ck);
      return check.sessionKeys.some((sk) => all[sk]?.active);
    });

    if (alreadyActive) {
      return interaction.reply({
        content: `รอบของ **${day.label}** กำลังทำงานอยู่แล้ว (อาจเป็นรอบจริงตามตาราง) ห้ามเริ่มซ้ำ ใช้ /ทดสอบจบ เพื่อปิดรอบแทน`,
        ephemeral: true,
      });
    }

    for (const checkKey of day.checkKeys) {
      scheduleChecker.runCheckStart(checkKey, interaction.guild);
    }
    return interaction.reply({
      content: `เริ่มทดสอบ **${day.label}** แล้ว ใครอยู่ในห้องตอนนี้จะถูกนับเวลาเริ่มจากตอนนี้ ลองเข้า-ออกห้องเสียงดูได้ พอพร้อมแล้วใช้ /ทดสอบจบ เพื่อบันทึกลงชีต + ส่ง DM สรุป`,
      ephemeral: true,
    });
  },
};
