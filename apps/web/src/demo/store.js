import { TABLES } from './seed.js';

/**
 * The demo's data: the seed (rebuilt on every visit, see seed.js) with the visitor's changes on
 * top. Only the changes are saved, in one localStorage entry, so they stay small however much
 * the seed holds, and "Reset demo" is just forgetting them. Every storage access is wrapped:
 * private windows and blocked storage simply don't keep the changes past the visit.
 */

export const STORAGE_KEY = 'grand.demo.v1';
const VERSION = 1;

/** localStorage, or nothing when it's blocked or missing. */
export function browserStorage() {
  const store = () => {
    try {
      return typeof localStorage === 'undefined' ? null : localStorage;
    } catch {
      return null;
    }
  };
  return {
    get(key) {
      try {
        return store()?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        store()?.setItem(key, value);
        return true;
      } catch {
        return false;
      }
    },
    remove(key) {
      try {
        store()?.removeItem(key);
      } catch {
        // Nothing to clear.
      }
    },
  };
}

/** The saved changes, if they belong to this content (a different content hash starts afresh). */
export function readOverlay(storage, contentHash) {
  try {
    const saved = JSON.parse(storage.get(STORAGE_KEY) ?? 'null');
    if (saved?.v === VERSION && saved.content === contentHash && saved.tables && typeof saved.tables === 'object') return saved;
  } catch {
    // Unreadable: start afresh.
  }
  return { v: VERSION, content: contentHash, tables: {}, meta: {} };
}

/**
 * Tables of rows by id, the seed's plus the visitor's changes, with every change recorded in the
 * overlay (`null` for a removed row). Rows are plain objects; a change replaces the row.
 */
export function createDb(seedTables, overlay) {
  const tables = Object.fromEntries(TABLES.map((name) => [name, new Map(seedTables[name] ?? [])]));
  const seeded = Object.fromEntries(TABLES.map((name) => [name, new Set(seedTables[name]?.keys() ?? [])]));
  const changes = overlay.tables;
  for (const [name, rows] of Object.entries(changes)) {
    if (!tables[name]) continue;
    for (const [id, row] of Object.entries(rows)) {
      if (row === null) tables[name].delete(id);
      else tables[name].set(id, row);
    }
  }
  let dirty = false;
  // Each request is a transaction: what it changed is noted here, and undone if it fails.
  let journal = null;
  const record = (name, id, row) => {
    changes[name] ??= {};
    journal?.push({ name, id, before: tables[name].get(id), hadChange: id in changes[name], change: changes[name][id] });
    if (row === null && !seeded[name].has(id)) delete changes[name][id];
    else changes[name][id] = row;
    dirty = true;
  };

  return {
    get: (name, id) => tables[name].get(id) ?? null,
    all: (name) => [...tables[name].values()],
    filter: (name, test) => {
      const found = [];
      for (const row of tables[name].values()) if (test(row)) found.push(row);
      return found;
    },
    find: (name, test) => {
      for (const row of tables[name].values()) if (test(row)) return row;
      return null;
    },
    count: (name, test) => {
      let total = 0;
      for (const row of tables[name].values()) if (test(row)) total++;
      return total;
    },
    put(name, row) {
      record(name, row.id, row);
      tables[name].set(row.id, row);
      return row;
    },
    update(name, id, patch) {
      const current = tables[name].get(id);
      if (!current) return null;
      const row = { ...current, ...(typeof patch === 'function' ? patch(current) : patch) };
      record(name, id, row);
      tables[name].set(id, row);
      return row;
    },
    remove(name, id) {
      if (!tables[name].has(id)) return false;
      record(name, id, null);
      tables[name].delete(id);
      return true;
    },
    begin() {
      journal = [];
    },
    commit() {
      journal = null;
    },
    rollback() {
      if (!journal) return;
      for (const entry of journal.reverse()) {
        if (entry.before === undefined) tables[entry.name].delete(entry.id);
        else tables[entry.name].set(entry.id, entry.before);
        if (entry.hadChange) changes[entry.name][entry.id] = entry.change;
        else delete changes[entry.name][entry.id];
      }
      journal = null;
    },
    removeWhere(name, test) {
      for (const row of [...tables[name].values()]) if (test(row)) this.remove(name, row.id);
    },
    get dirty() {
      return dirty;
    },
    clean() {
      dirty = false;
    },
    overlay,
  };
}
