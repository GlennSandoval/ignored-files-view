import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export function parseGitZOutput(stdout: string): string[] {
  return stdout
    .split('\u0000')
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

type CacheEntry = {
  value?: string[];
  expires: number;
  inflight?: Promise<string[]>;
};

const CACHE = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 10_000; // conservative default; provider refresh clears this anyway

export function clearIgnoredListCache(cwd?: string) {
  if (cwd) {
    CACHE.delete(cwd);
  } else {
    CACHE.clear();
  }
}

export async function listIgnoredFiles(cwd: string): Promise<string[]> {
  const now = Date.now();
  const existing = CACHE.get(cwd);
  if (existing && existing.value && existing.expires > now) {
    return existing.value;
  }
  if (existing?.inflight) return existing.inflight;

  const args = ['ls-files', '--others', '-i', '--exclude-standard', '-z'];
  const p = execFileAsync('git', args, { cwd, maxBuffer: 10 * 1024 * 1024 })
    .then(({ stdout }) => parseGitZOutput(stdout))
    .then((value) => {
      CACHE.set(cwd, { value, expires: Date.now() + CACHE_TTL_MS });
      return value;
    })
    .catch((e: any) => {
      // On error, avoid poisoning the cache; map common fatal error
      if (typeof e?.stderr === 'string' && e.stderr.includes('fatal')) {
        throw new Error('Not a Git repository or Git unavailable');
      }
      throw e;
    })
    .finally(() => {
      const entry = CACHE.get(cwd);
      if (entry) delete entry.inflight;
    });

  CACHE.set(cwd, { expires: now + CACHE_TTL_MS, inflight: p });
  return p;
}
