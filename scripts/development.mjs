import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const local = path.join(root, '.local');
const envFile = path.join(root, 'deploy', '.env');
const command = process.argv[2];
const cliEnvironment = {
  ...process.env,
  DOTNET_CLI_HOME: path.join(local, 'dotnet-home'),
  NUGET_PACKAGES: path.join(local, 'nuget-packages'),
  NUGET_HTTP_CACHE_PATH: path.join(local, 'nuget-http-cache'),
  DOTNET_CLI_TELEMETRY_OPTOUT: '1',
  DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1',
  DOTNET_GENERATE_ASPNET_CERTIFICATE: 'false',
  DOTNET_ADD_GLOBAL_TOOLS_TO_PATH: 'false',
  DOTNET_CLI_WORKLOAD_UPDATE_NOTIFY_DISABLE: 'true',
  PLAYWRIGHT_BROWSERS_PATH: path.join(local, 'playwright-browsers'),
  DataProtection__KeyPath: process.env.DataProtection__KeyPath ?? path.join(local, 'data-protection'),
};

function run(executable, args, environment = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: root, stdio: 'inherit', env: { ...cliEnvironment, ...environment },
    });
    child.on('error', reject);
    child.on('exit', code => resolve(code ?? 1));
  });
}

async function databaseEnvironment() {
  const content = await readFile(envFile, 'utf8');
  const values = {};
  // A deliberately small dotenv subset; never execute or source configuration.
  for (const line of content.split(/\r?\n/)) {
    const match = /^(POSTGRES_DB|POSTGRES_USER|POSTGRES_PASSWORD|POSTGRES_PORT)=([^\r\n]+)$/.exec(line);
    if (match) values[match[1]] = match[2];
  }
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(values.POSTGRES_DB ?? '') ||
      !/^[a-z][a-z0-9_]{0,62}$/.test(values.POSTGRES_USER ?? '') ||
      !/^[A-Za-z0-9_-]{16,128}$/.test(values.POSTGRES_PASSWORD ?? '') ||
      values.POSTGRES_PASSWORD === 'replace_with_a_random_local_password' ||
      !/^\d+$/.test(values.POSTGRES_PORT ?? '') ||
      Number(values.POSTGRES_PORT) < 1 || Number(values.POSTGRES_PORT) > 65535) {
    throw new Error('Invalid deploy/.env. Use npm run setup or follow the development configuration guide.');
  }
  return {
    ConnectionStrings__Dosvyazi: `Host=127.0.0.1;Port=${values.POSTGRES_PORT};Database=${values.POSTGRES_DB};Username=${values.POSTGRES_USER};Password=${values.POSTGRES_PASSWORD};Timeout=2;Command Timeout=2`,
  };
}

try {
  await mkdir(local, { recursive: true });
  let exitCode = 0;
  switch (command) {
    case 'setup': {
      try {
        await writeFile(envFile,
          `POSTGRES_DB=dosvyazi\nPOSTGRES_USER=dosvyazi\nPOSTGRES_PASSWORD=${randomBytes(24).toString('hex')}\nPOSTGRES_PORT=15432\n`,
          { flag: 'wx', mode: 0o600 });
        console.log('Created ignored deploy/.env with a random development password.');
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        console.log('Kept existing deploy/.env.');
      }
      break;
    }
    case 'database':
    case 'database-stop': {
      await databaseEnvironment();
      const operation = command === 'database'
        ? ['up', '--detach', '--wait', '--wait-timeout', '60']
        : ['stop', 'database'];
      exitCode = await run('docker', ['compose', '--env-file', 'deploy/.env', '-f', 'deploy/compose.dev.yml', ...operation]);
      break;
    }
    case 'api':
    case 'migrate': {
      let database = {};
      if (!process.env.ConnectionStrings__Dosvyazi) {
        try { database = await databaseEnvironment(); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      const port = process.env.DOSVYAZI_API_PORT ?? '5080';
      if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error('Invalid API port.');
      exitCode = await run('dotnet', ['run', '--project', 'apps/api/App.Api', '--no-launch-profile', '--no-build', '--no-restore', ...(command === 'migrate' ? ['--', '--migrate'] : [])], {
        ...database, ASPNETCORE_ENVIRONMENT: 'Development', ASPNETCORE_URLS: `http://127.0.0.1:${port}`,
      });
      break;
    }
    case 'ef': {
      const database = process.env.ConnectionStrings__Dosvyazi ? {} : await databaseEnvironment();
      exitCode = await run('dotnet', ['tool', 'run', 'dotnet-ef', '--', ...process.argv.slice(3)], {
        ...database, ASPNETCORE_ENVIRONMENT: 'Development',
      });
      break;
    }
    case 'database-test': {
      const database = process.env.DOSVYAZI_TEST_CONNECTION
        ? {} : await databaseEnvironment();
      exitCode = await run('dotnet', ['test', 'Dosvyazi.slnx', '--no-build', '--no-restore', '-m:1', '--filter', 'Category=PostgreSQL', '--logger', 'trx', '--results-directory', '.local/artifacts/dotnet-tests'], {
        DOSVYAZI_TEST_CONNECTION: process.env.DOSVYAZI_TEST_CONNECTION ?? database.ConnectionStrings__Dosvyazi,
      });
      break;
    }
    case 'browser-install':
      exitCode = await run(process.execPath, ['node_modules/@playwright/test/cli.js', 'install', 'chromium']);
      break;
    case 'dotnet':
      exitCode = await run('dotnet', process.argv.slice(3));
      break;
    default:
      throw new Error('Unknown development command. See README.md.');
  }
  process.exitCode = exitCode;
} catch (error) {
  // Do not print config values, connection strings or environment contents.
  console.error(error.code === 'ENOENT' ? 'Required file or tool is missing. Run npm run setup and check prerequisites.' : error.message);
  process.exitCode = 1;
}
