import { Injectable } from '@nestjs/common';
import { Connections } from '../connections.js';
import { WorkerStorage } from '../storage.js';

export interface DeletedFile {
  key: string;
  bytes: number;
  /** Uploaded files count as used storage; unfinished ones as reserved. */
  uploaded: boolean;
}

/** Files handed in with assignments: removed from storage when their submission goes. */
@Injectable()
export class SubmissionFilesService {
  constructor(
    private readonly connections: Connections,
    private readonly storage: WorkerStorage,
  ) {}

  /** The files of deleted submissions: gone from storage, their space back in the school's quota. */
  async deleted({ schoolId, files }: { schoolId: string; files: DeletedFile[] }) {
    // Deleting a missing object is fine, so a retry is harmless here.
    for (let index = 0; index < files.length; index += 500) {
      await Promise.all(files.slice(index, index + 500).map((file) => this.storage.deleteKey(file.key)));
    }
    const used = files.filter((file) => file.uploaded).reduce((sum, file) => sum + file.bytes, 0);
    const reserved = files.filter((file) => !file.uploaded).reduce((sum, file) => sum + file.bytes, 0);
    await this.connections.withSchool(schoolId, (tx) => tx`
      update school_storage
      set used_bytes = greatest(used_bytes - ${used}, 0), reserved_bytes = greatest(reserved_bytes - ${reserved}, 0)
      where school_id = ${schoolId}`);
  }

  /** Uploads started more than a day ago and never confirmed: removed, their reservation freed. */
  async abandonStale(): Promise<number> {
    const stale = await this.connections.sql<{ id: string; school_id: string }[]>`select id, school_id from app.stale_submission_files(interval '24 hours')`;
    let removed = 0;
    for (const { id, school_id: schoolId } of stale) {
      const [file] = await this.connections.withSchool(schoolId, async (tx) => {
        const rows = await tx<{ submission_id: string; size_bytes: string }[]>`
          delete from submission_files where id = ${id} and not uploaded returning submission_id, size_bytes`;
        if (rows[0]) {
          await tx`update school_storage set reserved_bytes = greatest(reserved_bytes - ${Number(rows[0].size_bytes)}, 0) where school_id = ${schoolId}`;
        }
        return rows;
      });
      if (!file) continue;
      await this.storage.deleteKey(`schools/${schoolId}/submissions/${file.submission_id}/${id}`);
      removed++;
    }
    return removed;
  }
}
