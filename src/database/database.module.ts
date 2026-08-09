import { Global, Inject, Injectable, Module, type DynamicModule, type OnApplicationShutdown } from '@nestjs/common';

import { createDatabaseHandle, type AxiomDatabase, type DatabaseHandle } from './client';

export const DATABASE = Symbol('AXIOM_DATABASE');
export const DATABASE_HANDLE = Symbol('AXIOM_DATABASE_HANDLE');

@Injectable()
class DatabaseLifecycle implements OnApplicationShutdown {
  constructor(@Inject(DATABASE_HANDLE) private readonly handle: DatabaseHandle) {}

  async onApplicationShutdown(): Promise<void> {
    await this.handle.pool.end();
  }
}

@Global()
@Module({})
export class DatabaseModule {
  static forRoot(url?: string): DynamicModule {
    const handle = createDatabaseHandle(url);

    return {
      module: DatabaseModule,
      providers: [
        { provide: DATABASE_HANDLE, useValue: handle },
        { provide: DATABASE, useValue: handle.db satisfies AxiomDatabase },
        DatabaseLifecycle
      ],
      exports: [DATABASE, DATABASE_HANDLE]
    };
  }
}
