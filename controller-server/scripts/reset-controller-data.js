require('dotenv').config();
const mongoose = require('mongoose');
const CONFIRMATION = 'DELETE_ZYROX_CONTROLLER_DATA';
async function main() {
  if (process.env.RESET_CONFIRM !== CONFIRMATION) throw new Error(`Refusing reset. Use RESET_CONFIRM=${CONFIRMATION}`);
  const mongoUri = process.env.MONGODB_URI; const dbName = process.env.MONGODB_DB || 'zyrox_controller';
  if (!mongoUri) throw new Error('MONGODB_URI required');
  if (dbName === 'terabox_bot') throw new Error('Refusing to reset terabox_bot. Use zyrox_controller.');
  await mongoose.connect(mongoUri, { dbName, serverSelectionTimeoutMS: 15000 });
  const names = (await mongoose.connection.db.listCollections().toArray()).map((x) => x.name).filter((name) => name.startsWith('zyrox_'));
  for (const name of names) { await mongoose.connection.db.collection(name).deleteMany({}); console.log(`Cleared ${dbName}.${name}`); }
  await mongoose.disconnect(); console.log('Controller data reset complete.');
}
main().catch(async (error) => { console.error(error.message); await mongoose.disconnect().catch(() => null); process.exit(1); });
