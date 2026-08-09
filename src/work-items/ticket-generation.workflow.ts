import { z } from 'zod';

import type { GenerationMessage, StructuredOutputContract } from '../agent-kernel/generation.schema';
import type { GenerationContext } from './work-item-generation.repository';
import { WorkItemBatchSchema } from './work-item.schema';

export const TICKET_GENERATION_WORKFLOW = 'ticket-generation';
export const TICKET_GENERATION_WORKFLOW_VERSION = 'ticket-workflow-v1';
export const TICKET_GENERATION_PROMPT_VERSION = 'fixture-grounded-agile-v1';
export const TICKET_GENERATION_MAXIMUM_ATTEMPTS = 2;

export const TICKET_GENERATION_STRUCTURED_OUTPUT: StructuredOutputContract = {
  name: 'axiom_work_item_batch',
  version: 'work-item-v1',
  jsonSchema: z.toJSONSchema(WorkItemBatchSchema, { target: 'draft-7', unrepresentable: 'any' })
};

export function buildTicketGenerationMessages(graph: GenerationContext): GenerationMessage[] {
  return [
    {
      role: 'SYSTEM',
      content: 'Generate a connector-neutral Agile WorkItem v1 backlog only from the supplied approved graph entities. Preserve source IDs, identify critical unknowns, and never claim tool execution or external publication.'
    },
    {
      role: 'USER',
      content: JSON.stringify({
        project: { id: graph.projectId, name: graph.projectName },
        sourceGraphVersion: graph.graphVersion,
        documentApprovalId: graph.documentApprovalId,
        architectureDecisionId: graph.arbDecisionId,
        approvedEntities: graph.entities
      })
    }
  ];
}
