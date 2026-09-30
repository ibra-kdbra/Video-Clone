import { HttpStatus } from '@nestjs/common';
import { ApiException } from './api-exception.js';

/** Keyset pagination cursors: the last row's sort values, base64url-encoded JSON. Opaque to clients. */
export function encodeCursor(values: string[]): string {
  return Buffer.from(JSON.stringify(values)).toString('base64url');
}

export function decodeCursor(cursor: string, length: number): string[] {
  try {
    const values: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (Array.isArray(values) && values.length === length && values.every((value) => typeof value === 'string' && value.length <= 64)) {
      return values as string[];
    }
  } catch {
    // Falls through to the error below.
  }
  throw badCursor();
}

export const badCursor = () => new ApiException(HttpStatus.BAD_REQUEST, 'bad_request', 'This page link is no longer valid.');
