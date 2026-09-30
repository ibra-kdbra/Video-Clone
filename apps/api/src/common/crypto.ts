import { createHash, randomBytes } from 'node:crypto';

/** 32 random bytes as base64url (43 characters): refresh tokens, invitation links, socket tickets. */
export const randomToken = () => randomBytes(32).toString('base64url');

/** Tokens are stored only as their SHA-256, so a database leak doesn't hand out working tokens. */
export const hashToken = (token: string) => createHash('sha256').update(token).digest();

export const TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/;
