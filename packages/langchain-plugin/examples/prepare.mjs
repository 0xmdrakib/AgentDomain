import { parseArgs } from 'node:util';
import { createAgentDomainTools } from '@agentdomain/langchain-plugin';

const { values } = parseArgs({
  options: {
    token: { type: 'string' },
    owner: { type: 'string' },
    enabled: { type: 'string' },
    'builder-code': { type: 'string' },
    help: { type: 'boolean', default: false },
  },
});
if (values.help) {
  console.log(
    'node examples/prepare.mjs --token ID --owner ADDRESS --enabled true|false --builder-code CODE',
  );
  console.log(
    'Outputs an unsigned plan only. No wallet, approval, payment or execution is performed.',
  );
} else if (!['true', 'false'].includes(values.enabled)) {
  console.error('--enabled must be explicitly true or false. Nothing was prepared.');
  process.exitCode = 1;
} else {
  const preparation = createAgentDomainTools({ includeUnsignedPlans: true }).find(
    (candidate) => candidate.name === 'prepare_auto_renew_change',
  );
  try {
    const result = await preparation.invoke({
      tokenId: values.token,
      expectedOwner: values.owner,
      enabled: values.enabled === 'true',
      builderCode: values['builder-code'],
    });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  } catch {
    console.error('Invalid plan inputs. Use --help for the accepted arguments.');
    process.exitCode = 1;
  }
}
