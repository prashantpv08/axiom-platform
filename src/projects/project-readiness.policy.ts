import { z } from 'zod';

export const ReadinessCategoryKeySchema = z.enum([
  'FUNCTIONAL_SCOPE',
  'NFR',
  'DATA',
  'INTEGRATION',
  'FAILURE_HANDLING',
  'SECURITY_PRIVACY',
  'TESTABILITY',
  'DELIVERY'
]);

export const ProjectReadinessSchema = z.object({
  score: z.number().int().min(0).max(100),
  rawScore: z.number().int().min(0).max(100),
  categories: z.array(z.object({
    key: ReadinessCategoryKeySchema,
    label: z.string().min(1),
    score: z.number().int().nonnegative(),
    maximum: z.number().int().positive(),
    explanation: z.string().min(1),
    openGapIds: z.array(z.string().min(1))
  }).strict()).length(8),
  openBlockerIds: z.array(z.string().min(1)),
  caps: z.array(z.string().min(1)),
  calculatedAt: z.iso.datetime()
}).strict();

export type ProjectReadiness = z.infer<typeof ProjectReadinessSchema>;

const READINESS_WEIGHTS = [
  { key: 'FUNCTIONAL_SCOPE', label: 'Functional scope', maximum: 20 },
  { key: 'NFR', label: 'Non-functional requirements', maximum: 20 },
  { key: 'DATA', label: 'Data', maximum: 8 },
  { key: 'INTEGRATION', label: 'Integrations', maximum: 7 },
  { key: 'FAILURE_HANDLING', label: 'Error and edge cases', maximum: 15 },
  { key: 'SECURITY_PRIVACY', label: 'Security and privacy', maximum: 10 },
  { key: 'TESTABILITY', label: 'Testability', maximum: 10 },
  { key: 'DELIVERY', label: 'Delivery constraints', maximum: 10 }
] as const;

type ReadinessEntity = Readonly<{ category: string; truthStatus: string }>;
type ReadinessGap = Readonly<{ id: string; category: string; severity: string; status: string }>;

export function calculateProjectReadiness(input: {
  entities: ReadonlyArray<ReadinessEntity>;
  gaps: ReadonlyArray<ReadinessGap>;
  calculatedAt: string;
}): ProjectReadiness {
  const open = input.gaps.filter((gap) => gap.status === 'OPEN');
  const categories = READINESS_WEIGHTS.map(({ key, label, maximum }) => {
    const openGaps = open.filter((gap) => gap.category === key);
    const hasGroundedSignal = key === 'FUNCTIONAL_SCOPE'
      ? input.entities.some((entity) => entity.category === 'REQUIREMENT' && entity.truthStatus === 'SOURCE_GROUNDED')
      : key === 'NFR' || key === 'SECURITY_PRIVACY'
        ? input.entities.some((entity) => entity.category === 'NFR' && entity.truthStatus === 'SOURCE_GROUNDED')
        : key === 'DELIVERY'
          ? input.entities.some((entity) => entity.category === 'CONSTRAINT' && entity.truthStatus === 'SOURCE_GROUNDED')
          : input.entities.some((entity) => entity.truthStatus === 'SOURCE_GROUNDED');
    const base = hasGroundedSignal ? Math.round(maximum * 0.45) : Math.round(maximum * 0.2);
    return {
      key,
      label,
      score: openGaps.length === 0 ? maximum : Math.min(maximum - 1, base),
      maximum,
      explanation: openGaps.length === 0
        ? 'No unresolved gap remains in this category.'
        : `${openGaps.length} unresolved gap${openGaps.length === 1 ? '' : 's'} limits readiness.`,
      openGapIds: openGaps.map((gap) => gap.id)
    };
  });
  const rawScore = categories.reduce((total, category) => total + category.score, 0);
  const openBlockerIds = open.filter((gap) => gap.severity === 'BLOCKER').map((gap) => gap.id);
  const caps: string[] = [];
  let score = rawScore;
  if (openBlockerIds.length > 0) {
    score = Math.min(score, 69);
    caps.push('Open blocker caps readiness at 69.');
  }
  if (open.some((gap) => gap.category === 'SECURITY_PRIVACY')) {
    score = Math.min(score, 79);
    caps.push('Unknown P0 security or privacy decision caps readiness at 79.');
  }
  return ProjectReadinessSchema.parse({ score, rawScore, categories, openBlockerIds, caps, calculatedAt: input.calculatedAt });
}
