import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

const options = process.argv.slice(2);
if (options.length !== 2 || options[0] !== '--release') throw new Error('Usage: node scripts/package-onprem.mjs --release PREBUILT_VPS_RELEASE_DIRECTORY');
const source = path.resolve(options[1]), inputs = JSON.parse(await fs.readFile('deploy/onprem/images.json', 'utf8'));
const metadata = JSON.parse(await fs.readFile(path.join(source, 'release.json'), 'utf8'));
if (!/^\d{8}T\d{9}Z$/.test(metadata.id)) throw new Error('Invalid prebuilt release identity');
const id = metadata.id, parent = path.resolve('.local/artifacts/onprem-releases'), output = path.join(parent, `dosvyazi-${id}`), work = path.join(parent, `build-${id}`);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function run(cmd, args, cwd) { return new Promise((resolve, reject) => { const child = spawn(cmd, args, { cwd, stdio: 'inherit', windowsHide: true }); child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))); }); }
async function captured(cmd, args) { return new Promise((resolve, reject) => { const child = spawn(cmd, args, { windowsHide: true }); const bytes = []; child.stdout.on('data', b => bytes.push(b)); child.stderr.on('data', b => process.stderr.write(b)); child.on('error', reject); child.on('exit', c => c === 0 ? resolve(Buffer.concat(bytes).toString().trim()) : reject(new Error(`${cmd} exited ${c}`))); }); }
const dll = await fs.readFile(path.join(source, 'api/App.Api.dll'));
if (hash(dll) !== hash(await fs.readFile('apps/api/App.Api/bin/Release/net10.0/App.Api.dll'))) throw new Error('Prebuilt API differs from current published API; package the verified source again');
await fs.mkdir(parent, { recursive: true }); await fs.mkdir(output); await fs.mkdir(work);
await fs.cp(path.join(source, 'api'), path.join(work, 'api'), { recursive: true });
await fs.cp(path.join(source, 'web'), path.join(work, 'web'), { recursive: true });
for (const file of ['Caddyfile', 'Dockerfile.web']) await fs.copyFile('deploy/onprem/' + file, path.join(work, file));
await fs.copyFile('deploy/Dockerfile.api', path.join(work, 'Dockerfile.api'));
for (const image of [inputs.runtime, inputs.database, inputs.livekit, inputs.caddy]) await run('docker', ['pull', '--platform', inputs.platform, image]);
const tags = Object.fromEntries(['api', 'web', 'database', 'livekit'].map(name => [name, `dosvyazi-onprem-${name}:${id}`]));
await run('docker', ['build', '--platform', inputs.platform, '--build-arg', `ASPNET_IMAGE=${inputs.runtime}`, '-t', tags.api, '-f', path.join(work, 'Dockerfile.api'), work]);
await run('docker', ['build', '--platform', inputs.platform, '--build-arg', `CADDY_IMAGE=${inputs.caddy}`, '-t', tags.web, '-f', path.join(work, 'Dockerfile.web'), work]);
await run('docker', ['tag', inputs.database, tags.database]); await run('docker', ['tag', inputs.livekit, tags.livekit]);
const identities = {};
for (const [name, tag] of Object.entries(tags)) { identities[name] = JSON.parse(await captured('docker', ['image', 'inspect', tag]))[0]; if (identities[name].Os !== 'linux' || identities[name].Architecture !== 'amd64') throw new Error('Unsupported image platform'); }
await run('docker', ['image', 'save', '-o', path.join(output, 'images.tar'), ...Object.values(tags)]);
const migrations = (await fs.readdir('apps/api/App.Api/Infrastructure/Persistence/Migrations')).filter(f => /_\w+\.cs$/.test(f) && !f.endsWith('.Designer.cs')).sort();
const schema = hash(Buffer.concat(await Promise.all(migrations.map(async f => Buffer.concat([Buffer.from(f), await fs.readFile('apps/api/App.Api/Infrastructure/Persistence/Migrations/' + f)])))));
await fs.writeFile(path.join(output, 'images.env'), `PACKAGE_ID=${id}\nSCHEMA_CONTRACT=forums-v1\nSCHEMA_SHA256=${schema}\n` + Object.entries(tags).map(([name, tag]) => `${name.toUpperCase()}_IMAGE=${tag}\n${name.toUpperCase()}_IMAGE_ID=${identities[name].Id}\n`).join(''));
for (const file of ['compose.yml', 'manage.sh', 'config.env.example']) await fs.copyFile('deploy/onprem/' + file, path.join(output, file));
await fs.copyFile('docs/on-prem.md', path.join(output, 'README.md'));
await fs.writeFile(path.join(output, 'release.json'), JSON.stringify({ format: 'dosvyazi-onprem', version: 1, id, platform: inputs.platform, revision: metadata.revision, dirtySource: metadata.hasTrackedChanges, contract: 'forums-v1', schema, migrations, apiSha256: hash(dll), baseImages: inputs, images: Object.fromEntries(Object.entries(tags).map(([name, tag]) => [name, { tag, id: identities[name].Id }])) }, null, 2));
const entries = (await fs.readdir(output)).sort();
if (JSON.stringify(entries) !== JSON.stringify(['README.md', 'compose.yml', 'config.env.example', 'images.env', 'images.tar', 'manage.sh', 'release.json'])) throw new Error('Unexpected operator bundle content');
const sums = await Promise.all(entries.map(async file => `${hash(await fs.readFile(path.join(output, file)))}  ${file}`)); await fs.writeFile(path.join(output, 'checksums.sha256'), sums.join('\n') + '\n');
const archive = output + '.tar.gz'; await run('tar', ['-czf', archive, '-C', output, '.']); const sha256 = hash(await fs.readFile(archive)); await fs.writeFile(archive + '.sha256', `${sha256}  ${path.basename(archive)}\n`);
console.log(JSON.stringify({ archive, directory: output, sha256, id, schema, entries: entries.length + 1, images: Object.keys(tags) }));
