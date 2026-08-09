import { createHash } from 'node:crypto';

import type { ProjectReadiness } from '../projects/project-readiness.policy';
import {
  ARTIFACT_COMPILER_VERSION,
  ArtifactTypeSchema,
  ProjectArtifactSchema,
  type ProjectArtifact
} from './artifact.schema';

export type ArtifactEntity = Readonly<{
  id: string;
  category: string;
  text: string;
  truthStatus: string;
  sourceId: string | null;
  clarificationQuestionId: string | null;
  quote: string | null;
}>;

export type ArtifactGap = Readonly<{
  id: string;
  type: string;
  category: string;
  title: string;
  description: string;
  severity: string;
  status: string;
  truthStatus: string;
}>;

export type ArtifactQuestion = Readonly<{
  id: string;
  gapId: string;
  question: string;
  whyItMatters: string;
  status: string;
  answer: string | null;
  truthStatus: string;
}>;

export type ArtifactSource = Readonly<{
  id: string;
  name: string;
  mimeType: string;
  sha256: string;
  status: string;
}>;

export type ArtifactCompilationInput = Readonly<{
  project: { id: string; workspaceId: string; name: string };
  graphVersion: number;
  summary: string;
  readiness: ProjectReadiness;
  entities: ArtifactEntity[];
  gaps: ArtifactGap[];
  questions: ArtifactQuestion[];
  sources: ArtifactSource[];
  versions: Record<'requirements' | 'srs' | 'nfr', number>;
  generatedAt: string;
}>;

function clean(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll('\n', ' ').trim();
}

function provenance(entity: ArtifactEntity): string {
  if (entity.sourceId !== null) return entity.quote === null ? entity.sourceId : `${entity.sourceId}: “${clean(entity.quote)}”`;
  return entity.clarificationQuestionId ?? 'UNKNOWN';
}

function entityRows(input: ArtifactCompilationInput, category: string): string {
  const entities = input.entities.filter((entity) => entity.category === category);
  if (entities.length === 0) return '| UNKNOWN | UNKNOWN | No confirmed item is available | UNKNOWN |';
  return entities.map((entity) => `| ${entity.id} | ${entity.truthStatus} | ${clean(entity.text)} | ${clean(provenance(entity))} |`).join('\n');
}

function sourceSection(input: ArtifactCompilationInput): string {
  if (input.sources.length === 0) return '- UNKNOWN — no source metadata is available for this graph.';
  return input.sources.map((source) => `- **${source.id}** — ${clean(source.name)} (${source.mimeType}, ${source.status}) — SHA-256: ${source.sha256}`).join('\n');
}

function readinessSection(input: ArtifactCompilationInput): string {
  return `Overall readiness: **${input.readiness.score}/100** (raw ${input.readiness.rawScore}/100)

| Category | Score | Maximum | Open gaps | Explanation |
|---|---:|---:|---|---|
${input.readiness.categories.map((category) => `| ${clean(category.label)} | ${category.score} | ${category.maximum} | ${category.openGapIds.join(', ') || 'None'} | ${clean(category.explanation)} |`).join('\n')}

${input.readiness.caps.length === 0 ? 'No readiness cap is applied.' : input.readiness.caps.map((cap) => `- ${cap}`).join('\n')}`;
}

function gapsSection(input: ArtifactCompilationInput): string {
  if (input.gaps.length === 0) return '| UNKNOWN | UNKNOWN | UNKNOWN | No structured gap is available | UNKNOWN |';
  return input.gaps.map((gap) => `| ${gap.id} | ${gap.severity} | ${gap.status} | ${clean(gap.title)} | ${gap.truthStatus} |`).join('\n');
}

function questionsSection(input: ArtifactCompilationInput): string {
  if (input.questions.length === 0) return '- UNKNOWN — no clarification question is recorded.';
  return input.questions.map((question) => `- **${question.id}** (${question.status}, ${question.truthStatus}) — ${clean(question.question)} Answer: ${question.answer === null ? 'UNKNOWN' : clean(question.answer)}`).join('\n');
}

function control(input: ArtifactCompilationInput, type: string, version: number): string {
  return `| Field | Value |
|---|---|
| Project | ${input.project.id} — ${clean(input.project.name)} |
| Workspace | ${input.project.workspaceId} |
| Artifact | ${type} v${version} |
| Source graph | v${input.graphVersion} |
| Generated | ${input.generatedAt} |
| Compiler | ${ARTIFACT_COMPILER_VERSION} |
| Truth status | AI_SUGGESTED until exact artifact approval |
| Authority | Compiled view; the canonical PostgreSQL graph remains authoritative |`;
}

function requirementsContent(input: ArtifactCompilationInput): string {
  return `# Requirements Catalogue — ${input.project.name}

## Document control
${control(input, 'requirements', input.versions.requirements)}

## Graph summary
${input.summary}

## Source baseline
${sourceSection(input)}

## Readiness
${readinessSection(input)}

## Functional requirements
| ID | Truth status | Statement | Provenance |
|---|---|---|---|
${entityRows(input, 'REQUIREMENT')}

## Non-functional requirements
| ID | Truth status | Statement | Provenance |
|---|---|---|---|
${entityRows(input, 'NFR')}

## Decisions and constraints
| ID | Truth status | Statement | Provenance |
|---|---|---|---|
${[entityRows(input, 'DECISION'), entityRows(input, 'CONSTRAINT')].join('\n')}

## Gap register
| Gap ID | Severity | Status | Title | Truth status |
|---|---|---|---|---|
${gapsSection(input)}

## Clarifications
${questionsSection(input)}
`;
}

function srsContent(input: ArtifactCompilationInput): string {
  return `# Software Requirements Specification — ${input.project.name}

## 1. Document control
${control(input, 'srs', input.versions.srs)}

## 2. Purpose and scope
This deterministic view compiles graph v${input.graphVersion}. Unsupported decisions remain UNKNOWN; approval accepts this exact hash and does not convert graph entities into source-grounded facts.

## 3. Product summary
${input.summary}

## 4. Source baseline
${sourceSection(input)}

## 5. Readiness
${readinessSection(input)}

## 6. Functional requirements
| ID | Truth status | Statement | Provenance |
|---|---|---|---|
${entityRows(input, 'REQUIREMENT')}

## 7. Non-functional requirements
| ID | Truth status | Statement | Provenance |
|---|---|---|---|
${entityRows(input, 'NFR')}

## 8. Decisions
| ID | Truth status | Statement | Provenance |
|---|---|---|---|
${entityRows(input, 'DECISION')}

## 9. Constraints
| ID | Truth status | Statement | Provenance |
|---|---|---|---|
${entityRows(input, 'CONSTRAINT')}

## 10. Risks
| ID | Truth status | Statement | Provenance |
|---|---|---|---|
${entityRows(input, 'RISK')}

## 11. Open decisions
${questionsSection(input)}

## 12. Verification boundary
Acceptance criteria and measured evidence remain UNKNOWN until work-item generation and allowlisted verification execute. This document does not claim test, security, accessibility, performance, or cost results.
`;
}

function nfrContent(input: ArtifactCompilationInput): string {
  return `# Non-Functional Requirements Specification — ${input.project.name}

## Document control
${control(input, 'nfr', input.versions.nfr)}

## Source baseline
${sourceSection(input)}

## Readiness
${readinessSection(input)}

## Confirmed and grounded NFRs
| ID | Truth status | Statement | Provenance |
|---|---|---|---|
${entityRows(input, 'NFR')}

## NFR-related gaps
| Gap ID | Severity | Status | Title | Truth status |
|---|---|---|---|---|
${gapsSection({ ...input, gaps: input.gaps.filter((gap) => ['NFR', 'SECURITY_PRIVACY', 'FAILURE_HANDLING', 'TESTABILITY', 'DELIVERY'].includes(gap.category)) })}

## Evidence boundary
- A metric or threshold appears only when it exists in a source-grounded or human-confirmed graph entity.
- Generated prose is not runtime evidence.
- Verification remains UNKNOWN until an allowlisted command or approved tool produces immutable output.
`;
}

export function compileRequirementBaseline(input: ArtifactCompilationInput): ProjectArtifact[] {
  const contents = {
    requirements: requirementsContent(input),
    srs: srsContent(input),
    nfr: nfrContent(input)
  } as const;
  const sourceEntityIds = input.entities.map((entity) => entity.id);
  const sourceIds = [...new Set(input.entities.flatMap((entity) => entity.sourceId === null ? [] : [entity.sourceId]))];
  return ArtifactTypeSchema.options.map((type) => {
    const content = contents[type].trim();
    return ProjectArtifactSchema.parse({
      id: `DOC-${type.toUpperCase()}-${input.project.id}`,
      projectId: input.project.id,
      type,
      version: input.versions[type],
      sourceGraphVersion: input.graphVersion,
      title: type === 'requirements' ? 'Requirements Catalogue' : type === 'srs' ? 'Software Requirements Specification' : 'Non-Functional Requirements Specification',
      content,
      sha256: createHash('sha256').update(content, 'utf8').digest('hex'),
      truthStatus: 'AI_SUGGESTED',
      provenance: { mode: 'DETERMINISTIC_COMPILER', compilerVersion: ARTIFACT_COMPILER_VERSION, sourceEntityIds, sourceIds },
      generatedAt: input.generatedAt
    });
  });
}
