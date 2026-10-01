import { Injectable } from '@nestjs/common';
import { hash, parseOptions, verify } from '@node-rs/argon2';

/**
 * Argon2id with OWASP's recommended minimum (19 MiB of memory, 2 passes, 1 lane), which takes
 * tens of milliseconds per guess on a server and far longer per guess on a GPU.
 */
const OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 };

@Injectable()
export class PasswordService {
  /** Checked against when the email is unknown, so a failed login takes as long either way. */
  private readonly dummyHash = hash('grand-lms:not-a-password', OPTIONS);

  hash(password: string): Promise<string> {
    return hash(password, OPTIONS);
  }

  async verify(passwordHash: string | null, password: string): Promise<boolean> {
    try {
      return await verify(passwordHash ?? (await this.dummyHash), password);
    } catch {
      return false;
    }
  }

  /** True when a hash was made with weaker settings than today's, so it's upgraded at login. */
  needsRehash(passwordHash: string): boolean {
    try {
      const current = parseOptions(passwordHash);
      return current.memoryCost < OPTIONS.memoryCost || current.timeCost < OPTIONS.timeCost;
    } catch {
      return true;
    }
  }
}
