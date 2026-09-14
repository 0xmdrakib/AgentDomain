import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const doc = (name) =>
  readFile(new URL(`../src/content/docs/sdk/${name}.mdx`, import.meta.url), 'utf8');

test('the release catalog distinguishes six published npm packages from two Python source candidates', async () => {
  const readme = await readFile(new URL('../../../README.md', import.meta.url), 'utf8');
  const rows = readme.split('\n').filter((line) => /^\| \[/.test(line));
  assert.equal(rows.filter((line) => /\| Published 0\.11\.0\s*\|/.test(line)).length, 6);
  assert.equal(rows.filter((line) => /\| Source candidate 0\.11\.0\s*\|/.test(line)).length, 2);
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
      row.split('|')[1].trim(),
      `[\`@agentdomain/${name}\`](https://www.npmjs.com/package/@agentdomain/${name})`,
    );
    assert.match(row, /\| Published 0\.11\.0\s*\|/);
  }
  for (const name of ['crewai', 'autogen']) {
    const row = rows.find((line) => line.includes(`agentdomain-${name}`));
    assert.ok(row, `${name}: missing Python catalog entry`);
    assert.ok(row.includes(`(packages/${name}-plugin)`));
    assert.match(row, /\| Source candidate 0\.11\.0\s*\|/);
  }
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
  assert.match(
    followUp,
    /\[run 34837830930\]\(https:\/\/github\.com\/0xmdrakib\/AgentDomain\/actions\/runs\/34837830930\)/,
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
    assert.match(source, /Post-event update, September 14/);
    assert.match(
      source,
      /six npm packages (?:are now published at\s+0\.11\.0|are published at 0\.11\.0)/,
    );
    assert.match(
      source,
      /two Python (?:packages|distributions) remain unpublished source candidates/,
    );
    assert.match(source, /CHANGELOG\.md#langchain-0110---2026-09-14-follow-up/);
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
