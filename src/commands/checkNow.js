const { SlashCommandBuilder } = require('discord.js');
const bindings = require('../features/bindings');
const time = require('../time');
const { TEST_DAYS, CHECKS, SESSIONS } = require('../config');

const ALLOWED_ROLE_ID = '1537745685846163466';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('เช็ค')
    .setDescription('[แอดมิน] ดูจำนวนคนที่อยู่ในห้องตอนนี้ ของแต่ละวัน')
    .addStringOption((opt) =>
      opt
        .setName('วัน')
        .setDescription('เลือกวันที่จะเช็ค')
        .setRequired(true)
        .addChoices(...TEST_DAYS.map((d) => ({ name: d.label, value: d.key })))
    ),

  async execute(interaction) {
    if (!interaction.member.roles.cache.has(ALLOWED_ROLE_ID)) {
      return interaction.reply({ content: 'คำสั่งนี้ใช้ได้เฉพาะแอดมินครับ', ephemeral: true });
    }

    const day = TEST_DAYS.find((d) => d.key === interaction.options.getString('วัน'));
    const sessionKeys = [
      ...new Set(
        day.checkKeys.flatMap((ck) => CHECKS.find((c) => c.key === ck).sessionKeys)
      ),
    ];

    const lines = [`เช็คห้องของ **${day.label}** ตอนนี้ (${time.timeLabel()})`, ''];

    for (const sessionKey of sessionKeys) {
      const session = SESSIONS.find((s) => s.key === sessionKey);
      const channel = interaction.guild.channels.cache.get(session.channelIds[0]);
      const members = channel ? [...channel.members.values()] : [];

      lines.push(`**${session.label}** — ${members.length} คน`);
      if (members.length === 0) {
        lines.push('(ไม่มีใครอยู่ในห้อง)');
      } else {
        for (const member of members) {
          const gameName = bindings.getNameByUserId(member.id);
          lines.push(`• ${gameName || '(ไม่ได้ผูกชื่อ)'} (${member.user.tag})`);
        }
      }
      lines.push('');
    }

    return interaction.reply({ content: lines.join('\n').trim(), ephemeral: true });
  },
};
