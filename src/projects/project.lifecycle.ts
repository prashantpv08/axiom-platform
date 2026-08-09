import type { ProjectStatus, RestorableProjectStatus } from './project.schema';
import { RestorableProjectStatusSchema } from './project.schema';

export type ProjectLifecycleAction = 'ARCHIVE' | 'RESTORE';

export type ProjectLifecycleState = Readonly<{
  status: ProjectStatus;
  archivedFromStatus: RestorableProjectStatus | null;
  archivedAt: string | null;
}>;

export class ProjectLifecycleConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectLifecycleConflictError';
  }
}

export function transitionProjectLifecycle(
  current: ProjectLifecycleState,
  action: ProjectLifecycleAction,
  occurredAt: string
): ProjectLifecycleState {
  if (action === 'ARCHIVE') {
    if (current.status === 'ARCHIVED') throw new ProjectLifecycleConflictError('Project is already archived');
    return {
      status: 'ARCHIVED',
      archivedFromStatus: RestorableProjectStatusSchema.parse(current.status),
      archivedAt: occurredAt
    };
  }

  if (current.status !== 'ARCHIVED') throw new ProjectLifecycleConflictError('Project is not archived');
  const restoredStatus = RestorableProjectStatusSchema.safeParse(current.archivedFromStatus);
  if (!restoredStatus.success || current.archivedAt === null) {
    throw new ProjectLifecycleConflictError('Project archive state is invalid');
  }
  return { status: restoredStatus.data, archivedFromStatus: null, archivedAt: null };
}
