import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { ApiErrorBody, ApiErrorCode } from '@grand/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ApiException } from './api-exception.js';

const CODE_BY_STATUS: Partial<Record<number, ApiErrorCode>> = {
  400: 'bad_request',
  401: 'unauthenticated',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  413: 'payload_too_large',
  415: 'bad_request',
  429: 'rate_limited',
  503: 'service_unavailable',
};

/** Fastify's own errors (bad JSON, body too large, wrong content type) carry a statusCode. */
function fastifyStatus(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) return null;
  const { statusCode, code } = error as { statusCode?: unknown; code?: unknown };
  return typeof statusCode === 'number' && typeof code === 'string' && code.startsWith('FST_') ? statusCode : null;
}

/**
 * Turns every error into the one error shape in ApiErrorBody. Unexpected errors are logged with
 * the request id and answered with a generic 500, so no internals (SQL, stack traces) leak out.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errors');

  catch(exception: unknown, host: ArgumentsHost) {
    if (host.getType() !== 'http') throw exception;
    const request = host.switchToHttp().getRequest<FastifyRequest>();
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    const requestId = (request.raw as { id?: string }).id;

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let error: ApiErrorBody['error'] = { code: 'internal', message: 'Something went wrong on our side. Please try again.' };

    if (exception instanceof ApiException) {
      status = exception.getStatus();
      error = { code: exception.code, message: exception.message };
      if (exception.details) error.details = exception.details;
      for (const [name, value] of Object.entries(exception.headers ?? {})) reply.header(name, value);
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      error = { code: CODE_BY_STATUS[status] ?? (status < 500 ? 'bad_request' : 'internal'), message: this.publicMessage(exception) };
    } else if (fastifyStatus(exception) !== null) {
      status = fastifyStatus(exception)!;
      error = {
        code: CODE_BY_STATUS[status] ?? 'bad_request',
        message: status === 413 ? 'The request is too large.' : 'The request could not be read.',
      };
    }

    if (status >= 500) this.logger.error({ err: exception, requestId }, 'Request failed');
    reply.status(status).header('cache-control', 'no-store').send({ error: { ...error, requestId } } satisfies ApiErrorBody);
  }

  private publicMessage(exception: HttpException) {
    const response = exception.getResponse();
    if (typeof response === 'string') return response;
    const message = (response as { message?: unknown }).message;
    return typeof message === 'string' ? message : exception.message;
  }
}
