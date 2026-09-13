import { parseArgs } from 'node:util';
import { createAgentDomainTools } from '@agentdomain/langchain-plugin';

const { values } = parseArgs({
  options: {
    domain: { type: 'string' },
    token: { type: 'string' },
    owner: { type: 'string' },
    renewal: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
});
if (values.help) {
  console.log(
    'node examples/inspect.mjs (--domain DOMAIN | --token ID) [--owner ADDRESS] [--renewal]',
  );
} else {
  const input = {
    ...(values.domain === undefined ? {} : { domain: values.domain }),
    ...(values.token === undefined ? {} : { tokenId: values.token }),
    ...(values.owner === undefined ? {} : { expectedOwner: values.owner }),
  };
  const name = values.renewal ? 'inspect_agent_renewal' : 'inspect_agent_identity';
  const inspection = createAgentDomainTools().find((candidate) => candidate.name === name);
  try {
    const result = await inspection.invoke(input);
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  } catch {
    console.error('Invalid tool input. Use --help for the accepted arguments.');
    process.exitCode = 1;
  }
}
