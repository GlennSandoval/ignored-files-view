import { spawn } from 'node:child_process';


export function parseGitZOutput(stdout: string): string[] {
  return stdout
    .split('\u0000')
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

type CacheEntry = {
  value?: ListResult;
  expires: number;
  inflight?: Promise<ListResult>;
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

export type ListResult = {
  files: string[];
  truncated: boolean;
};

export async function listIgnoredFiles(
  cwd: string,
  maxItems: number,
  signal?: AbortSignal
): Promise<ListResult> {
  const key = `${cwd}::${maxItems}`;
  const now = Date.now();
  const existing = CACHE.get(key);
  if (existing && existing.value && existing.expires > now) {
    return existing.value;
  }
  if (existing?.inflight) return existing.inflight;

  const args = ['ls-files', '--others', '-i', '--exclude-standard', '-z'];

  const p = new Promise<ListResult>((resolve, reject) => {
    const child = spawn('git', args, { cwd });
    let buf = Buffer.alloc(0);
    const files: string[] = [];
    let truncated = false;

    const onData = (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      // Split by NUL, but keep the trailing partial in buf
      let start = 0;
      for (let i = 0; i < buf.length; i++) {
        if (buf[i] === 0x00) {
          const piece = buf.slice(start, i).toString();
          if (piece) files.push(piece);
          start = i + 1;
          if (files.length >= maxItems) {
            truncated = true;
            cleanup();
            try { child.kill(); } catch {}
            finish();
            return;
          }
        }
      }
      // Keep the leftover partial piece in buf
      buf = buf.slice(start);
    };

    const onError = (e: any) => {
      cleanup();
      reject(e);
    };

    const onClose = (code: number) => {
      // Flush any trailing partial (unlikely with -z, but safe)
      if (buf.length) {
        const tail = buf.toString();
        if (tail) files.push(tail);
      }
      finish();
    };

    const finish = () => {
      // Sort results for stable UI
      const sorted = files.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
      const value: ListResult = { files: sorted, truncated };
      CACHE.set(key, { value, expires: Date.now() + CACHE_TTL_MS });
      resolve(value);
    };

    const cleanup = () => {
      child.stdout?.off('data', onData as any);
      child.stderr?.off('data', onStderr as any);
      child.off('error', onError);
      child.off('close', onClose);
      if (signal) signal.removeEventListener('abort', onAbort);
    };

    const onStderr = (chunk: Buffer) => {
      // If fatal error occurs, capture and map later on close
      // For simplicity, if we see 'fatal' immediately reject
      const s = chunk.toString();
      if (s.includes('fatal')) {
        cleanup();
        reject(new Error('Not a Git repository or Git unavailable'));
      }
    };

    const onAbort = () => {
      try { child.kill(); } catch {}
      cleanup();
      // Do not reject; surface as normal cancellation error message upstream
      reject(new Error('Operation cancelled'));
    };

    if (signal) {
      if ((signal as any).aborted) return onAbort();
      signal.addEventListener('abort', onAbort, { once: true });
    }

    child.stdout.on('data', onData);
    child.stderr.on('data', onStderr);
    child.on('error', onError);
    child.on('close', onClose);
  })
    .catch((e: any) => {
      // Map common fatal errors
      if (typeof e?.message === 'string' && e.message.includes('Not a Git repository')) {
        throw e;
      }
      if (typeof e?.stderr === 'string' && e.stderr.includes('fatal')) {
        throw new Error('Not a Git repository or Git unavailable');
      }
      throw e;
    })
    .finally(() => {
      const entry = CACHE.get(key);
      if (entry) delete entry.inflight;
    });

  CACHE.set(key, { expires: now + CACHE_TTL_MS, inflight: p });
  return p;
}
