import { z } from 'zod';

export const ENGINEERING_REFERENCE_CATALOG_VERSION = 'engineering-reference-catalog-2026-07-24' as const;

export const EngineeringReferenceIdSchema = z.enum([
  'OWASP_ASVS_5_0_0',
  'OWASP_API_SECURITY_2023',
  'OWASP_AISVS_1_0',
  'NIST_SSDF_1_1',
  'NIST_AI_RMF_1_0',
  'WCAG_2_2',
  'AWS_WELL_ARCHITECTED',
  'AWS_SAAS_LENS',
  'OPENAPI_3_1',
  'OPENTELEMETRY',
  'POSTGRESQL'
]);
export type EngineeringReferenceId = z.infer<typeof EngineeringReferenceIdSchema>;

export const EngineeringReferenceSchema = z.object({
  id: EngineeringReferenceIdSchema,
  title: z.string().min(3).max(200),
  authority: z.string().min(2).max(100),
  url: z.url(),
  versionLabel: z.string().min(1).max(100)
}).strict();
export type EngineeringReference = z.infer<typeof EngineeringReferenceSchema>;

export const ENGINEERING_REFERENCES: readonly EngineeringReference[] = [
  { id: 'OWASP_ASVS_5_0_0', title: 'Application Security Verification Standard', authority: 'OWASP', url: 'https://owasp.org/www-project-application-security-verification-standard/', versionLabel: '5.0.0' },
  { id: 'OWASP_API_SECURITY_2023', title: 'API Security Top 10', authority: 'OWASP', url: 'https://owasp.org/API-Security/', versionLabel: '2023' },
  { id: 'OWASP_AISVS_1_0', title: 'Artificial Intelligence Security Verification Standard', authority: 'OWASP', url: 'https://owasp.org/www-project-artificial-intelligence-security-verification-standard-aisvs-docs/', versionLabel: '1.0' },
  { id: 'NIST_SSDF_1_1', title: 'Secure Software Development Framework', authority: 'NIST', url: 'https://csrc.nist.gov/pubs/sp/800/218/final', versionLabel: 'SP 800-218 v1.1' },
  { id: 'NIST_AI_RMF_1_0', title: 'AI Risk Management Framework', authority: 'NIST', url: 'https://www.nist.gov/itl/ai-risk-management-framework', versionLabel: '1.0' },
  { id: 'WCAG_2_2', title: 'Web Content Accessibility Guidelines', authority: 'W3C', url: 'https://www.w3.org/TR/WCAG22/', versionLabel: '2.2' },
  { id: 'AWS_WELL_ARCHITECTED', title: 'AWS Well-Architected Framework', authority: 'AWS', url: 'https://docs.aws.amazon.com/wellarchitected/latest/framework/welcome.html', versionLabel: 'assessed 2026-07-24' },
  { id: 'AWS_SAAS_LENS', title: 'AWS Well-Architected SaaS Lens', authority: 'AWS', url: 'https://docs.aws.amazon.com/wellarchitected/latest/saas-lens/saas-lens.html', versionLabel: 'assessed 2026-07-24' },
  { id: 'OPENAPI_3_1', title: 'OpenAPI Specification', authority: 'OpenAPI Initiative', url: 'https://spec.openapis.org/oas/v3.1.1.html', versionLabel: '3.1.1' },
  { id: 'OPENTELEMETRY', title: 'OpenTelemetry Specification', authority: 'OpenTelemetry', url: 'https://opentelemetry.io/docs/specs/', versionLabel: 'assessed 2026-07-24' },
  { id: 'POSTGRESQL', title: 'PostgreSQL Documentation', authority: 'PostgreSQL Global Development Group', url: 'https://www.postgresql.org/docs/', versionLabel: 'current supported releases' }
] as const;

export function engineeringReferencesFor(ids: readonly EngineeringReferenceId[]): EngineeringReference[] {
  const requested = new Set(ids);
  return ENGINEERING_REFERENCES.filter((reference) => requested.has(reference.id));
}
