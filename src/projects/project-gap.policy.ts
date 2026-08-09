export type CriticalProjectGap = Readonly<{
  type: string;
  severity: string;
  status: string;
  truthStatus: string;
}>;

export function isCriticalProjectGap(gap: CriticalProjectGap): boolean {
  if (gap.status !== 'OPEN' || gap.truthStatus !== 'UNKNOWN') return false;
  if (gap.severity === 'BLOCKER') return true;
  if (gap.type === 'CONFLICT' || gap.type === 'CONTRADICTION') return true;
  return gap.type === 'UNTESTABLE' && gap.severity === 'HIGH';
}
