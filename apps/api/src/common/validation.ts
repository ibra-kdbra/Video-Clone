import { HttpStatus, StandardSchemaValidationPipe } from '@nestjs/common';
import { ApiException } from './api-exception.js';

type Issue = { message: string; path?: ReadonlyArray<PropertyKey | { key: PropertyKey }> | undefined };

export function formatIssues(issues: readonly Issue[]) {
  return issues.map((issue) => ({
    path: (issue.path ?? []).map((segment) => String(typeof segment === 'object' ? segment.key : segment)).join('.'),
    message: issue.message,
  }));
}

/**
 * Validates every @Body/@Query/@Param that declares a `schema` (zod, through Standard Schema) and
 * passes on the parsed value, so handlers only ever see clean, typed input.
 */
export const validationPipe = new StandardSchemaValidationPipe({
  exceptionFactory: (issues) =>
    new ApiException(HttpStatus.BAD_REQUEST, 'validation_failed', 'Some fields need attention.', formatIssues(issues)),
});
