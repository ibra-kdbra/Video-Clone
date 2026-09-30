import { z } from 'zod';
import { displayName, email } from './common.js';
import type { MySchool } from './schools.js';

/**
 * Passwords: 10 to 128 characters, any characters (spaces and emoji included). Length matters far
 * more than character classes, so there are no composition rules.
 */
export const password = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(128, 'Use at most 128 characters');

export const signupInput = z.strictObject({
  email,
  password,
  name: displayName,
});
export type SignupInput = z.infer<typeof signupInput>;

export const loginInput = z.strictObject({
  email,
  // Checked for length only: a login must never reveal which rule an old password breaks.
  password: z.string().min(1, 'Enter your password').max(128),
});
export type LoginInput = z.infer<typeof loginInput>;

export interface User {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  createdAt: string;
}

/** Returned by signup, login and refresh. The refresh token travels only in an httpOnly cookie. */
export interface AuthSession {
  accessToken: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
  user: User;
}

export interface Me {
  user: User;
  schools: MySchool[];
}

/** One signed-in device, for the "where you're signed in" list. */
export interface DeviceSession {
  id: string;
  userAgent: string | null;
  createdAt: string;
  lastUsedAt: string;
  current: boolean;
}

export interface RealtimeTicket {
  ticket: string;
  /** Seconds the ticket stays valid. It works once. */
  expiresIn: number;
}
