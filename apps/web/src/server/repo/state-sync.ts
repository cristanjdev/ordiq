import { AppError } from "../platform/errors";
import { prisma } from "../platform/db";
import { logger } from "../platform/logger";
import {
  getMasterDataState,
  replaceMasterDataState,
} from "../modules/master-data/master-data.store";
import {
  applyChanges,
  claimNextVersion,
  diffState,
  loadState,
  readSystemState,
  takeSnapshot,
  type StateSnapshot,
} from "./state.repository";

/**
 * Keeps the in-memory domain state and PostgreSQL in step (D-25).
 *
 * - Reads check the shared `system_state.version` (one small query) and
 *   reload only when another instance committed in the meantime.
 * - Writes run one at a time per instance. After the handler finishes, the
 *   records it changed are saved in a single transaction that also bumps the
 *   version; if another instance won the race, the save is refused with 409
 *   and the state reloads.
 * - Any failure marks the state stale, so half-applied in-memory changes are
 *   discarded by the next reload instead of leaking into a later save.
 *
 * PostgreSQL (Supabase) is the only store. The automated test suite
 * (NODE_ENV=test) is the one exception: it runs the services in memory.
 */

/** How long a version check counts as current for other read requests. */
const VERSION_CHECK_FRESH_MS = 1_000;

class StateSync {
  private snapshot: StateSnapshot | null = null;
  private version = -1;
  private aliasCounter = 0;
  private stale = true;
  private loading: Promise<void> | null = null;
  private writeQueue: Promise<void> = Promise.resolve();
  private activeWrites = 0;
  /** One shared version check for reads that arrive together. */
  private versionCheck: Promise<number> | null = null;
  private lastVersionCheckAt = 0;

  /** Run a read-only handler against a current state. */
  async read<T>(handler: () => Promise<T>): Promise<T> {
    // While this instance is writing, its memory is the newest state.
    if (this.activeWrites === 0) await this.refreshIfNeeded();
    return handler();
  }

  /** Run a mutating handler, then save what it changed. */
  async write<T>(handler: () => Promise<T>): Promise<T> {
    const previous = this.writeQueue;
    let release!: () => void;
    this.writeQueue = new Promise<void>((resolve) => (release = resolve));
    await previous;
    this.activeWrites += 1;
    try {
      await this.refreshIfNeeded();
      const result = await handler();
      await this.save();
      return result;
    } catch (error) {
      this.stale = true;
      throw error;
    } finally {
      this.activeWrites -= 1;
      release();
    }
  }

  private async refreshIfNeeded(): Promise<void> {
    if (!this.stale) {
      // A page fires several reads at once; they share one version query, and a
      // check from the last second counts as current. Writes always re-check.
      if (
        this.activeWrites === 0 &&
        Date.now() - this.lastVersionCheckAt < VERSION_CHECK_FRESH_MS
      ) {
        return;
      }
      this.versionCheck ??= readSystemState(prisma)
        .then(({ version }) => {
          this.lastVersionCheckAt = Date.now();
          return version;
        })
        .finally(() => {
          this.versionCheck = null;
        });
      const version = await this.versionCheck;
      if (version === this.version) return;
      this.stale = true;
    }
    this.loading ??= this.reload().finally(() => {
      this.loading = null;
    });
    await this.loading;
  }

  private async reload(): Promise<void> {
    const started = Date.now();
    const loaded = await loadState(prisma);
    replaceMasterDataState(loaded.state);
    this.snapshot = loaded.snapshot;
    this.version = loaded.version;
    this.aliasCounter = loaded.aliasCounter;
    this.stale = false;
    logger.info("state_loaded", { version: loaded.version, ms: Date.now() - started });
  }

  private async save(): Promise<void> {
    if (!this.snapshot) return;
    const state = getMasterDataState();
    const changes = diffState(this.snapshot, state, this.aliasCounter);
    if (changes.count === 0) return;

    const started = Date.now();
    await prisma.$transaction(
      async (tx) => {
        const claimed = await claimNextVersion(tx, this.version, changes.aliasCounter);
        if (!claimed) {
          throw new AppError(
            "CONCURRENT_MODIFICATION",
            "The data changed in another session while this request ran. Reload and try again.",
            409,
          );
        }
        await applyChanges(tx, changes);
      },
      { maxWait: 10_000, timeout: 60_000 },
    );

    this.snapshot = takeSnapshot(state);
    this.version += 1;
    this.aliasCounter = changes.aliasCounter;
    logger.info("state_saved", { version: this.version, records: changes.count, ms: Date.now() - started });
  }
}

const globalForSync = globalThis as unknown as { ordiqStateSync?: StateSync };

/** The process-wide sync, or null under the automated test suite. */
export function getStateSync(): StateSync | null {
  if (process.env.NODE_ENV === "test") return null;
  globalForSync.ordiqStateSync ??= new StateSync();
  return globalForSync.ordiqStateSync;
}
