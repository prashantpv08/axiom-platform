import { ArtifactApprovalSchema, ArtifactHashesSchema, ArtifactTypeSchema, type ArtifactApproval, type ArtifactHashes } from './artifact.schema';

export type ArtifactHashRecord = Readonly<{ type: string; version: number; sha256: string }>;

export function latestArtifactHashes(records: ArtifactHashRecord[]): ArtifactHashes | null {
  const latest = new Map<string, ArtifactHashRecord>();
  for (const record of [...records].sort((left, right) => right.version - left.version)) {
    if (ArtifactTypeSchema.safeParse(record.type).success && !latest.has(record.type)) latest.set(record.type, record);
  }
  const parsed = ArtifactHashesSchema.safeParse(Object.fromEntries(ArtifactTypeSchema.options.flatMap((type) => {
    const record = latest.get(type);
    return record === undefined ? [] : [[type, record.sha256]];
  })));
  return parsed.success ? parsed.data : null;
}

export function findExactArtifactApproval(payloads: unknown[], hashes: ArtifactHashes | null): ArtifactApproval | null {
  if (hashes === null) return null;
  for (const payload of payloads) {
    const approval = ArtifactApprovalSchema.safeParse(payload);
    if (approval.success && JSON.stringify(approval.data.documentHashes) === JSON.stringify(hashes)) return approval.data;
  }
  return null;
}
