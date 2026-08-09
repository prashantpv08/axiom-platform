import { and, desc, eq } from 'drizzle-orm';

import type { AxiomDatabase } from '../database/client';
import { arbDecisions, architectureGenerations } from '../database/schema';
import { ArchitectureDecisionSchema, ArchitectureGenerationSchema } from './architecture.schema';

export async function currentArchitectureDecision(executor: Pick<AxiomDatabase, 'select'>, organizationId: string, projectId: string, graphVersion: number) {
  const generationRows = await executor.select().from(architectureGenerations).where(and(
    eq(architectureGenerations.organizationId, organizationId), eq(architectureGenerations.projectId, projectId), eq(architectureGenerations.graphVersion, graphVersion)
  )).orderBy(desc(architectureGenerations.version), desc(architectureGenerations.createdAt));
  const generation = generationRows.flatMap((row) => {
    const parsed = ArchitectureGenerationSchema.safeParse(row.payload);
    return parsed.success && parsed.data.id === row.id && parsed.data.contentHash === row.contentHash ? [parsed.data] : [];
  })[0] ?? null;
  if (generation === null) return { generation: null, decision: null };
  const decisionRows = await executor.select({ payload: arbDecisions.payload }).from(arbDecisions).where(and(
    eq(arbDecisions.organizationId, organizationId), eq(arbDecisions.projectId, projectId), eq(arbDecisions.graphVersion, graphVersion)
  )).orderBy(desc(arbDecisions.version), desc(arbDecisions.approvedAt));
  for (const row of decisionRows) {
    const parsed = ArchitectureDecisionSchema.safeParse(row.payload);
    if (!parsed.success || parsed.data.generationId !== generation.id || parsed.data.generationContentHash !== generation.contentHash) continue;
    const selected = generation.options.find((option) => option.id === parsed.data.selectedOptionId);
    if (selected?.sha256 === parsed.data.selectedOptionHash) return { generation, decision: parsed.data };
  }
  return { generation, decision: null };
}
