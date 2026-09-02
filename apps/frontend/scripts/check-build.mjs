import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
export function assertBuildBoundary(routes, files) {
  for (const route of routes) {
    if (/(^|\/)api(\/|$)/.test(route))
      throw new Error(`Business API in frontend artifact: ${route}`);
    if (/(^|\/)(?:admin|docs)(\/|$)/.test(route))
      throw new Error(`Retired frontend route in artifact: ${route}`);
    if (
      route.endsWith('/route') &&
      !['/sitemap-agents.xml/route', '/sitemap.xml/route', '/robots.txt/route'].includes(route)
    )
      throw new Error(`Unapproved frontend handler: ${route}`);
  }
  for (const file of files) {
    const normalized = file.replaceAll('\\', '/');
    if (
      /\/apps\/web\/|\/packages\/storage\/|\/apps\/frontend\/src\/(db|services|storage)\/|@aws-sdk|@google-cloud|@upstash|(?:\/|\+)(?:drizzle-orm|ioredis|pg|postgres)@|(?:^|\/)\.?[^/]*\.env(?:\.|$)|(?:^|\/)\.env(?:\.|$)/.test(
        normalized,
      )
    ) {
      throw new Error('Private backend dependency or environment file in frontend artifact');
    }
  }
}

function filesUnder(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

export function checkBuild() {
  const server = resolve(root, '.next/server');
  const paths = JSON.parse(readFileSync(resolve(server, 'app-paths-manifest.json'), 'utf8'));
  const files = filesUnder(server);
  const traces = files.filter((file) => file.endsWith('.nft.json'));
  const dependencies = traces.flatMap((file) =>
    JSON.parse(readFileSync(file, 'utf8')).files.map((item) => resolve(dirname(file), item)),
  );
  assertBuildBoundary(Object.keys(paths), [...files, ...dependencies]);
  for (const file of files.filter((file) => /\.js$/.test(file))) {
    if (
      /agentsRepo|registrationsRepo|getServerEnv|verifySiweAndStartSession|processInboundEmail|withX402\(/.test(
        readFileSync(file, 'utf8'),
      )
    ) {
      throw new Error(`Backend implementation marker in ${relative(root, file)}`);
    }
  }
  return {
    routes: Object.keys(paths).length,
    traceFiles: traces.length,
    dependencies: dependencies.length,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!existsSync(resolve(root, '.next/BUILD_ID'))) throw new Error('Build the frontend first.');
  console.log('Frontend artifact boundary passed:', checkBuild());
}
