import { z } from 'zod';

export const uuid = z.uuid();

/** Emails are compared case-insensitively, so they are stored trimmed and lower-cased. */
export const email = z
  .string()
  .trim()
  .max(254)
  .pipe(z.email({ message: 'Enter a valid email address' }))
  .transform((value) => value.toLowerCase());

/** A person's display name: 1-80 printable characters, no control characters. */
export const displayName = z
  .string()
  .trim()
  .min(1, 'Enter your name')
  .max(80)
  .regex(/^[^\p{Cc}\p{Cf}]*$/u, 'Use letters, numbers and punctuation only');

/**
 * Error body for every failed API request. `code` is stable and meant for code; `message` is for
 * people. `details` lists the fields that failed validation, when that is the reason.
 */
export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    details?: { path: string; message: string }[];
    requestId?: string;
  };
}

export type ApiErrorCode =
  | 'bad_request'
  | 'validation_failed'
  | 'unauthenticated'
  | 'session_expired'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'email_taken'
  | 'slug_taken'
  | 'invalid_credentials'
  | 'invitation_invalid'
  | 'invitation_email_mismatch'
  | 'already_member'
  | 'limit_reached'
  | 'quota_exceeded'
  | 'enrollment_required'
  | 'payload_too_large'
  | 'rate_limited'
  | 'service_unavailable'
  | 'internal';
