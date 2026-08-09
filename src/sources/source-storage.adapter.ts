import { createHash } from 'node:crypto';
import { mkdir, open, readFile } from 'node:fs/promises';
import { basename, join, relative, resolve } from 'node:path';

export const SOURCE_STORAGE = Symbol('AXIOM_SOURCE_STORAGE');

export interface SourceStorage {
  putImmutable(input: { organizationId: string; projectId: string; sourceId: string; name: string; content: Buffer; sha256: string }): Promise<string>;
}

function safeSegment(value: string): string {
  const cleaned = basename(value).replace(/[^a-zA-Z0-9._-]+/gu, '-').replace(/^-+|-+$/gu, '');
  return cleaned || 'source';
}

export class LocalSourceStorage implements SourceStorage {
  private readonly root = resolve(process.env.AXIOM_LOCAL_SOURCE_ROOT ?? join(process.cwd(), '.axiom-data', 'sources'));

  async putImmutable(input: Parameters<SourceStorage['putImmutable']>[0]): Promise<string> {
    const directory = resolve(this.root, safeSegment(input.organizationId), safeSegment(input.projectId), safeSegment(input.sourceId));
    const path = resolve(directory, safeSegment(input.name));
    if (relative(this.root, path).startsWith('..')) throw new Error('Source path escaped the configured storage root');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    try {
      const handle = await open(path, 'wx', 0o600);
      try {
        await handle.writeFile(input.content);
        await handle.sync();
      } finally {
        await handle.close();
      }
    } catch (cause) {
      if (!(cause instanceof Error) || !('code' in cause) || cause.code !== 'EEXIST') throw cause;
      const existing = await readFile(path);
      const hash = createHash('sha256').update(existing).digest('hex');
      if (hash !== input.sha256) throw new Error('Immutable source storage path already contains different content');
    }
    return relative(this.root, path);
  }
}
