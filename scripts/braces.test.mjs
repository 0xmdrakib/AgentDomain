import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { parsers } from 'prettier/plugins/yaml';

// Downstream backport of the depth/cycle changes in micromatch/braces PR #72,
// commit 28d440b5dd449dbf1fe6f3506cf94ecca4d02660 (closed, unmerged/unreleased).
// Keep npm 3.0.3's unrelated quote and comma parsing behavior unchanged.
// Downstream guards preserve fallback depth budgets and reject non-string AST values.
// This mitigation does not resolve the version-based GHSA-vfj7-8cjw-p6xm alert.
const frontendRequire = createRequire(new URL('../apps/frontend/package.json', import.meta.url));
const tailwindRequire = createRequire(frontendRequire.resolve('tailwindcss/package.json'));
const micromatchRequire = createRequire(tailwindRequire.resolve('micromatch/package.json'));
const chokidarRequire = createRequire(tailwindRequire.resolve('chokidar/package.json'));
const eslintRequire = createRequire(frontendRequire.resolve('eslint-config-next'));
const nextPluginRequire = createRequire(eslintRequire.resolve('@next/eslint-plugin-next'));
const braces = micromatchRequire('braces');
const nested = (depth, open = '{', close = '}', value = 'x') =>
  open.repeat(depth) + value + close.repeat(depth);
const depthError = (error) =>
  (error instanceof SyntaxError || error instanceof RangeError) &&
  /exceeds max depth/.test(error.message);
const methods = ['parse', 'compile', 'expand', 'stringify'];

function nestedAst(depth, value = 'x', type = 'paren') {
  let node = { type: 'text', value };
  for (let i = 0; i < depth; i++) {
    const parent = { type, nodes: [node] };
    node.parent = parent;
    node = parent;
  }
  const root = { type: 'root', nodes: [node] };
  node.parent = root;
  return root;
}

function fallbackAst(depth, at, fallback, type = 'paren') {
  const ast = nestedAst(depth);
  let node = ast;
  for (let i = 0; i < at; i++) node = node.nodes[0];
  node.type = type;
  node[fallback] = fallback === 'ranges' ? 1 : true;
  return ast;
}

test('every installed Tailwind and Next ESLint path resolves the same patched braces 3.0.3', () => {
  assert.equal(micromatchRequire('braces/package.json').version, '3.0.3');
  assert.equal(micromatchRequire.resolve('braces'), chokidarRequire.resolve('braces'));
  for (const consumerRequire of [tailwindRequire, nextPluginRequire]) {
    const fastGlobRequire = createRequire(consumerRequire.resolve('fast-glob/package.json'));
    const matcherRequire = createRequire(fastGlobRequire.resolve('micromatch/package.json'));
    assert.equal(matcherRequire.resolve('braces'), micromatchRequire.resolve('braces'));
  }
});

test('the manifest and every locked braces resolution retain the exact backport hash', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const patchPath = 'patches/braces@3.0.3.patch';
  assert.equal(manifest.pnpm.patchedDependencies['braces@3.0.3'], patchPath);
  const patch = await readFile(new URL(`../${patchPath}`, import.meta.url));
  const hash = createHash('sha256').update(patch).digest('hex');
  const lockfile = await readFile(new URL('../pnpm-lock.yaml', import.meta.url), 'utf8');
  const { children } = parsers.yaml.parse(lockfile);
  assert.equal(children.length, 1);
  const root = children[0].children.find(({ type }) => type === 'documentBody').children[0];
  const mappingEntries = (node) => {
    assert.ok(['mapping', 'flowMapping'].includes(node.type));
    return node.children.map(({ children: [key, value] }) => [
      key.children[0].value,
      value.children[0],
    ]);
  };
  const sections = Object.fromEntries(mappingEntries(root));
  const lockedPatch = Object.fromEntries(mappingEntries(sections.patchedDependencies))[
    'braces@3.0.3'
  ];
  assert.deepEqual(
    Object.fromEntries(mappingEntries(lockedPatch).map(([key, value]) => [key, value.value])),
    { hash, path: patchPath },
  );
  const reference = `3.0.3(patch_hash=${hash})`;
  assert.deepEqual(
    mappingEntries(sections.packages)
      .map(([key]) => key)
      .filter((key) => key.startsWith('braces@')),
    ['braces@3.0.3'],
  );
  assert.deepEqual(
    mappingEntries(sections.snapshots)
      .map(([key]) => key)
      .filter((key) => key.startsWith('braces@')),
    [`braces@${reference}`],
  );
  const consumers = [];
  for (const [name, snapshot] of mappingEntries(sections.snapshots)) {
    for (const [section, dependencies] of mappingEntries(snapshot)) {
      if (!['dependencies', 'optionalDependencies'].includes(section)) continue;
      for (const [dependency, resolution] of mappingEntries(dependencies)) {
        if (dependency !== 'braces') continue;
        assert.equal(resolution.value, reference, `${name}: must not bypass the backport`);
        consumers.push(name);
      }
    }
  }
  assert.deepEqual(consumers.sort(), ['chokidar@3.6.0', 'micromatch@4.0.8']);
});

for (const method of methods) {
  test(`${method}: accepts 100 levels and rejects 101 for braces, parentheses and mixed nesting`, () => {
    for (const [open, close, limit] of [
      ['{', '}', 100],
      ['(', ')', 100],
      ['{(', ')}', 50],
    ]) {
      assert.doesNotThrow(() => braces[method](nested(limit, open, close)));
      assert.throws(() => braces[method](nested(limit + 1, open, close)), depthError);
    }
  });

  test(`${method}: options can tighten but cannot disable the hard cap`, () => {
    for (const maxDepth of [0, 1, 1.5, 2]) {
      assert.doesNotThrow(() => braces[method](nested(Math.floor(maxDepth)), { maxDepth }));
      assert.throws(
        () => braces[method](nested(Math.floor(maxDepth) + 1), { maxDepth }),
        depthError,
      );
    }
    for (const maxDepth of [101, 10000, Infinity, NaN, false, '10000']) {
      assert.throws(() => braces[method](nested(101), { maxDepth }), depthError);
    }
  });
}

for (const method of ['compile', 'expand', 'stringify']) {
  test(`${method}: direct AST input cannot bypass the cap`, () => {
    assert.doesNotThrow(() => braces[method](nestedAst(100)));
    assert.throws(() => braces[method](nestedAst(101)), depthError);
    assert.throws(() => braces[method](nestedAst(101), { maxDepth: Infinity }), depthError);
    assert.doesNotThrow(() => braces[method](nestedAst(1), { maxDepth: 1.5 }));
    assert.throws(() => braces[method](nestedAst(2), { maxDepth: 1.5 }), depthError);
  });

  test(`${method}: rejects cyclic child nodes without exhausting the stack`, () => {
    const ast = { type: 'root', nodes: [] };
    ast.nodes.push(ast);
    assert.throws(() => braces[method](ast), depthError);
  });
}

for (const method of ['compile', 'expand', 'stringify']) {
  test(`${method}: nested root types cannot reset the AST depth cap`, () => {
    assert.doesNotThrow(() => braces[method](nestedAst(100, 'x', 'root')));
    assert.throws(() => braces[method](nestedAst(101, 'x', 'root')), depthError);
  });

  test(`${method}: rejects array, cyclic and deeply nested AST values before coercion`, () => {
    const cycle = [];
    cycle.push(cycle);
    let deep = 'x';
    for (let i = 0; i < 10000; i++) deep = [deep];
    for (const value of [[], ['x'], cycle, deep, null, false, 0, {}]) {
      for (const fallback of [undefined, 'invalid', 'dollar']) {
        const ast = nestedAst(2, value);
        if (fallback) ast.nodes[0][fallback] = true;
        assert.throws(
          () => braces[method](ast),
          (error) =>
            error instanceof TypeError && error.message === 'AST node value must be a string',
        );
      }
    }
  });
}

for (const fallback of ['invalid', 'dollar', 'ranges']) {
  test(`expand: ${fallback} stringify fallback preserves the total 100-level budget`, () => {
    for (const at of [1, 50, 100]) {
      for (const type of ['paren', 'root']) {
        assert.deepEqual(braces.expand(fallbackAst(100, at, fallback, type)), ['x']);
        for (const depth of [101, 199]) {
          assert.throws(() => braces.expand(fallbackAst(depth, at, fallback, type)), depthError);
        }
      }
    }
  });

  test(`expand: ${fallback} stringify fallback preserves stricter fractional budgets`, () => {
    for (const maxDepth of [1.5, 2.5, 4.5]) {
      const limit = Math.floor(maxDepth);
      for (const at of [1, limit]) {
        for (const type of ['paren', 'root']) {
          assert.deepEqual(braces.expand(fallbackAst(limit, at, fallback, type), { maxDepth }), [
            'x',
          ]);
          assert.throws(
            () => braces.expand(fallbackAst(limit + 1, at, fallback, type), { maxDepth }),
            depthError,
          );
        }
      }
    }
  });
}

test('expand rejects self and multi-node parent cycles without hanging', () => {
  for (const selfCycle of [true, false]) {
    const ast = { type: 'paren', nodes: [{ type: 'text', value: 'x' }] };
    ast.parent = selfCycle ? ast : { type: 'paren', parent: ast };
    assert.throws(
      () => vm.runInNewContext('expand(ast)', { expand: braces.expand, ast }, { timeout: 1000 }),
      (error) => error instanceof RangeError && /parent chain contains a cycle/.test(error.message),
    );
  }
});

test('default, create, array and expand entry points enforce the cap', () => {
  const pattern = nested(101);
  for (const run of [
    () => braces(pattern),
    () => braces([pattern]),
    () => braces(pattern, { expand: true }),
    () => braces.create(pattern),
    () => braces.create(pattern, { expand: true }),
  ]) {
    assert.throws(run, depthError);
  }
});

test('deep balanced, unbalanced, dollar and parenthesis patterns fail with controlled errors', () => {
  // Bound the reproduction to a local child process, including when the patch is missing.
  const source = `
    const assert = require('node:assert/strict');
    const braces = require(${JSON.stringify(micromatchRequire.resolve('braces'))});
    const patterns = [
      '{'.repeat(4000) + 'x' + '}'.repeat(4000),
      '('.repeat(4000) + 'x' + ')'.repeat(4000),
      '{'.repeat(9000),
      '$' + '{'.repeat(4000) + 'x' + '}'.repeat(4000),
      '{'.repeat(100) + '(1..2,3)' + '}'.repeat(100),
    ];
    for (const pattern of patterns) {
      assert.ok(pattern.length < 10000);
      for (const method of ${JSON.stringify(methods)}) {
        assert.throws(() => braces[method](pattern), error =>
          error instanceof SyntaxError && /exceeds max depth/.test(error.message));
      }
    }
  `;
  const result = spawnSync(process.execPath, ['-e', source], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    encoding: 'utf8',
    timeout: 20000,
    maxBuffer: 256 * 1024,
    windowsHide: true,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stderr);
});

test('escaped, quoted and bracketed delimiters remain literal, not nesting', () => {
  for (const pattern of [
    '\\{'.repeat(101),
    '\\('.repeat(101),
    `"${nested(101)}"`,
    `'${nested(101)}'`,
    '`' + nested(101) + '`',
    '[' + nested(101) + ']',
  ]) {
    for (const method of methods) assert.doesNotThrow(() => braces[method](pattern));
  }
});

test('ordinary lists, ranges, escaping, invalid input and sequential groups retain behavior', () => {
  assert.deepEqual(braces.expand('a{1..3}b{c,d}'), [
    'a1bc',
    'a1bd',
    'a2bc',
    'a2bd',
    'a3bc',
    'a3bd',
  ]);
  assert.deepEqual(braces.expand('{a,b{1..2}}'), ['a', 'b1', 'b2']);
  assert.deepEqual(braces.expand('foo/({a,b})'), ['foo/(a)', 'foo/(b)']);
  assert.deepEqual(braces('a{1..3}b{c,d}'), ['a([1-3])b(c|d)']);
  assert.deepEqual(braces('{a,b{1..2}}'), ['(a|b(1|2))']);
  assert.equal(braces.compile('{01..03}'), '(0[1-3])');
  assert.deepEqual(braces.expand('{1..5..2}'), ['1', '3', '5']);
  assert.equal(braces.compile('\\{a,b\\}'), '{a,b}');
  assert.deepEqual(braces.expand('${a,b}'), ['${a,b}']);
  assert.throws(() => braces.expand('{1..1001}'), /range limit/);
  assert.throws(() => braces.parse('x'.repeat(10001)), /max characters/);
  assert.throws(() => braces.parse(null), TypeError);
  for (const pattern of ['{{a}}', '{a,{b}}', '{{x}y}', '{a,{b,{c}}', '{}{a}', '{a,b']) {
    assert.equal(braces.stringify(braces.parse(pattern), { escapeInvalid: true }), pattern);
  }
  assert.equal(braces.compile('{x}'.repeat(200)), '{x}'.repeat(200));
  assert.deepEqual(braces.expand('{x}'.repeat(200)), ['{x}'.repeat(200)]);
});

test('actual Micromatch compile/expand consumers retain normal behavior and reject deep patterns', () => {
  const micromatch = tailwindRequire('micromatch');
  assert.deepEqual(micromatch.braces('src/*.{js,ts}'), ['src/*.(js|ts)']);
  assert.deepEqual(micromatch.braceExpand('src/*.{js,ts}'), ['src/*.js', 'src/*.ts']);
  assert.deepEqual(micromatch(['src/a.ts', 'src/b.md'], 'src/*.{js,ts}'), ['src/a.ts']);
  assert.throws(() => micromatch.braces(nested(101, '{', '}', 'a,b')), depthError);
  assert.throws(() => micromatch.braceExpand(nested(101, '{', '}', 'a,b')), depthError);
});

for (const [name, consumerRequire] of [
  ['Tailwind', tailwindRequire],
  ['Next ESLint', nextPluginRequire],
]) {
  test(`${name} Fast-glob task generation preserves globs and rejects deep patterns`, () => {
    const fastGlob = consumerRequire('fast-glob');
    assert.deepEqual(fastGlob.generateTasks(['src/*.{js,ts}', '!src/ignored/**']), [
      {
        dynamic: true,
        positive: ['src/*.js', 'src/*.ts'],
        negative: ['src/ignored/**'],
        base: 'src',
        patterns: ['src/*.js', 'src/*.ts', '!src/ignored/**'],
      },
    ]);
    assert.throws(
      () => fastGlob.generateTasks('src/' + nested(101, '{', '}', 'a,b') + '/*.ts'),
      depthError,
    );
  });
}

test('actual Chokidar watch-helper consumer uses the patch without opening file watchers', async () => {
  const { FSWatcher } = tailwindRequire('chokidar');
  const watcher = new FSWatcher();
  try {
    assert.ok(watcher._getWatchHelpers('src/*.{js,ts}', 0).dirParts.length > 0);
    assert.throws(
      () => watcher._getWatchHelpers('src/' + nested(101, '{', '}', 'a,b') + '/*.ts', 0),
      depthError,
    );
  } finally {
    await watcher.close();
  }
});
