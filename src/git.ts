import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export function parseGitZOutput(stdout: string): string[] {
  return stdout
    .split('\u0000')
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

export async function listIgnoredFiles(cwd: string): Promise<string[]> {
  const args = ['ls-files', '--others', '-i', '--exclude-standard', '-z'];
  try {
    const { stdout } = await execFileAsync('git', args, { cwd, maxBuffer: 10 * 1024 * 1024 });
    return parseGitZOutput(stdout);
  } catch (e: any) {
    if (typeof e?.stderr === 'string' && e.stderr.includes('fatal')) {
      throw new Error('Not a Git repository or Git unavailable');
    }
    throw e;
  }
}

