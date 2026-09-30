import 'reflect-metadata';
import { ConsoleLogger, type LogLevel } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { loadConfig } from './config.js';
import { WorkerModule } from './worker.module.js';

const LEVELS: LogLevel[] = ['fatal', 'error', 'warn', 'log', 'debug', 'verbose'];
const config = loadConfig();
const logger = new ConsoleLogger('Worker', {
  json: config.NODE_ENV === 'production',
  logLevels: LEVELS.slice(0, LEVELS.indexOf(config.LOG_LEVEL) + 1),
});

const app = await NestFactory.createApplicationContext(WorkerModule.forRoot(config), { logger });
app.enableShutdownHooks();
logger.log('Worker started: relaying the outbox and processing jobs');
