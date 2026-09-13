import { createAgentDomainTools, type AgentDomainToolResult } from '../src/index.js';
import type { IdentityInspectionResult, AutoRenewChangePlan } from '@agentdomain/sdk';

// Compiled only. These calls prove the public tools preserve SDK input/output
// types; this file is never executed or emitted by the test suite.
async function contract() {
  const tools = createAgentDomainTools({ includeUnsignedPlans: true });
  const identity = tools.find((candidate) => candidate.name === 'inspect_agent_identity')!;
  const result: AgentDomainToolResult<IdentityInspectionResult> = await identity.invoke({
    tokenId: '1',
  });
  if (result.ok && result.data.status === 'found') {
    const token: string = result.data.tokenId;
    const owner: `0x${string}` = result.data.nftOwner;
    void [token, owner];
  }
  // @ts-expect-error Token IDs must not lose precision as JSON numbers.
  await identity.invoke({ tokenId: 1 });
  const prepare = tools.find((candidate) => candidate.name === 'prepare_auto_renew_change')!;
  const plan: AgentDomainToolResult<AutoRenewChangePlan> = await prepare.invoke({
    tokenId: '1',
    expectedOwner: '0x1111111111111111111111111111111111111111',
    enabled: false,
    builderCode: 'example_app',
  });
  void plan;
  // @ts-expect-error All four primitive planning fields are mandatory.
  await prepare.invoke({ tokenId: '1', enabled: false });
  // @ts-expect-error Host configuration accepts clients, not raw model RPC URLs.
  createAgentDomainTools({ rpcUrl: 'https://untrusted.example.invalid' });
}
void contract;
