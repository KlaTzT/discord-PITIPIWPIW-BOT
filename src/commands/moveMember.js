const { SlashCommandBuilder, ChannelType } = require('discord.js');

const ALLOWED_ROLE_ID = '1537745685846163466';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ย้าย')
    .setDescription('[แอดมิน] ย้ายทุกคนในห้องเสียงหนึ่งไปอีกห้อง')
    .addChannelOption((opt) =>
      opt
        .setName('จาก')
        .setDescription('ห้องเสียงต้นทาง (ย้ายทุกคนที่อยู่ในนี้)')
        .addChannelTypes(ChannelType.GuildVoice)
        .setRequired(true)
    )
    .addChannelOption((opt) =>
      opt.setName('ไป').setDescription('ห้องเสียงปลายทาง').addChannelTypes(ChannelType.GuildVoice).setRequired(true)
    ),

  async execute(interaction) {
    if (!interaction.member.roles.cache.has(ALLOWED_ROLE_ID)) {
      return interaction.reply({ content: 'คำสั่งนี้ใช้ได้เฉพาะแอดมินครับ', ephemeral: true });
    }

    const fromChannel = interaction.options.getChannel('จาก');
    const toChannel = interaction.options.getChannel('ไป');

    if (fromChannel.id === toChannel.id) {
      return interaction.reply({ content: 'ห้องต้นทางกับปลายทางเป็นห้องเดียวกันครับ', ephemeral: true });
    }

    const channel = interaction.guild.channels.cache.get(fromChannel.id);
    const members = channel ? [...channel.members.values()] : [];

    if (members.length === 0) {
      return interaction.reply({ content: `ตอนนี้ไม่มีใครอยู่ในห้อง **${fromChannel.name}** ครับ`, ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    let moved = 0;
    const failed = [];
    for (const member of members) {
      try {
        await member.voice.setChannel(toChannel);
        moved += 1;
      } catch (err) {
        failed.push(member.user.tag);
      }
    }

    const failNote = failed.length > 0 ? `\nย้ายไม่สำเร็จ ${failed.length} คน: ${failed.join(', ')}` : '';
    return interaction.editReply(
      `ย้ายจาก **${fromChannel.name}** ไป **${toChannel.name}** สำเร็จ ${moved}/${members.length} คนครับ${failNote}`
    );
  },
};
