export type BillingEntitlementRow = {
  key: string;
  enabled: boolean;
  integerLimit: number | null;
};

export function iso(value: string | Date): string {
  return new Date(value).toISOString();
}

export function entitlementLimit(rows: BillingEntitlementRow[], key: string): number {
  const entitlement = rows.find((item) => item.key === key);
  return entitlement?.enabled === true ? entitlement.integerLimit ?? 0 : 0;
}

export function dayStartUtc(now: Date): string {
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  return start.toISOString();
}
