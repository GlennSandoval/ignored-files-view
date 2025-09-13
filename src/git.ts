import { spawn } from "node:child_process";

// Reuse a collator for stable, fast, case-insensitive sorting
const collator = new Intl.Collator(undefined, { sensitivity: "base" });

/**
 * Parses the output of `git ls-files -z` into a sorted array of file paths.
 * @param stdout - The raw stdout string from Git, NUL-delimited.
 * @returns Sorted array of file paths.
 */
export function parseGitZOutput(stdout: string): string[] {
  return stdout.split("\u0000").filter(Boolean).sort(collator.compare);
}

type CacheEntry = {
  value?: ListResult;
  expires: number;
  inflight?: Promise<ListResult>;
};

const CACHE = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 10_000; // conservative default; provider refresh clears this anyway

/**
 * Clears the ignored files list cache.
 */
export function clearIgnoredListCache() {
  CACHE.clear();
}

/**
 * Result of listing ignored files.
 */
export type ListResult = {
  /** List of ignored file paths. */
  files: string[];
  /** True if the result was truncated due to maxItems. */
  truncated: boolean;
};

/**
 * Lists ignored files in a Git repository using `git ls-files`.
 * Results are cached for a short period.
 * @param cwd - The working directory (Git repo root).
 * @param maxItems - Maximum number of files to return.
 * @param signal - Optional AbortSignal to cancel the operation.
 * @returns Promise resolving to a ListResult.
 * @throws If not a Git repository or Git is unavailable.
 */
export async function listIgnoredFiles(
  cwd: string,
  maxItems: number,
  signal?: AbortSignal,
): Promise<ListResult> {
  const key = `${cwd}::${maxItems}`;
  const now = Date.now();
  const existing = CACHE.get(key);
  if (existing?.value && existing.expires > now) {
    return existing.value;
  }
  if (existing?.inflight) return existing.inflight;

  const args = ["ls-files", "--others", "-i", "--exclude-standard", "-z"];

  const promise = new Promise<ListResult>((resolve, reject) => {
    const child = spawn("git", args, { cwd, windowsHide: true });
    let buffer = Buffer.alloc(0);
    const files: string[] = [];
    let truncated = false;

    const onData = (chunk: Buffer) => {
      // Avoid an extra allocation when we don't have a leftover buffer
      const data = buffer.length ? Buffer.concat([buffer, chunk]) : chunk;
      // Scan for NUL delimiters; keep trailing partial in buffer
      let start = 0;
      while (true) {
        const nul = data.indexOf(0x00, start);
        if (nul === -1) break;
        const piece = data.toString("utf8", start, nul);
        if (piece) files.push(piece);
        start = nul + 1;
        if (files.length >= maxItems) {
          truncated = true;
          cleanup();
          try {
            child.kill();
          } catch {}
          finish();
          return;
        }
      }
      // Use Buffer.from to ensure correct type
      buffer = Buffer.from(data.subarray(start));
    };

    const onError = (e: unknown) => {
      cleanup();
      reject(e);
    };

    const onClose = (code: number | null, _signal?: NodeJS.Signals | null) => {
      // Flush any trailing partial (unlikely with -z, but safe)
      if (buffer.length) {
        const tail = buffer.toString();
        if (tail) files.push(tail);
      }
      finish();
    };

    const finish = () => {
      // Sort results for stable UI
      const sorted = files.sort(collator.compare);
      const value: ListResult = { files: sorted, truncated };
      CACHE.set(key, { value, expires: Date.now() + CACHE_TTL_MS });
      resolve(value);
    };

    const cleanup = () => {
      child.stdout?.off("data", onData);
      child.stderr?.off("data", onStderr);
      child.off("error", onError);
      child.off("close", onClose);
      if (signal) signal.removeEventListener("abort", onAbort);
    };

    const onStderr = (chunk: Buffer) => {
      // If fatal error occurs, capture and map later on close
      // For simplicity, if we see 'fatal' immediately reject
      const stderrString = chunk.toString();
      if (stderrString.includes("fatal")) {
        cleanup();
        reject(new Error("Not a Git repository or Git unavailable"));
      }
    };

    const onAbort = () => {
      try {
        child.kill();
      } catch {}
      cleanup();
      // Do not reject; surface as normal cancellation error message upstream
      reject(new Error("Operation cancelled"));
    };

    if (signal) {
      if (signal.aborted) return onAbort();
      signal.addEventListener("abort", onAbort, { once: true });
    }

    child.stdout.on("data", onData);
    child.stderr.on("data", onStderr);
    child.on("error", onError);
    child.on("close", onClose);
  })
    .catch((e: unknown) => {
      // Map common fatal errors
      const err = e as { message?: unknown; stderr?: unknown };
      if (typeof err.message === "string" && err.message.includes("Not a Git repository")) {
        throw e;
      }
      if (typeof err.stderr === "string" && err.stderr.includes("fatal")) {
        throw new Error("Not a Git repository or Git unavailable");
      }
      throw e;
    })
    .finally(() => {
      const entry = CACHE.get(key);
      if (entry) entry.inflight = undefined;
    });

  CACHE.set(key, { expires: now + CACHE_TTL_MS, inflight: promise });
  return promise;
}
