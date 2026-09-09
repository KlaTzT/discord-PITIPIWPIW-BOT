const { SlashCommandBuilder } = require('discord.js');
const absencePanel = require('../features/absencePanel');
const time = require('../time');
const { CHECKS } = require('../config');

const ALLOWED_ROLE_ID = '1537745685846163466';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ยกเลิกขาด')
    .setDescription('[แอดมิน] ยกเลิกการนับขาดของสมาชิกคนหนึ่ง')
    .addUserOption((opt) => opt.setName('ดิส').setDescription('บัญชี Discord ของสมาชิกคนนั้น').setRequired(true))
    .addStringOption((opt) =>
      opt
        .setName('ประเภท')
        .setDescription('รอบที่จะยกเลิก (ไม่ใส่ = เลือกทีหลังผ่านปุ่ม)')
        .addChoices(...CHECKS.map((c) => ({ name: c.label, value: c.key })))
    )
    .addStringOption((opt) =>
      opt.setName('วันที่').setDescription('วัน/เดือน/ปี เช่น 22/09/2026 (ต้องใส่คู่กับประเภท)')
    ),

  async execute(interaction) {
    if (!interaction.member.roles.cache.has(ALLOWED_ROLE_ID)) {
      return interaction.reply({ content: 'คำสั่งนี้ใช้ได้เฉพาะแอดมินครับ', ephemeral: true });
    }

    const targetUser = interaction.options.getUser('ดิส');
    const checkKey = interaction.options.getString('ประเภท');
    const dateStr = interaction.options.getString('วันที่');

    if (checkKey && dateStr) {
      const dateKey = time.parseThaiDate(dateStr);
      if (!dateKey) {
        return interaction.reply({ content: 'รูปแบบวันที่ไม่ถูกต้อง ใช้ วัน/เดือน/ปี เช่น 22/09/2026 ครับ', ephemeral: true });
      }
      await absencePanel.cancelOneDirect(interaction, targetUser, checkKey, dateKey);
      return;
    }
    if (checkKey || dateStr) {
      return interaction.reply({
        content: 'ต้องใส่ทั้งประเภทและวันที่คู่กันถ้าจะระบุเอง ไม่งั้นเว้นว่างทั้งคู่แล้วเลือกผ่านปุ่มแทนครับ',
        ephemeral: true,
      });
    }

    await absencePanel.startCancelOne(interaction, targetUser);
  },
};
