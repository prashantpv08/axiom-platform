import { z } from 'zod';

export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    requestId: z.string().min(1),
    retryable: z.boolean(),
    details: z.record(z.string(), z.unknown()).optional()
  }).strict()
}).strict();

export type ApiError = z.infer<typeof ApiErrorSchema>;
