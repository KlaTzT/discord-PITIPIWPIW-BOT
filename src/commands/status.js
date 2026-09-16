const { SlashCommandBuilder } = require('discord.js');
const bindings = require('../features/bindings');
const leaveManager = require('../features/leaveManager');
const attendanceTracker = require('../features/attendanceTracker');
const time = require('../time');
const { LEAVE_RULES } = require('../config');

module.exports = {
  data: new SlashCommandBuilder().setName('สถานะ').setDescription('เช็คสถานะลา/ขาด/ใบเตือนของตัวเองเดือนนี้'),

  async execute(interaction) {
    const userId = interaction.user.id;
    const gameName = bindings.getNameByUserId(userId);
    if (!gameName) {
      return interaction.reply({ content: 'บัญชีนี้ยังไม่ได้ผูกชื่อเกม ใช้คำสั่ง /ผูก ก่อนครับ', ephemeral: true });
    }

    const monthKey = time.monthKey();
    const leave = leaveManager.getStatus(userId, monthKey);
    const record = attendanceTracker.getMonthlyRecord(userId, monthKey);

    const lines = [`📋 สถานะของ **${gameName}** เดือน ${monthKey}`, ''];

    const remaining = Math.max(0, LEAVE_RULES.MAX_LEAVES_PER_MONTH - leave.count);
    lines.push(`**ลากิจ**: ${leave.count}/${LEAVE_RULES.MAX_LEAVES_PER_MONTH} ครั้ง (เหลือ ${remaining} ครั้ง)`);
    if (leave.history.length === 0) {
      lines.push('  (ยังไม่มี)');
    } else {
      for (const h of leave.history) {
        const labelPart = h.label ? ` (${h.label})` : '';
        lines.push(`  • ${time.formatThaiDate(h.warDate)}${labelPart} — ${h.late ? 'แจ้งหลัง 15:00 ⚠️' : 'แจ้งก่อน 15:00 ✅'}`);
      }
    }

    lines.push('', `**ขาด (ไม่แจ้งลา)**: ${record.totalAbsent} ครั้ง`);
    if (record.absences.length === 0) {
      lines.push('  (ยังไม่มี)');
    } else {
      for (const a of record.absences) {
        lines.push(`  • ${time.formatThaiDate(a.date)} — ${a.checkLabel}`);
      }
    }

    lines.push('', `**ใบเตือน**: ${leave.warnings} ใบ`);
    if (leave.lateCount > 0) lines.push(`  • ลาสาย (หลัง 15:00): ${leave.lateCount} ใบ`);
    if (leave.absenceWarnings > 0) lines.push(`  • ขาดครบ 3 ครั้ง/เดือน (อัตโนมัติ): ${leave.absenceWarnings} ใบ`);
    if (leave.manualWarnings > 0) lines.push(`  • แอดมินให้ตรงๆ: ${leave.manualWarnings} ใบ`);

    const status = leave.redCard ? '🔴 ใบแดง' : leave.warnings > 0 ? '🟡 มีใบเตือน' : '🟢 ปกติ';
    lines.push('', `**สถานะ**: ${status}`);
    if (leave.overQuota) lines.push('  (เกินโควตาลา ทำให้ได้ใบแดงอัตโนมัติ)');
    if (leave.manualRedCard) lines.push('  (มีใบแดงที่แอดมินให้ตรงๆ ด้วย)');

    return interaction.reply({ content: lines.join('\n'), ephemeral: true });
  },
};
