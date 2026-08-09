import { createHash } from 'node:crypto';

import {
  ARCHITECTURE_COMPILER_VERSION,
  ArchitectureArtifactSchema,
  ArchitectureGenerationSchema,
  ArchitectureOptionSchema,
  type ArchitectureArtifact,
  type ArchitectureDecision,
  type ArchitectureGeneration,
  type ArchitectureOption
} from './architecture.schema';

type EntityInput = { id: string; category: string; text: string; truthStatus: string };
type GapInput = { id: string; title: string; status: string; truthStatus: string };

type CompileArchitectureInput = {
  generationId: string;
  generationVersion: number;
  projectId: string;
  projectName: string;
  graphVersion: number;
  graphSummary: string;
  entities: EntityInput[];
  gaps: GapInput[];
  requirementDocumentHashes: { requirements: string; srs: string; nfr: string };
  generatedAt: string;
};

function sha256(value: unknown): string {
  return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value), 'utf8').digest('hex');
}

function stableOptionId(projectId: string, profile: string): string {
  return `ARCHOPT-${sha256(projectId).slice(0, 16).toUpperCase()}-${profile}`;
}

function option(input: CompileArchitectureInput, profile: 'LEAN' | 'BALANCED' | 'DISTRIBUTED', definition: Omit<ArchitectureOption, 'id' | 'generationId' | 'projectId' | 'graphVersion' | 'generationVersion' | 'profile' | 'sourceEntityIds' | 'truthStatus' | 'sha256'>): ArchitectureOption {
  const withoutHash = {
    id: stableOptionId(input.projectId, profile), generationId: input.generationId, projectId: input.projectId,
    graphVersion: input.graphVersion, generationVersion: input.generationVersion, profile, ...definition,
    sourceEntityIds: input.entities.filter((entity) => entity.truthStatus === 'SOURCE_GROUNDED' || entity.truthStatus === 'HUMAN_CONFIRMED').map((entity) => entity.id),
    truthStatus: 'AI_SUGGESTED' as const
  };
  return ArchitectureOptionSchema.parse({ ...withoutHash, sha256: sha256(withoutHash) });
}

const unknownCost = {
  range: 'UNKNOWN' as const,
  basis: 'No measured workload, provider price, region, retention, availability target, or production usage evidence is approved for a defensible monetary range.',
  truthStatus: 'UNKNOWN' as const
};

export function compileArchitectureGeneration(input: CompileArchitectureInput): ArchitectureGeneration {
  const sharedFlow = [
    'An authenticated request enters an organization-scoped API boundary and is validated before domain processing.',
    'Domain rules read and update canonical state in PostgreSQL inside explicit transaction boundaries.',
    'Long or retryable work is handed to a durable worker boundary and records an inspectable terminal state.'
  ];
  const options = [
    option(input, 'LEAN', {
      name: 'Lean single-deployable application',
      summary: 'One deployable application with internal modules and PostgreSQL, optimized for the shortest delivery path and the fewest operating components.',
      deploymentModel: 'One application deployment and one PostgreSQL database; background work remains in-process until a measured durability need is approved.',
      components: [
        { name: 'Application', responsibility: 'Owns validated API, domain modules, authorization, and synchronous application workflows.' },
        { name: 'PostgreSQL', responsibility: 'Stores canonical organization-scoped state, versions, approvals, idempotency records, and audit history.' }
      ],
      dataFlows: sharedFlow.slice(0, 2),
      technologies: ['Application runtime — UNKNOWN until explicitly approved', 'PostgreSQL'],
      why: ['Minimizes deployment and operational surfaces while requirements and workload evidence are still developing.', 'Keeps transactions straightforward for workflows that share one consistency boundary.'],
      whyNot: ['In-process background work is unsuitable once durable retries, isolation, or independent scaling becomes a demonstrated requirement.', 'A single deployment can increase release coupling when module ownership or availability needs diverge.'],
      assumptions: ['The approved workload fits one application scaling boundary.', 'Background operations can remain short or be deferred until a durable-worker decision is made.'],
      risks: ['A long-running operation can consume application capacity and delay interactive requests.', 'Weak internal boundaries can turn a lean deployment into a tightly coupled codebase.'],
      failureModes: [
        { failure: 'The application process becomes unavailable during an in-process operation.', mitigation: 'Persist intent before execution and introduce a durable worker before claiming retry safety.' },
        { failure: 'Database contention slows interactive operations.', mitigation: 'Measure query and lock behavior, add indexes, and separate workloads only when evidence identifies the bottleneck.' }
      ],
      estimatedCost: unknownCost,
      reconsiderationTriggers: [
        { metric: 'Background-operation recovery', condition: 'Reconsider when an approved workflow must survive application restarts or needs bounded retry and cancellation.' },
        { metric: 'Deployment coupling', condition: 'Reconsider when independently owned modules require materially different release or availability policies.' }
      ],
      scoreBreakdown: {
        deliverySpeed: { score: 5, rationale: 'Few infrastructure components reduce initial delivery coordination.' },
        operationalSimplicity: { score: 5, rationale: 'One application and one database create the smallest operating surface.' },
        scalability: { score: 2, rationale: 'The whole application scales together and in-process work shares capacity.' },
        reliability: { score: 2, rationale: 'Durable asynchronous recovery is not included in this option.' },
        costPredictability: { score: 3, rationale: 'Component count is low, but a monetary range remains UNKNOWN without workload and provider evidence.' }
      }
    }),
    option(input, 'BALANCED', {
      name: 'Modular platform with durable worker',
      summary: 'One modular platform codebase deployed as an API process and a worker process, backed by PostgreSQL and a durable queue.',
      deploymentModel: 'Independently scalable API and worker processes share versioned domain modules, PostgreSQL, and a durable job adapter.',
      components: [
        { name: 'Web/API process', responsibility: 'Owns authenticated request validation, application services, exact previews, and short transactional mutations.' },
        { name: 'Worker process', responsibility: 'Executes durable long-running workflows with bounded retries, timeouts, cancellation, and terminal evidence.' },
        { name: 'Durable job adapter', responsibility: 'Persists queued work and retry state without relying on a browser or API process remaining alive.' },
        { name: 'PostgreSQL', responsibility: 'Stores canonical organization-scoped state, versions, approvals, audit, idempotency, and workflow results.' }
      ],
      dataFlows: sharedFlow,
      technologies: ['Application runtime — UNKNOWN until explicitly approved', 'PostgreSQL', 'Durable queue adapter — provider UNKNOWN until deployment approval'],
      why: ['Separates interactive and long-running capacity without introducing network services for each domain module.', 'Preserves one transactional source of truth while giving workers independent concurrency and failure controls.'],
      whyNot: ['Adds queue operations, worker deployment, and asynchronous-state UX before every project necessarily needs them.', 'API and worker releases remain coupled to one platform version even though their processes scale separately.'],
      assumptions: ['At least one workflow benefits from durable execution or independent worker concurrency.', 'The domain modules can share one PostgreSQL consistency boundary at the approved scale.'],
      risks: ['A poorly designed job contract can create duplicate work or invisible stuck states.', 'Worker and API schema-version mismatch can break queued work during deployment.'],
      failureModes: [
        { failure: 'A worker stops after taking a job but before recording completion.', mitigation: 'Use idempotent handlers, leases, bounded retries, and durable terminal states.' },
        { failure: 'Queue delay grows while interactive traffic remains healthy.', mitigation: 'Measure queue age and depth, bound concurrency, and scale worker processes independently.' }
      ],
      estimatedCost: unknownCost,
      reconsiderationTriggers: [
        { metric: 'Module scaling divergence', condition: 'Reconsider when one domain repeatedly needs independent scaling or availability beyond the shared platform boundary.' },
        { metric: 'Queue age', condition: 'Reconsider worker concurrency and service boundaries when measured queue-age objectives are missed under the approved load profile.' }
      ],
      scoreBreakdown: {
        deliverySpeed: { score: 4, rationale: 'A shared codebase preserves delivery speed while adding one explicit asynchronous boundary.' },
        operationalSimplicity: { score: 4, rationale: 'Two processes and one queue are more involved than a single deployable but remain bounded.' },
        scalability: { score: 4, rationale: 'Interactive and worker capacity can scale independently without domain microservices.' },
        reliability: { score: 4, rationale: 'Durable jobs support retries, cancellation, and restart recovery when implemented with idempotency.' },
        costPredictability: { score: 3, rationale: 'The component model is bounded, but actual cost remains UNKNOWN without provider and workload evidence.' }
      }
    }),
    option(input, 'DISTRIBUTED', {
      name: 'Independently deployed domain services',
      summary: 'Multiple networked domain services with event-driven coordination, selected only when measured scaling, isolation, or ownership triggers justify the added complexity.',
      deploymentModel: 'Independently deployed services communicate through versioned APIs and durable events, with explicitly owned data and failure boundaries.',
      components: [
        { name: 'Gateway/API edge', responsibility: 'Authenticates requests, enforces organization context, and routes only versioned service contracts.' },
        { name: 'Domain services', responsibility: 'Own independently deployed domain behavior, availability policies, and explicit data-access boundaries.' },
        { name: 'Event broker', responsibility: 'Carries versioned durable events with replay, deduplication, and dead-letter handling.' },
        { name: 'Data stores', responsibility: 'Implement explicitly owned consistency boundaries and audited cross-service synchronization.' }
      ],
      dataFlows: ['An authenticated request enters the gateway and is routed through a versioned service contract.', 'The owning service commits local state and a transactional event before asynchronous consumers act.', 'Consumers process events idempotently and expose reconciliation when delivery or downstream processing fails.'],
      technologies: ['Service runtime — UNKNOWN until explicitly approved', 'PostgreSQL or another approved service-owned store', 'Durable event broker — provider UNKNOWN until deployment approval'],
      why: ['Supports materially different scaling, isolation, ownership, or deployment needs when those triggers are measured.', 'Explicit event contracts can decouple long-running cross-domain workflows.'],
      whyNot: ['Distributed transactions, contract evolution, retries, observability, and reconciliation create substantial delivery and operating cost.', 'No measured service-extraction trigger is currently stored, so selecting this option would be speculative.'],
      assumptions: ['Multiple domains have proven independent ownership, scale, isolation, or availability requirements.', 'The team can operate versioned contracts, distributed tracing, replay, and reconciliation safely.'],
      risks: ['Eventual consistency can present stale or conflicting states without explicit user-facing reconciliation.', 'Network and broker failures multiply retry, timeout, ordering, and duplication paths.'],
      failureModes: [
        { failure: 'A service commits state but its event is not delivered.', mitigation: 'Use a transactional outbox, replayable events, idempotent consumers, and reconciliation evidence.' },
        { failure: 'A versioned contract changes incompatibly while consumers lag.', mitigation: 'Use compatibility tests, additive evolution, consumer inventory, and controlled deprecation.' }
      ],
      estimatedCost: unknownCost,
      reconsiderationTriggers: [
        { metric: 'Service-extraction evidence', condition: 'Select only when measured scaling, isolation, ownership, latency, or consistency evidence satisfies an approved extraction trigger.' },
        { metric: 'Operational readiness', condition: 'Do not select until service ownership, on-call, tracing, contract testing, and reconciliation responsibilities are approved.' }
      ],
      scoreBreakdown: {
        deliverySpeed: { score: 1, rationale: 'Multiple contracts and deployments add coordination before feature delivery.' },
        operationalSimplicity: { score: 1, rationale: 'Network, broker, tracing, and reconciliation surfaces are materially larger.' },
        scalability: { score: 5, rationale: 'Services can scale independently when ownership and data boundaries are valid.' },
        reliability: { score: 3, rationale: 'Isolation can improve resilience, while distributed failure paths require stronger operations.' },
        costPredictability: { score: 1, rationale: 'Component and traffic interactions are broad and cost remains UNKNOWN without measurements.' }
      }
    })
  ];
  const contentHash = sha256(options.map((candidate) => ({ id: candidate.id, sha256: candidate.sha256 })));
  return ArchitectureGenerationSchema.parse({
    id: input.generationId, projectId: input.projectId, graphVersion: input.graphVersion,
    version: input.generationVersion, contentHash, compilerVersion: ARCHITECTURE_COMPILER_VERSION,
    recommendedOptionId: stableOptionId(input.projectId, 'BALANCED'),
    recommendationBasis: 'The balanced option is an AI suggestion because it adds durable execution without assuming a measured trigger for domain microservices. Human approval may select any option.',
    requirementDocumentHashes: input.requirementDocumentHashes, options, generatedAt: input.generatedAt
  });
}

function markdownList(values: string[]): string {
  return values.map((value) => `- ${value}`).join('\n');
}

function artifact(input: { projectId: string; graphVersion: number; type: 'hld' | 'adr'; version: number; title: string; content: string; decision: ArchitectureDecision; generatedAt: string }): ArchitectureArtifact {
  const content = `${input.content}\n\n## Deterministic provenance\n- Generation ID: ${input.decision.generationId}\n- Decision ID: ${input.decision.id}\n- Selected option ID: ${input.decision.selectedOptionId}\n`;
  const sha = sha256(content);
  return ArchitectureArtifactSchema.parse({
    id: `DOC-${input.projectId}-${input.type}`, projectId: input.projectId, type: input.type, version: input.version,
    sourceGraphVersion: input.graphVersion, title: input.title, content, sha256: sha,
    truthStatus: 'HUMAN_APPROVED', provenance: {
      mode: 'DETERMINISTIC_COMPILER', compilerVersion: ARCHITECTURE_COMPILER_VERSION,
      generationId: input.decision.generationId, decisionId: input.decision.id, selectedOptionId: input.decision.selectedOptionId
    }, generatedAt: input.generatedAt
  });
}

export function compileApprovedArchitectureArtifacts(input: { projectName: string; generation: ArchitectureGeneration; decision: ArchitectureDecision; versions: { hld: number; adr: number }; generatedAt: string }): ArchitectureArtifact[] {
  const selected = input.generation.options.find((candidate) => candidate.id === input.decision.selectedOptionId);
  if (selected === undefined) throw new Error('Selected architecture option is absent from the exact generation');
  const alternatives = input.generation.options.filter((candidate) => candidate.id !== selected.id);
  const hld = `# High-Level Design — ${input.projectName}\n\n## Document control\n- Graph version: ${input.generation.graphVersion}\n- Architecture generation: ${input.generation.id} v${input.generation.version}\n- Generation hash: ${input.generation.contentHash}\n- Decision: ${input.decision.id}\n- Truth status: HUMAN_APPROVED\n- Compiler: ${ARCHITECTURE_COMPILER_VERSION}\n\n## Approved architecture\n### ${selected.name}\n${selected.summary}\n\n**Deployment model:** ${selected.deploymentModel}\n\n## Components\n| Component | Responsibility |\n|---|---|\n${selected.components.map((component) => `| ${component.name} | ${component.responsibility} |`).join('\n')}\n\n## Primary data flow\n${selected.dataFlows.map((flow, index) => `${index + 1}. ${flow}`).join('\n')}\n\n## Technology decisions\n${markdownList(selected.technologies)}\n\n## Failure modes\n${selected.failureModes.map((failure) => `- **${failure.failure}** — ${failure.mitigation}`).join('\n')}\n\n## Risks\n${markdownList(selected.risks)}\n\n## Assumptions\n${markdownList(selected.assumptions)}\n\n## Cost\n- Range: ${selected.estimatedCost.range}\n- Evidence status: ${selected.estimatedCost.truthStatus}\n- Basis: ${selected.estimatedCost.basis}\n\n## Reconsideration triggers\n${selected.reconsiderationTriggers.map((trigger) => `- **${trigger.metric}:** ${trigger.condition}`).join('\n')}\n\n## Accessible traceability\n- Requirement artifact hashes: ${JSON.stringify(input.generation.requirementDocumentHashes)}\n- Selected option hash: ${selected.sha256}\n- Approval rationale: ${input.decision.comment}\n`;
  const adr = `# Architecture Decision Record — ${input.projectName}\n\n## Status\nHUMAN_APPROVED\n\n## Decision\nSelect **${selected.name}** (${selected.id}) from exact generation ${input.generation.id} (${input.generation.contentHash}).\n\n## Human rationale\n${input.decision.comment}\n\n## Why\n${markdownList(selected.why)}\n\n## Why not\n${markdownList(selected.whyNot)}\n\n## Rejected alternatives\n${alternatives.map((candidate) => `### ${candidate.name}\n${markdownList(candidate.whyNot)}`).join('\n\n')}\n\n## Assumptions\n${markdownList(selected.assumptions)}\n\n## Risks and failure modes\n${markdownList(selected.risks)}\n${selected.failureModes.map((failure) => `- ${failure.failure}: ${failure.mitigation}`).join('\n')}\n\n## Cost range\n- ${selected.estimatedCost.range} (${selected.estimatedCost.truthStatus})\n- ${selected.estimatedCost.basis}\n\n## Reconsideration triggers\n${selected.reconsiderationTriggers.map((trigger) => `- ${trigger.metric}: ${trigger.condition}`).join('\n')}\n\n## Approval evidence\n- Decision ID: ${input.decision.id}\n- Decision version: ${input.decision.version}\n- Approved by: ${input.decision.approvedByUserId}\n- Approved at: ${input.decision.approvedAt}\n- Selected option hash: ${input.decision.selectedOptionHash}\n`;
  return [
    artifact({ projectId: input.generation.projectId, graphVersion: input.generation.graphVersion, type: 'hld', version: input.versions.hld, title: 'High-Level Design', content: hld, decision: input.decision, generatedAt: input.generatedAt }),
    artifact({ projectId: input.generation.projectId, graphVersion: input.generation.graphVersion, type: 'adr', version: input.versions.adr, title: 'Architecture Decision Record', content: adr, decision: input.decision, generatedAt: input.generatedAt })
  ];
}
