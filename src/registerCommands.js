const { REST, Routes } = require('discord.js');
const commands = require('./commands');
const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID } = require('./config');

async function main() {
  if (!DISCORD_TOKEN || !CLIENT_ID || !GUILD_ID) {
    throw new Error('ต้องตั้งค่า DISCORD_TOKEN, CLIENT_ID, GUILD_ID ใน .env ก่อน');
  }
  const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
  const body = commands.map((c) => c.data.toJSON());
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body });
  console.log(`ลงทะเบียน ${body.length} slash commands กับ guild ${GUILD_ID} เรียบร้อยครับ`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
