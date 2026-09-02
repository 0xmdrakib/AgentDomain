import ts from 'typescript';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, relative, dirname, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('..', import.meta.url));
const sourceRoot = resolve(root, 'src');
const workspace = resolve(root, '../..');
const publicPackages = new Map(
  ['sdk', 'shared'].map((name) => [
    `@agentdomain/${name}`,
    resolve(workspace, 'packages', name, 'src'),
  ]),
);
const frontendEnv = new Set([
  'NODE_ENV',
  'FRONTEND_PUBLIC_API_URL',
  'NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID',
  'NEXT_PUBLIC_TURNSTILE_SITE_KEY',
]);

export function inspectSource(text, filename = 'fixture.ts') {
  const file = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true);
  const imports = [];
  const errors = [];
  const client = file.statements.some(
    (node) =>
      ts.isExpressionStatement(node) &&
      ts.isStringLiteral(node.expression) &&
      node.expression.text === 'use client',
  );
  function addImport(node) {
    if (!node || !ts.isStringLiteralLike(node)) errors.push('Nonliteral module reference');
    else imports.push(node.text);
  }
  function visit(node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier) addImport(node.moduleSpecifier);
    }
    if (ts.isImportTypeNode(node))
      addImport(ts.isLiteralTypeNode(node.argument) ? node.argument.literal : null);
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    )
      addImport(node.arguments[0]);
    if (
      ts.isExpressionStatement(node) &&
      ts.isStringLiteral(node.expression) &&
      node.expression.text === 'use server'
    )
      errors.push('Server action');
    if (
      ts.isPropertyAccessExpression(node) &&
      node.expression.getText(file) === 'process.env' &&
      !frontendEnv.has(node.name.text)
    )
      errors.push(`Backend environment dependency: ${node.name.text}`);
    if (ts.isElementAccessExpression(node) && node.expression.getText(file) === 'process.env')
      errors.push('Computed environment access');
    if (
      ts.isImportDeclaration(node) &&
      node.moduleSpecifier.text === 'next/headers' &&
      node.importClause?.namedBindings?.elements?.some(
        (item) => item.name.text === 'cookies' || item.propertyName?.text === 'cookies',
      )
    )
      errors.push('Server cookie/session access');
    ts.forEachChild(node, visit);
  }
  visit(file);
  for (const specifier of imports) {
    if (
      /^(node:|@aws-sdk\/|@google-cloud\/|@upstash\/|@agentdomain\/storage)|(^|\/)(db|services|storage)(\/|$)/.test(
        specifier,
      )
    )
      errors.push(`Private module: ${specifier}`);
  }
  return { imports, errors, client };
}

export function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isSymbolicLink()) throw new Error('Source symlinks are not allowed');
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.(tsx?|mjs)$/.test(entry.name) ? [path] : [];
  });
}

function resolveModule(candidate) {
  const base = candidate.replace(/\.js$/, '');
  const target = [
    candidate,
    `${base}.ts`,
    `${base}.tsx`,
    `${candidate}/index.ts`,
    `${candidate}/index.tsx`,
  ].find((path) => existsSync(path) && extname(path));
  if (!target) throw new Error(`Unresolved source import: ${relative(root, candidate)}`);
  return target;
}

export function auditSourceGraph() {
  const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  const dependencySets = new Map([[sourceRoot, new Set(Object.keys(manifest.dependencies))]]);
  for (const packageRoot of publicPackages.values()) {
    const manifest = JSON.parse(readFileSync(resolve(packageRoot, '../package.json'), 'utf8'));
    dependencySets.set(packageRoot, new Set(Object.keys(manifest.dependencies ?? {})));
  }
  const pending = sourceFiles(sourceRoot);
  const visited = new Set();
  const errors = [];
  const edges = new Map();
  const clients = [];
  while (pending.length) {
    const file = pending.pop();
    if (visited.has(file)) continue;
    visited.add(file);
    const allowedBare = [...dependencySets].find(([base]) => file.startsWith(base + sep))[1];
    const { imports, errors: found, client } = inspectSource(readFileSync(file, 'utf8'), file);
    edges.set(file, []);
    if (client) clients.push(file);
    errors.push(...found.map((error) => `${relative(root, file)}: ${error}`));
    for (const specifier of imports) {
      if (specifier.endsWith('.css')) continue;
      let candidate;
      if (specifier.startsWith('@/')) candidate = resolve(sourceRoot, specifier.slice(2));
      else if (specifier.startsWith('.')) candidate = resolve(dirname(file), specifier);
      else {
        const name = specifier.startsWith('@')
          ? specifier.split('/').slice(0, 2).join('/')
          : specifier.split('/')[0];
        if (!allowedBare.has(name))
          errors.push(`${relative(root, file)}: Undeclared dependency ${name}`);
        if (publicPackages.has(name))
          candidate = resolve(
            publicPackages.get(name),
            specifier.slice(name.length + 1) || 'index',
          );
      }
      if (!candidate) continue;
      const allowed = [sourceRoot, ...publicPackages.values()].some((base) =>
        candidate.startsWith(base + sep),
      );
      if (!allowed) {
        errors.push(`${relative(root, file)}: Import escapes frontend/public package source`);
        continue;
      }
      try {
        const target = resolveModule(candidate);
        pending.push(target);
        edges.get(file).push(target);
      } catch (error) {
        errors.push(error.message);
      }
    }
  }
  const serverOnly = new Set(
    ['backend-client.ts', 'backend-transport.ts', 'custom-domain.ts'].map((name) =>
      resolve(sourceRoot, 'lib', name),
    ),
  );
  for (const client of clients) {
    const queue = [client];
    const seen = new Set();
    while (queue.length) {
      const file = queue.pop();
      if (seen.has(file)) continue;
      seen.add(file);
      if (serverOnly.has(file))
        errors.push(`${relative(root, client)}: Client graph reaches server transport/identity`);
      queue.push(...(edges.get(file) ?? []));
    }
  }
  return { files: [...visited], errors };
}
