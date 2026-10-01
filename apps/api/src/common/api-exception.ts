import { HttpException, HttpStatus } from '@nestjs/common';
import type { ApiErrorCode } from '@grand/contracts';

/** An error the client is meant to see, with a stable code (see ApiErrorBody in @grand/contracts). */
export class ApiException extends HttpException {
  constructor(
    status: HttpStatus,
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: { path: string; message: string }[],
    readonly headers?: Record<string, string>,
  ) {
    super({ code, message, details }, status);
  }
}

export const notFound = (what = 'This page') => new ApiException(HttpStatus.NOT_FOUND, 'not_found', `${what} doesn't exist.`);
export const forbidden = (message = "You don't have access to this.") =>
  new ApiException(HttpStatus.FORBIDDEN, 'forbidden', message);
export const unauthenticated = (message = 'Sign in to continue.') =>
  new ApiException(HttpStatus.UNAUTHORIZED, 'unauthenticated', message);
