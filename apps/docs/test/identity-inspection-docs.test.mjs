import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const doc = (name) =>
  readFile(new URL(`../src/content/docs/sdk/${name}.mdx`, import.meta.url), 'utf8');

function markdownLinkTarget(source, label) {
  const links = [...source.matchAll(/\[([^\]]+)\]\(([^)\s]+)\)/g)].filter(
    ([, text]) => text === label,
  );
  assert.equal(links.length, 1, `Expected one Markdown link labeled ${label}`);
  return links[0][2];
}

test('the release catalog records all eight published packages with exact registry links', async () => {
  const readme = await readFile(new URL('../../../README.md', import.meta.url), 'utf8');
  const rows = readme.split('\n').filter((line) => /^\| \[/.test(line));
  assert.equal(rows.filter((line) => /\| Published 0\.11\.0\s*\|/.test(line)).length, 8);
  assert.equal(rows.filter((line) => /\| Source candidate 0\.11\.0\s*\|/.test(line)).length, 0);
  assert.match(readme, /\*\*All eight packages are published at 0\.11\.0\*\*/);
  assert.doesNotMatch(readme, /unpublished|source candidate/i);
  for (const name of [
    'shared',
    'sdk',
    'mcp-server',
    'agentkit-plugin',
    'eliza-plugin',
    'langchain-plugin',
  ]) {
    const row = rows.find((line) => line.startsWith(`| [\`@agentdomain/${name}\`](`));
    assert.ok(row, `${name}: missing npm catalog link`);
    assert.equal(
      markdownLinkTarget(row, `\`@agentdomain/${name}\``),
      `https://www.npmjs.com/package/@agentdomain/${name}`,
    );
    assert.match(row, /\| Published 0\.11\.0\s*\|/);
  }
  const crewai = rows.find((line) => line.startsWith('| [`agentdomain-crewai`]('));
  assert.ok(crewai, 'Missing CrewAI catalog entry');
  assert.equal(
    markdownLinkTarget(crewai, '`agentdomain-crewai`'),
    'https://pypi.org/project/agentdomain-crewai/0.11.0/',
  );
  assert.match(crewai, /\| Published 0\.11\.0\s*\|/);
  const autogen = rows.find((line) => line.startsWith('| [`agentdomain-autogen`]('));
  assert.ok(autogen, 'Missing AutoGen catalog entry');
  assert.equal(
    markdownLinkTarget(autogen, '`agentdomain-autogen`'),
    'https://pypi.org/project/agentdomain-autogen/0.11.0/',
  );
  assert.match(autogen, /\| Published 0\.11\.0\s*\|/);
  assert.match(
    readme,
    /five earlier npm 0\.11\.0 releases have verified GitHub\s+Actions OIDC provenance/,
  );
  assert.match(readme, /LangChain's local publication has no OIDC provenance/);
  assert.match(
    readme,
    /do not invent REST endpoints for onchain functions,\s+authorize actions, or prove npm publication/,
  );
});

test('the dated Python follow-up records both publications with verified artifact attestations', async () => {
  const changelog = await readFile(new URL('../../../CHANGELOG.md', import.meta.url), 'utf8');
  const followUp = changelog.match(
    /^## Python 0\.11\.0 - 2026-09-14 Follow-Up\r?\n[\s\S]*?(?=^## )/m,
  )?.[0];
  assert.ok(followUp, 'Missing dated Python publication follow-up');
  assert.equal(changelog.match(/^## .+/m)?.[0], '## Python 0.11.0 - 2026-09-14 Follow-Up');
  assert.equal(
    markdownLinkTarget(followUp, '`agentdomain-crewai` 0.11.0'),
    'https://pypi.org/project/agentdomain-crewai/0.11.0/',
  );
  assert.match(followUp, /is now published on PyPI\. This first publication used/);
  assert.equal(
    markdownLinkTarget(followUp, 'GitHub Actions run 34873297689'),
    'https://github.com/0xmdrakib/AgentDomain/actions/runs/34873297689',
  );
  assert.match(
    followUp,
    /attempt 1, from reviewed public commit `99232d692d736737100ed4dec5e1d75130c70c6e`/,
  );
  assert.match(
    followUp,
    /Registry metadata and comparison with the reviewed CI artifacts both passed/,
  );
  assert.equal(
    markdownLinkTarget(followUp, '`agentdomain-autogen` 0.11.0'),
    'https://pypi.org/project/agentdomain-autogen/0.11.0/',
  );
  assert.equal(
    markdownLinkTarget(followUp, 'GitHub Actions run 34874957140'),
    'https://github.com/0xmdrakib/AgentDomain/actions/runs/34874957140',
  );
  assert.match(
    followUp,
    /attempt 1, from the same reviewed public commit `99232d692d736737100ed4dec5e1d75130c70c6e`/,
  );
  assert.match(
    followUp,
    /Registry metadata, sizes and SHA-256 hashes match the reviewed CI artifacts/,
  );
  assert.match(followUp, /identical copies of all four Python archives and the same manifest/);
  const artifacts = followUp
    .split(/\r?\n/)
    .filter((line) => /^\| (?:Wheel|Source distribution)\s*\|/.test(line))
    .map((line) =>
      line
        .split('|')
        .slice(1, -1)
        .map((cell) => cell.trim()),
    );
  assert.deepEqual(artifacts, [
    [
      'Wheel',
      '14,556 bytes',
      '`c93ec113a4acdfcd1821066d613e81f6ebe3589c755185c74b88357301063ed3`',
      '2026-09-14 17:14:44',
    ],
    [
      'Source distribution',
      '12,390 bytes',
      '`f6a56b78ed9786f6e335fca2474bce6d7a31eb1f6adcaacdd823143c7fea5892`',
      '2026-09-14 17:14:45',
    ],
    [
      'Wheel',
      '17,174 bytes',
      '`27b49abe4a43b93657b58d54d0fba6785b6a53c317313a8ccf7d930ca89bea00`',
      '2026-09-14 17:30:56.309991',
    ],
    [
      'Source distribution',
      '13,815 bytes',
      '`6cd122cc58b5c144992d4f751f171896a036703b4a83f80ff9e2358c5e1d3a37`',
      '2026-09-14 17:30:57.443951',
    ],
  ]);
  assert.match(followUp, /Cryptographic attestation verification passed for both CrewAI artifacts/);
  assert.match(
    followUp,
    /`pypi-attestations` 0\.0\.30 and Sigstore 4\.5\.0 with online production TUF/,
  );
  assert.match(
    followUp,
    /verified signatures, the `publish\/v1` predicate and signed artifact names\/hashes/,
  );
  assert.match(followUp, /`0xmdrakib\/AgentDomain` repository\/workflow at `refs\/heads\/main`/);
  assert.match(
    followUp,
    /signed Fulcio deployment-environment\s+claim also matches `pypi-production`/,
  );
  assert.match(
    followUp,
    /Cryptographic attestation verification also passed for both AutoGen artifacts/,
  );
  assert.match(followUp, /all four Python artifacts completed at 17:35:09 UTC/);
  assert.match(followUp, /official PyPA `Attestation\.verify` with online production TUF/);
  assert.match(followUp, /\*\*eight published packages\*\*: \*\*six npm packages\*\*/);
  assert.match(followUp, /\*\*two PyPI packages\*\*, all at \*\*0\.11\.0\*\*/);
  assert.doesNotMatch(followUp, /unpublished|source candidate|still pending/i);
  assert.match(
    followUp,
    /post-event publication follow-up,\s+not additional implementation claimed during ETHOnline/,
  );
});

test('the dated LangChain follow-up separates registry signatures from OIDC and preserves release history', async () => {
  const changelog = await readFile(new URL('../../../CHANGELOG.md', import.meta.url), 'utf8');
  const followUp = changelog.match(
    /^## LangChain 0\.11\.0 - 2026-09-14 Follow-Up\r?\n[\s\S]*?(?=^## )/m,
  )?.[0];
  assert.ok(followUp, 'Missing dated LangChain publication follow-up');
  assert.match(followUp, /`@agentdomain\/langchain-plugin@0\.11\.0` was published on npm/);
  assert.match(followUp, /approximately 14:25 UTC by `0xmdrakib`/);
  assert.match(followUp, /owner-authorized one-time local\s+publication with official npm web 2FA/);
  assert.match(followUp, /12,032-byte registry tarball has SHA-256/);
  assert.ok(followUp.includes('83295a7f7398f52e08314562a2e900a145177cbd863d186b1f702f9d6bb7c355'));
  assert.match(followUp, /SHA-512 matches the exact reviewed GitHub Actions archive/);
  assert.equal(
    markdownLinkTarget(followUp, 'run 34837830930'),
    'https://github.com/0xmdrakib/AgentDomain/actions/runs/34837830930',
  );
  assert.ok(followUp.includes('f975c685477d6602a12511701f36e429fb7fe1b1'));
  assert.match(
    followUp,
    /ECDSA signature, but this local publication has \*\*no\s+OIDC provenance\*\*/,
  );
  assert.match(
    followUp,
    /five earlier npm 0\.11\.0 releases below have verified\s+GitHub Actions OIDC provenance/,
  );
  assert.match(followUp, /that claim does not extend to LangChain/);
  assert.match(followUp, /six published npm packages/);
  assert.match(
    followUp,
    /two unpublished\s+Python source candidates\*\*, `agentdomain-crewai` and `agentdomain-autogen`/,
  );
  assert.match(
    followUp,
    /post-event publication follow-up, not additional\s+implementation claimed during ETHOnline/,
  );
  assert.match(changelog, /## npm 0\.11\.0 - 2026-09-14/);
  assert.match(changelog, /five packages before stopping at the first LangChain/);
  assert.match(changelog, /At the end of that run/);
  assert.match(changelog, /post-event publication update/);
  const eventRelease = changelog.match(
    /^## SDK\/MCP 0\.10\.0 - 2026-09-13\r?\n[\s\S]*?(?=^## )/m,
  )?.[0];
  assert.ok(eventRelease, 'Missing historical September 13 release');
  assert.match(
    eventRelease,
    /SDK and MCP 0\.10\.0 are published on npm with GitHub Actions provenance/,
  );
  assert.match(eventRelease, /separate LangChain\s+0\.1\.0 source candidate/);
  assert.match(eventRelease, /first npm publication\s+remains pending/);
  assert.doesNotMatch(eventRelease, /0\.11\.0|September 14|2026-09-14/);
});

test('event and AI disclosures separate their original checkpoint from later publication', async () => {
  for (const name of ['BUILT_DURING_ETHONLINE.md', 'AI_DISCLOSURE.md']) {
    const source = await readFile(new URL(`../../../${name}`, import.meta.url), 'utf8');
    assert.match(source, /At the September 13 checkpoint/);
    const postEvent = source.match(
      /^\*\*Post-event update, September 14:\*\*[\s\S]*?(?=\r?\n\r?\n)/m,
    )?.[0];
    assert.ok(postEvent, `${name}: missing current post-event summary`);
    assert.match(
      postEvent,
      /all eight packages are published at 0\.11\.0:\s+\*\*six npm packages and two PyPI packages\*\*/,
    );
    assert.match(postEvent, /`agentdomain-crewai` and\s+`agentdomain-autogen`/);
    assert.equal(
      markdownLinkTarget(postEvent, 'dated Python changelog'),
      'CHANGELOG.md#python-0110---2026-09-14-follow-up',
    );
    assert.match(
      postEvent,
      /registry and CI artifact evidence and verified cryptographic attestations for\s+both Python releases/,
    );
    assert.equal(
      markdownLinkTarget(postEvent, "LangChain's first local publication"),
      'CHANGELOG.md#langchain-0110---2026-09-14-follow-up',
    );
    assert.match(
      postEvent,
      /has no OIDC provenance; the five earlier npm releases have verified GitHub OIDC\s+provenance/,
    );
    assert.doesNotMatch(postEvent, /unpublished|source candidate|seven published|still pending/i);
  }
});

test('publication follow-ups preserve historical releases and all disclosure text outside the current summary', async () => {
  for (const [name, expectedHash] of [
    ['CHANGELOG.md', 'b028ff760c650ca6833d067a364942229521c3eb704ac8c8c1a7df62ba17305b'],
    [
      'BUILT_DURING_ETHONLINE.md',
      'ce07a2720ce62326645e9d1dc59dae2409e058d0ceae8cd826066999b42ec49b',
    ],
    ['AI_DISCLOSURE.md', '19a395defd8392b664f485f5d34796b687e535eae7368d13cd3b33d7d157c523'],
  ]) {
    const source = (
      await readFile(new URL(`../../../${name}`, import.meta.url), 'utf8')
    ).replaceAll('\r\n', '\n');
    // Freeze the pre-Python-publication text, independent of checkout line endings.
    const historical =
      name === 'CHANGELOG.md'
        ? source.slice(source.indexOf('## LangChain 0.11.0 - 2026-09-14 Follow-Up'))
        : source.replace(/^\*\*Post-event update, September 14:\*\*[\s\S]*?\n\n/m, '');
    assert.equal(createHash('sha256').update(historical).digest('hex'), expectedHash, name);
  }
});

test('inspection docs pin verified 0.11.0 releases without treating the source catalog as registry proof', async () => {
  const sdk = await doc('typescript');
  const mcp = await doc('mcp');
  assert.match(sdk, /npm install @agentdomain\/sdk@0\.11\.0 viem@2\.56\.3/);
  assert.match(mcp, /npm install --global @agentdomain\/mcp-server@0\.11\.0/);
  assert.match(sdk, /0\.11\.0 is published on npm/);
  assert.match(mcp, /0\.11\.0 is published on npm/);
  assert.match(sdk, /source manifest does not query or establish registry publication/);
  assert.match(mcp, /source metadata, not a\s+registry availability check/);
  for (const source of [sdk, mcp]) {
    assert.doesNotMatch(source, /0\.11\.0 is a release candidate/);
    assert.doesNotMatch(source, /source-build target|new source-checkout (?:feature|export)/);
    assert.doesNotMatch(source, /independent-identity-inspection-source-checkout/);
  }
  assert.match(sdk, /pnpm --filter @agentdomain\/sdk build/);
  assert.match(mcp, /node packages\/mcp-server\/dist\/index\.js/);
});

test('both interfaces document public read-only provenance and explicit trust limits', async () => {
  for (const name of ['typescript', 'mcp']) {
    const source = await doc(name);
    for (const term of [
      'RPC',
      'consensus',
      'SPV',
      'DNS',
      'KYC',
      'ERC-721',
      'ERC-8004',
      'safe',
      'rate limited',
      'EIP-1898',
      'requireCanonical: true',
    ]) {
      assert.ok(source.includes(term), `${name}: missing ${term}`);
    }
    assert.match(source, /not instructions|rather than instructions/);
    assert.match(source, /never fetches metadata|without being\s+fetched/);
    assert.match(source, /INVALID_INPUT/);
    assert.match(source, /WRONG_CHAIN/);
    assert.match(source, /UNSAFE_SNAPSHOT/);
    assert.match(source, /UNAVAILABLE/);
    assert.match(source, /expectedOwnerMatches/);
  }
});

test('SDK documentation does not conflate expected owner, activity and internal consistency', async () => {
  const source = await doc('typescript');
  assert.match(source, /does not include `expectedOwnerMatches`/);
  assert.match(source, /does not establish\s+agent safety or endorse its behavior/);
  assert.match(source, /not `not_found`/);
  assert.match(source, /manually choose and inject a trusted Base RPC client/);
  assert.match(source, /ccipRead: false/);
  assert.match(source, /before any\s+RPC request/);
  assert.match(source, /no numeric-block or\s+`latest` fallback/);
  assert.doesNotMatch(source, /uses that block number for the contract calls/);
});

test('MCP documents no caller-selected RPC, registry or network and no platform authentication', async () => {
  const source = await doc('mcp');
  assert.match(source, /without constructing an authenticated platform client/);
  assert.match(source, /does not switch chains/);
  assert.match(source, /network overrides are not accepted as tool arguments/);
  assert.match(source, /No wallet, platform API key or write-tool opt-in/);
});

test('renewal docs separate unsigned plans, future spending authority and actual completion', async () => {
  const source = await readFile(
    new URL('../src/content/docs/guides/renewal.mdx', import.meta.url),
    'utf8',
  );
  for (const name of [
    'inspectAgentRenewal',
    'prepareAutoRenewChange',
    'executeAutoRenewChange',
    'confirmAutoRenewChange',
  ])
    assert.ok(source.includes(name));
  assert.match(source, /not a registrar\s+quote/);
  assert.match(source, /without a new wallet signature for each renewal/);
  assert.match(source, /existing\s+pending reservation may still complete and charge/);
  assert.match(source, /model-supplied boolean or unconditional approval/);
  assert.match(source, /limited\s+to the same plan object/);
  assert.match(source, /settled `no_change` result is not retained/);
  assert.match(source, /requires a new host approval if a change is now needed/);
  assert.match(source, /receipt to be after the plan's recorded safe observation block/);
  assert.match(source, /not cryptographic proof that a\s+particular human approved/);
  assert.match(source, /not\*\*\s+that the domain/);
  assert.match(source, /network gas/);
});

test('public disclosures distinguish the pre-event baseline from both event contributions', async () => {
  const preexisting = await readFile(new URL('../../../PREEXISTING.md', import.meta.url), 'utf8');
  const built = await readFile(
    new URL('../../../BUILT_DURING_ETHONLINE.md', import.meta.url),
    'utf8',
  );
  const ai = await readFile(new URL('../../../AI_DISCLOSURE.md', import.meta.url), 'utf8');
  for (const value of [
    'f1bac8f44830cd8e57cfa148ad876ef6933966a0',
    '2026-09-03T04:22:48Z',
    '2026-09-06T01:18:16Z',
    '2026-09-08T22:33:10Z',
    '4ac0d284e603a2289c248a981821ee975899e699',
  ]) {
    assert.ok(preexisting.includes(value), `Missing baseline evidence: ${value}`);
  }
  assert.match(preexisting, /new event work in this entry, not pre-event code/);
  assert.match(built, /## 1\. Resumable, Wallet-Safe Registration/);
  assert.match(built, /## 2\. Independent Agent Identity Inspection/);
  assert.match(built, /do not create x402, the registry contract or a new registration contract/);
  assert.match(ai, /Founder testing and the final voice recording are not asserted complete/);
  for (const source of [preexisting, built, ai]) {
    assert.doesNotMatch(
      source,
      /coordinating implementation|frontend owner|parent handles|\bFermat\b/i,
    );
  }
});
