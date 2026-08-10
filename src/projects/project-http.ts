import { ApplicationError } from '../platform/application/application-error';
import { parseRequiredVersionIfMatch } from '../platform/http/entity-tag';
import { ProjectIdSchema } from './project.schema';

export type ProjectVersionPrecondition = Readonly<{
  projectId: string;
  expectedRowVersion: number;
}>;

export function parseProjectVersionPrecondition(
  projectIdInput: unknown,
  ifMatchInput: unknown
): ProjectVersionPrecondition {
  const projectId = ProjectIdSchema.safeParse(projectIdInput);
  if (!projectId.success) throw new ApplicationError('NOT_FOUND', 'Project was not found');
  return {
    projectId: projectId.data,
    expectedRowVersion: parseRequiredVersionIfMatch(
      ifMatchInput,
      projectId.data,
      'If-Match header is invalid for this project'
    )
  };
}

