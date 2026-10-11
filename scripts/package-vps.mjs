import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, cp, writeFile, readFile, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const builtAt = new Date().toISOString();
const id = builtAt.replace(/[-:.]/g, '');
const parent = path.join(root, '.local', 'artifacts', 'vps-releases');
const release = path.join(parent, `release-${id}`);
const archive = `${release}.tar.gz`;
function run(executable, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: root, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${executable} exited with ${code}`)));
  });
}

try {
  await mkdir(parent, { recursive: true });
  await mkdir(release); // Never replace an existing release or its data.
  await run(process.execPath, ['scripts/development.mjs', 'dotnet', 'publish', 'apps/api/App.Api/App.Api.csproj',
    '-c', 'Release', '--no-restore', '-o', path.join(release, 'api')]);
  await unlink(path.join(release, 'api', 'appsettings.Development.json'));
  await cp(path.join(root, 'apps', 'web', 'dist'), path.join(release, 'web'), { recursive: true });
  for (const [source, destination] of [['compose.vps.yml', 'compose.yml'], ['Dockerfile.api', 'Dockerfile.api'], ['Caddyfile.vps', 'Caddyfile']]) {
    await cp(path.join(root, 'deploy', source), path.join(release, destination));
  }
  const execute = promisify(execFile);
  const revision = (await execute('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim();
  const trackedChanges = (await execute('git', ['diff', 'HEAD', '--name-only'], { cwd: root })).stdout.trim();
  await writeFile(path.join(release, 'release.json'), JSON.stringify({ id, builtAt, revision, hasTrackedChanges: trackedChanges.length > 0 }, null, 2));
  await run('tar', ['-czf', archive, '-C', release, '.']);
  const hash = createHash('sha256').update(await readFile(archive)).digest('hex');
  await writeFile(`${archive}.sha256`, `${hash}  ${path.basename(archive)}\n`);
  console.log(`Release: ${archive}\nSHA256: ${hash}\nServer secrets and local data are not included.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
