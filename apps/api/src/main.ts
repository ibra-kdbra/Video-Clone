import 'reflect-metadata';
import { createApp } from './bootstrap.js';
import { loadConfig } from './config/app-config.js';

const config = loadConfig();
const app = await createApp(config);
await app.listen({ host: config.host, port: config.port });
