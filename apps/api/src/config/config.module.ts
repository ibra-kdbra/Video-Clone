import { type DynamicModule, Global, Module } from '@nestjs/common';
import { AppConfig } from './app-config.js';

@Global()
@Module({})
export class ConfigModule {
  static forRoot(config: AppConfig): DynamicModule {
    return { module: ConfigModule, providers: [{ provide: AppConfig, useValue: config }], exports: [AppConfig] };
  }
}
