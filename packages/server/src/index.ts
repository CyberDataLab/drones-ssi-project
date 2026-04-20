import express from 'express';
import * as https from 'https';
import * as fs from 'fs';
import * as bcrypt from 'bcryptjs';

import { CONFIG } from './config/env';
import { BlockchainService } from './services/blockchain';
import { SSIService } from './services/ssi';
import { setupRoutes } from './rest/api';

async function initializeUsers() {
  if (fs.existsSync(CONFIG.USER_FILE) && JSON.parse(fs.readFileSync(CONFIG.USER_FILE, 'utf-8')).length > 0) return;

  console.log('🔐 Creating default admin user...');
  const adminUser = { username: 'admin', passwordHash: await bcrypt.hash('admin', 10), role: 'admin' };
  fs.writeFileSync(CONFIG.USER_FILE, JSON.stringify([adminUser], null, 2));
}

async function startServer() {
  console.log('🖥️ Initializing Server...');
  await initializeUsers();

  if (!fs.existsSync(CONFIG.DATASET_FILE)) {
    fs.writeFileSync(CONFIG.DATASET_FILE, 'timestamp,did,battery,altitude,temperature\n');
  }

  const bcService = new BlockchainService();
  try {
    await bcService.connect();
  } catch (e) {
    process.exit(1);
  }

  const ssiService = new SSIService();
  await ssiService.initialize();

  const app = express();
  app.use(express.json());
  // Use raw text parser specifically for DIDComm messages
  app.use('/messaging', express.text({ type: '*/*' }));
  app.use(express.static(CONFIG.PUBLIC_DIR));

  // Mount Routes
  app.use('/', setupRoutes(bcService, ssiService));

  const httpsOptions = {
    key: fs.readFileSync(CONFIG.SSL_KEY),
    cert: fs.readFileSync(CONFIG.SSL_CERT)
  };

  https.createServer(httpsOptions, app).listen(CONFIG.PORT, '0.0.0.0', () => {
    console.log(`\n🔒 Server available on port ${CONFIG.PORT}`);
    console.log(`   ➜ Dashboard: https://localhost:${CONFIG.PORT}`);
  });
}

startServer().catch(err => console.error('❌ Fatal start error:', err));