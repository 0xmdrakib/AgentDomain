import { parseArgs } from 'node:util';
import { AgentDomain } from '@agentdomain/sdk';
import { createAgentDomainTools } from '@agentdomain/langchain-plugin';

const { values } = parseArgs({ options: { agent: { type: 'string' }, help: { type: 'boolean' } } });
if (values.help) {
  console.log('node examples/api-lookup.mjs --agent UUID');
  console.log('AGENTDOMAIN_API_KEY is optional host configuration, never a tool argument.');
} else {
  const apiClient = new AgentDomain({ apiKey: process.env.AGENTDOMAIN_API_KEY });
  const lookup = createAgentDomainTools({ apiClient }).find(
    (candidate) => candidate.name === 'lookup_agent',
  );
  try {
    const result = await lookup.invoke({ agentId: values.agent });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  } catch {
    console.error('A valid agent UUID is required. No API result was confirmed.');
    process.exitCode = 1;
  }
}
