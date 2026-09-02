export interface SolutionSection {
  title: string;
  body: string;
  points?: string[];
}

export interface SolutionPageDefinition {
  slug: string;
  path: string;
  title: string;
  description: string;
  eyebrow: string;
  heading: string;
  introduction: readonly string[];
  distinction: string;
  flow: Array<{ label: string; detail: string }>;
  sections: SolutionSection[];
  codeTitle: string;
  code: string;
  codeCaption: string;
  related: Array<{ title: string; description: string; href: string }>;
}

const solutionPages: SolutionPageDefinition[] = [
  {
    slug: 'ai-agent-identity',
    path: '/ai-agent-identity',
    title: 'AI Agent Identity: Persistent Internet Identity for Autonomous Agents',
    description:
      'Learn how AI agent internet identity combines a domain, professional email, DNS, SSL, onchain AgentID, and autonomous lifecycle management.',
    eyebrow: 'AI agent identity',
    heading: 'An internet identity an AI agent can own, use, and maintain',
    introduction: [
      'An autonomous agent needs more than an API key or a wallet address.',
      'It needs a stable name, a secure endpoint, a professional communication channel, and a lifecycle that does not depend on a human remembering multiple dashboards.',
    ],
    distinction:
      'AgentDomain addresses public internet identity, not enterprise workforce IAM. IAM decides who may access an internal resource. AgentDomain provisions how an agent is named, reached, verified, and kept online across the public internet and Base.',
    flow: [
      { label: 'Name', detail: 'Provision a real internet domain and optional onchain names.' },
      { label: 'Reach', detail: 'Configure DNS, HTTPS, and professional email.' },
      { label: 'Verify', detail: 'Link the identity to an AgentID and owner wallet on Base.' },
      { label: 'Persist', detail: 'Monitor expiry and fund autonomous renewals.' },
    ],
    sections: [
      {
        title: 'Identity must survive the agent process',
        body: 'A model session, framework process, or API deployment can change without breaking the identity. The domain and AgentID remain durable references that other people, services, and agents can resolve.',
      },
      {
        title: 'One owner, multiple interoperable surfaces',
        body: 'The owner wallet anchors control while the domain, DNS, email, Basename, ENS option, and AgentID expose the identity in the environments where agents actually operate.',
      },
      {
        title: 'Built for both agents and developers',
        body: 'Humans can use the web interface. Autonomous systems can use the REST API, TypeScript SDK, MCP server, Coinbase AgentKit plugin, ElizaOS plugin, and tool adapters without a separate product model.',
      },
    ],
    codeTitle: 'Discover the platform contract',
    code: `const response = await fetch('https://api.agentdomain.app/api/v1');
const discovery = await response.json();

console.log(discovery.capabilities);
console.log(discovery.endpoints);`,
    codeCaption:
      'The API discovery document gives software agents a machine-readable entry point before authentication or purchase.',
    related: [
      {
        title: 'Onchain agent identity',
        description: 'How AgentID, Basename, and ENS fit together.',
        href: '/onchain-agent-identity',
      },
      {
        title: 'Domains for AI agents',
        description: 'Give an agent a resolvable internet name.',
        href: '/domains-for-ai-agents',
      },
      {
        title: 'Autonomous renewals',
        description: 'Keep the identity reachable over time.',
        href: '/autonomous-agent-renewals',
      },
    ],
  },
  {
    slug: 'domains-for-ai-agents',
    path: '/domains-for-ai-agents',
    title: 'Domains for AI Agents: Autonomous Domain Provisioning',
    description:
      'Give an AI agent a real domain with live pricing, programmable registration, managed DNS, SSL, email, and renewal infrastructure.',
    eyebrow: 'Domains for AI agents',
    heading: 'Move AI agents from temporary endpoints to durable internet names',
    introduction: [
      'A domain gives an agent a stable public address that is independent of a model vendor, hosting process, or framework.',
      'AgentDomain makes domain search, payment, provisioning, and maintenance available through one programmable lifecycle.',
    ],
    distinction:
      'This is not a generated subdomain or a label inside a closed directory. AgentDomain provisions a registrar-backed domain and connects the infrastructure required to use it.',
    flow: [
      { label: 'Search', detail: 'Check real-time availability and provider pricing.' },
      { label: 'Quote', detail: 'See domain cost, platform fee, and selected services.' },
      { label: 'Pay', detail: 'Authorize an x402 v2 USDC payment on Base.' },
      { label: 'Provision', detail: 'Create DNS, SSL, email, metadata, and AgentID state.' },
    ],
    sections: [
      {
        title: 'Live pricing before commitment',
        body: 'Availability and pricing are requested before registration, so an agent or developer can evaluate the actual domain and complete a specific quote rather than relying on a stale catalog.',
      },
      {
        title: 'Infrastructure follows the domain',
        body: 'Managed DNS, HTTPS, professional email, and identity metadata are provisioned as coordinated states. System-managed records remain protected while owners retain programmable DNS control.',
      },
      {
        title: 'Lifecycle, not a one-time purchase',
        body: 'Expiry state, renewal quotes, RenewalVault funding, and owner-authorized renewal controls are part of the same identity instead of a separate registrar workflow.',
      },
    ],
    codeTitle: 'Request a live registration quote',
    code: `const params = new URLSearchParams({
  preferredName: 'example-agent',
  tld: 'xyz',
  years: '1',
  premiumPlan: 'included'
});

const quote = await fetch(
  'https://api.agentdomain.app/api/v1/agents/quote?' + params.toString()
);`,
    codeCaption:
      'The quote step returns the current payment requirements before any registration is submitted.',
    related: [
      {
        title: 'Domain registration API',
        description: 'Integrate the full flow in software.',
        href: '/domain-registration-api',
      },
      {
        title: 'DNS for AI agents',
        description: 'Manage the domain after registration.',
        href: '/dns-for-ai-agents',
      },
      {
        title: 'x402 agent payments',
        description: 'Understand wallet-native purchasing.',
        href: '/x402-agent-payments',
      },
    ],
  },
  {
    slug: 'email-for-ai-agents',
    path: '/email-for-ai-agents',
    title: 'Email for AI Agents: Professional Inbox and Sending Infrastructure',
    description:
      'Professional domain email for AI agents with API sending, inbound processing, signed webhooks, quotas, blocklists, and 30-day message retention.',
    eyebrow: 'Email for AI agents',
    heading: 'A professional email identity that an agent can operate through APIs',
    introduction: [
      'Email remains the common communication layer for businesses, users, verification workflows, and services that do not expose an agent-native protocol.',
      'AgentDomain connects professional email to the same identity that owns the domain.',
    ],
    distinction: 'Email is currently text-only. Rich HTML and attachments are not supported.',
    flow: [
      { label: 'Address', detail: 'Use a professional address on the agent domain.' },
      { label: 'Send', detail: 'Queue authenticated single or batch messages through the API.' },
      { label: 'Receive', detail: 'Process valid inbound messages and verification codes.' },
      { label: 'Notify', detail: 'Deliver signed events to the agent webhook.' },
    ],
    sections: [
      {
        title: 'Combined capacity is predictable',
        body: 'Each plan has one monthly sent-plus-received allowance. Outbound recipients and accepted inbound messages count as units, while burst protection is enforced separately at 12 API requests per second per agent.',
      },
      {
        title: 'Inbound events can reach the agent',
        body: 'An owner can configure one HTTPS webhook with signed event identifiers, delivery retries, logs, and replay controls. Metadata is always available; optional inline text is bounded.',
      },
      {
        title: 'Retention is deliberately short',
        body: 'Message content and delivery artifacts follow a 30-day retention policy. Durable identity, billing, and payment records are separate from temporary communication content.',
      },
    ],
    codeTitle: 'Queue a text email',
    code: `const result = await fetch(
  'https://api.agentdomain.app/api/v1/agents/AGENT_ID/email/send',
  {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer ' + process.env.AGENTDOMAIN_API_KEY
    },
    body: JSON.stringify({
      to: ['recipient@example.com'],
      subject: 'Identity status',
      text: 'The agent identity is active.'
    })
  }
);`,
    codeCaption:
      'Accepted requests enter the durable delivery workflow and expose a trackable message status.',
    related: [
      {
        title: 'AI agent identity',
        description: 'Connect communication to a durable identity.',
        href: '/ai-agent-identity',
      },
      {
        title: 'DNS for AI agents',
        description: 'Understand SPF, DKIM, and managed records.',
        href: '/dns-for-ai-agents',
      },
      {
        title: 'MCP integration',
        description: 'Operate infrastructure through agent tools.',
        href: '/integrations/mcp',
      },
    ],
  },
  {
    slug: 'dns-for-ai-agents',
    path: '/dns-for-ai-agents',
    title: 'DNS for AI Agents: Programmable DNS and SSL Management',
    description:
      'Manage all 13 supported DNS record types through the AgentDomain dashboard, API, SDK, MCP, AgentKit, and ElizaOS.',
    eyebrow: 'DNS for AI agents',
    heading: 'Professional DNS control through the same interface an agent already uses',
    introduction: [
      'DNS connects an agent identity to websites, APIs, email, verification, and service discovery.',
      'AgentDomain exposes structured records, type-aware validation, protected system records, and safe bulk workflows.',
    ],
    distinction:
      'AgentDomain supports these record types: A, AAAA, ALIAS, CAA, CNAME, HTTPS, MX, NS, PTR, SRV, SVCB, TLSA, and TXT. It does not claim support for every specialized IANA type.',
    flow: [
      { label: 'Inspect', detail: 'Read current user and system-managed records.' },
      { label: 'Validate', detail: 'Parse type-specific structured fields and constraints.' },
      { label: 'Preview', detail: 'Diff bulk changes against a revisioned snapshot.' },
      { label: 'Apply', detail: 'Reconcile only changed records and preserve unchanged state.' },
    ],
    sections: [
      {
        title: 'Structured records prevent ambiguous input',
        body: 'MX, SRV, CAA, TLSA, HTTPS, and SVCB expose their real fields instead of requiring users or agents to assemble fragile strings. Legacy value and priority inputs remain compatible.',
      },
      {
        title: 'Automation records are protected',
        body: 'SSL, email, verification, and routing records are marked system-managed. Replace and import operations cannot silently remove them, while user-managed capacity follows the active plan.',
      },
      {
        title: 'Bulk changes are reviewable',
        body: 'BIND import and JSON batches support dry-run previews, revision checks, merge or safe replace semantics, bounded requests, and reconciliation reporting on partial provider failures.',
      },
    ],
    codeTitle: 'Ask for machine-readable DNS capabilities',
    code: `const capabilities = await fetch(
  'https://api.agentdomain.app/api/v1/agents/AGENT_ID/dns/capabilities',
  { headers: { authorization: 'Bearer ' + process.env.AGENTDOMAIN_API_KEY } }
).then((response) => response.json());

console.log(capabilities.supportedTypes);`,
    codeCaption:
      'Agents can discover supported fields and constraints instead of hard-coding a dashboard form.',
    related: [
      {
        title: 'Domains for AI agents',
        description: 'Start with a registrar-backed name.',
        href: '/domains-for-ai-agents',
      },
      {
        title: 'Professional agent email',
        description: 'See how DNS supports communication.',
        href: '/email-for-ai-agents',
      },
      {
        title: 'Domain registration API',
        description: 'Provision and manage through code.',
        href: '/domain-registration-api',
      },
    ],
  },
  {
    slug: 'domain-registration-api',
    path: '/domain-registration-api',
    title: 'Domain Registration API for AI Agents and Developers',
    description:
      'Search, quote, pay for, and provision an agent domain through a Base-native API with idempotent registration and machine-readable status.',
    eyebrow: 'Domain registration API',
    heading: 'Turn domain registration into a programmable agent operation',
    introduction: [
      'Traditional registrars assume a person will use a card, dashboard, and DNS console.',
      'AgentDomain exposes discovery, availability, quote, x402 payment requirements, registration, and status through one API surface.',
    ],
    distinction:
      'The API coordinates a real registrar order and downstream infrastructure. It is not a simulated naming registry or a wrapper that stops after payment.',
    flow: [
      { label: 'Discover', detail: 'Read supported capabilities and endpoint contracts.' },
      { label: 'Quote', detail: 'Resolve live availability and the complete cost snapshot.' },
      { label: 'Authorize', detail: 'Sign the x402 v2 USDC payment requirement.' },
      { label: 'Track', detail: 'Follow provisioning state without submitting payment twice.' },
    ],
    sections: [
      {
        title: 'Idempotency protects paid operations',
        body: 'Registration requests use idempotency so a network retry does not create a second purchase. Payment and provisioning progress remain inspectable after an interrupted client request.',
      },
      {
        title: 'The response represents a lifecycle',
        body: 'The resulting identity connects registrar state, metadata, DNS, SSL, email, onchain names, AgentID, ownership, expiration, and renewal configuration.',
      },
      {
        title: 'One contract across integration surfaces',
        body: 'The TypeScript SDK and agent framework integrations consume the same public API behavior, so a developer does not have to learn a different purchase model for each framework.',
      },
    ],
    codeTitle: 'Start from API discovery',
    code: `curl https://api.agentdomain.app/api/v1

# Then request a quote:
curl "https://api.agentdomain.app/api/v1/agents/quote?preferredName=example-agent&tld=xyz&years=1"`,
    codeCaption:
      'The discovery endpoint is public; owner and paid operations add the required authentication and x402 headers.',
    related: [
      {
        title: 'x402 agent payments',
        description: 'Read the payment handshake.',
        href: '/x402-agent-payments',
      },
      {
        title: 'Coinbase AgentKit',
        description: 'Use the API as AgentKit actions.',
        href: '/integrations/coinbase-agentkit',
      },
      {
        title: 'Autonomous renewals',
        description: 'Continue after initial registration.',
        href: '/autonomous-agent-renewals',
      },
    ],
  },
  {
    slug: 'x402-agent-payments',
    path: '/x402-agent-payments',
    title: 'x402 Agent Payments for Domains and Identity Infrastructure',
    description:
      'How AgentDomain uses x402 v2 and Coinbase CDP to let agents and developers purchase domains, identity infrastructure, and plan upgrades in USDC on Base.',
    eyebrow: 'x402 agent payments',
    heading: 'Let software pay for its own identity infrastructure over HTTP',
    introduction: [
      'AgentDomain uses the x402 payment handshake to present a precise Base-mainnet USDC requirement for registration and premium infrastructure purchases.',
      'The client signs the authorization, then retries the HTTP operation with payment proof.',
    ],
    distinction:
      'The facilitator verifies and settles the payment; AgentDomain still validates the quote, payer, resource, amount, network, idempotency, and resulting provisioning state. A 402 response is part of the API contract, not an application error.',
    flow: [
      { label: 'Request', detail: 'Call a paid endpoint without payment proof.' },
      { label: '402', detail: 'Receive the exact v2 payment requirements.' },
      { label: 'Sign', detail: 'Authorize USDC on Base with the payer wallet.' },
      { label: 'Retry', detail: 'Submit proof, settle, and continue the operation.' },
    ],
    sections: [
      {
        title: 'Wallet-native for agents and developers',
        body: 'The same payment contract works for an autonomous runtime holding a signer and for a human developer using the web app. Both receive the same quoted resource and settlement evidence.',
      },
      {
        title: 'Coinbase CDP facilitator',
        body: 'Production payment requirements use x402 version 2 on Base and are verified and settled through the official Coinbase CDP facilitator rather than a third-party facilitator.',
      },
      {
        title: 'Provisioning remains recoverable',
        body: 'Payment settlement and resource provisioning are distinct durable states. If downstream work is interrupted, the platform resumes or reports progress without asking the payer to authorize the same purchase again.',
      },
    ],
    codeTitle: 'Recognize the payment requirement',
    code: `const response = await fetch(paidEndpoint, request);

if (response.status === 402) {
  const requirement = response.headers.get('PAYMENT-REQUIRED');
  // Sign the x402 v2 Base USDC requirement,
  // then retry with PAYMENT-SIGNATURE.
}`,
    codeCaption:
      'Payment headers remain uncached and bind the authorization to the quoted operation.',
    related: [
      {
        title: 'Domain registration API',
        description: 'See the paid registration operation.',
        href: '/domain-registration-api',
      },
      {
        title: 'Onchain agent identity',
        description: 'See what the registration anchors.',
        href: '/onchain-agent-identity',
      },
      {
        title: 'Coinbase AgentKit',
        description: 'Use x402 flows from AgentKit.',
        href: '/integrations/coinbase-agentkit',
      },
    ],
  },
  {
    slug: 'onchain-agent-identity',
    path: '/onchain-agent-identity',
    title: 'Onchain Agent Identity with AgentID, Basename, and ENS',
    description:
      'Connect an AI agent domain to an owner wallet, Base AgentID, optional Basename, and optional ENS name without replacing its internet identity.',
    eyebrow: 'Onchain agent identity',
    heading: 'Connect internet identity to verifiable ownership on Base',
    introduction: [
      'A domain makes an agent reachable across the internet.',
      'An onchain identity makes ownership and state inspectable in a wallet-native environment. AgentDomain links those surfaces without pretending one can replace the other.',
    ],
    distinction:
      'AgentID, Basename, ENS, and a DNS domain have different resolution and ownership models. AgentDomain coordinates them as one identity bundle while preserving each system as an explicit component.',
    flow: [
      { label: 'Own', detail: 'Bind the identity lifecycle to an owner wallet.' },
      { label: 'Mint', detail: 'Create the AgentID record on Base.' },
      { label: 'Name', detail: 'Optionally provision Basename and ENS labels.' },
      { label: 'Resolve', detail: 'Expose domain and metadata references to other systems.' },
    ],
    sections: [
      {
        title: 'AgentID is the onchain identity anchor',
        body: 'The AgentID contract records the identity token and metadata relationship on Base. The public product surfaces the token identifier and owner address alongside the internet domain.',
      },
      {
        title: 'Names are complementary',
        body: 'A Basename provides a Base-native name, ENS offers an optional Ethereum naming surface, and the traditional domain remains the universal web, DNS, SSL, and email address.',
      },
      {
        title: 'Ownership gates sensitive operations',
        body: 'Public discovery remains readable, while keys, DNS mutation, plan changes, renewal settings, and other management actions require the owner or an explicitly authorized agent credential.',
      },
    ],
    codeTitle: 'Read an identity through the API',
    code: `const identity = await fetch(
  'https://api.agentdomain.app/api/v1/agents/AGENT_ID'
).then((response) => response.json());

console.log(identity.domain);
console.log(identity.agentIdNft);
console.log(identity.ownerAddress);`,
    codeCaption:
      'The public identity view connects readable internet state to verifiable Base ownership.',
    related: [
      {
        title: 'AI agent identity',
        description: 'Understand the complete identity model.',
        href: '/ai-agent-identity',
      },
      {
        title: 'x402 payments',
        description: 'Purchase the identity in USDC.',
        href: '/x402-agent-payments',
      },
      {
        title: 'Public registry',
        description: 'Discover published identities.',
        href: '/registry',
      },
    ],
  },
  {
    slug: 'autonomous-agent-renewals',
    path: '/autonomous-agent-renewals',
    title: 'Autonomous Agent Renewals for Persistent Domains and Identities',
    description:
      'Keep an AI agent domain and identity reachable with expiry monitoring, owner-controlled auto-renew, USDC RenewalVault funding, and durable renewal state.',
    eyebrow: 'Autonomous agent renewals',
    heading: 'Keep an agent identity alive without a calendar reminder or card dashboard',
    introduction: [
      'Identity only becomes durable when the domain and connected services can survive renewal deadlines.',
      'AgentDomain tracks the identity period, prepares renewal pricing, and supports owner-authorized renewal funding on Base.',
    ],
    distinction:
      'Auto-renew is not an unlimited withdrawal permission. The owner controls activation and RenewalVault funding, while the platform records renewal attempts and the resulting registrar and identity state.',
    flow: [
      { label: 'Monitor', detail: 'Track domain and identity expiration.' },
      { label: 'Quote', detail: 'Calculate the current renewal requirement.' },
      { label: 'Fund', detail: 'Deposit USDC into the owner-controlled RenewalVault.' },
      { label: 'Renew', detail: 'Execute and persist the coordinated lifecycle update.' },
    ],
    sections: [
      {
        title: 'One renewal view for the bundle',
        body: 'The owner can see expiry, selected service plan, renewal pricing, vault balance, auto-renew state, and recent attempts without reconciling several provider dashboards.',
      },
      {
        title: 'Owner authorization remains explicit',
        body: 'Enabling auto-renew, approving USDC, funding the vault, and withdrawing unused funds remain wallet operations. API keys cannot silently assume owner-level payment authority.',
      },
      {
        title: 'Failures are visible and recoverable',
        body: 'Renewal attempts have durable status and error information. A temporary provider failure can be retried without hiding the identity state or inventing a successful renewal.',
      },
    ],
    codeTitle: 'Inspect renewal status',
    code: `const status = await fetch(
  'https://api.agentdomain.app/api/v1/agents/AGENT_ID/renewal/status',
  { headers: { authorization: 'Bearer ' + process.env.AGENTDOMAIN_API_KEY } }
).then((response) => response.json());

console.log(status.nextRenewalAt);
console.log(status.autoRenew);`,
    codeCaption:
      'The status contract helps a human or agent decide whether funding or owner action is required.',
    related: [
      {
        title: 'Domains for AI agents',
        description: 'See the initial registration lifecycle.',
        href: '/domains-for-ai-agents',
      },
      {
        title: 'x402 payments',
        description: 'Understand wallet-native payment operations.',
        href: '/x402-agent-payments',
      },
      {
        title: 'AgentKit integration',
        description: 'Expose renewal operations as actions.',
        href: '/integrations/coinbase-agentkit',
      },
    ],
  },
];

const integrationPages: SolutionPageDefinition[] = [
  {
    slug: 'mcp',
    path: '/integrations/mcp',
    title: 'AgentDomain MCP Server for AI Agent Identity Operations',
    description:
      'Connect MCP-compatible agents to AgentDomain discovery, domain search, registration, DNS, email, plan, usage, webhook, and renewal operations.',
    eyebrow: 'MCP integration',
    heading: 'Give MCP-compatible agents tools for their own internet infrastructure',
    introduction: [
      'The AgentDomain MCP server translates the public platform contract into discoverable tools.',
      'An MCP host can inspect capabilities, perform safe reads, and invoke authenticated or paid operations with the appropriate credentials and signer.',
    ],
    distinction:
      'The MCP server is a public integration layer. Payment, provisioning, and credential-handling systems remain server-side and are not published here.',
    flow: [
      { label: 'Connect', detail: 'Run the public MCP package in the agent environment.' },
      { label: 'Discover', detail: 'Expose typed AgentDomain tools to the MCP host.' },
      { label: 'Authorize', detail: 'Provide an agent-scoped key or owner signer when required.' },
      { label: 'Operate', detail: 'Search, register, configure, communicate, and renew.' },
    ],
    sections: [
      {
        title: 'Tools mirror the production API',
        body: 'MCP operations use the same schemas and stable error contracts as the REST API and SDK. This prevents an integration-only behavior from drifting away from the product.',
      },
      {
        title: 'Authority remains scoped',
        body: 'Public discovery is open, agent-scoped API keys operate allowed resources, and owner-only payment or management operations still require a wallet signer.',
      },
      {
        title: 'Install from the public package',
        body: 'The MCP server is published as an Apache-2.0 package from the reviewed public repository. Private platform implementation and secrets are not included.',
      },
    ],
    codeTitle: 'Start the MCP server',
    code: `npx @agentdomain/mcp-server

# Configure the host with:
AGENTDOMAIN_API_URL=https://api.agentdomain.app/api/v1
AGENTDOMAIN_API_KEY=your_agent_scoped_key`,
    codeCaption:
      'The server can be connected to an MCP host using the package command and environment-scoped credentials.',
    related: [
      {
        title: 'Developer documentation',
        description: 'Review the current integration contract.',
        href: 'https://docs.agentdomain.app',
      },
      {
        title: 'Domain registration API',
        description: 'See the API beneath the tools.',
        href: '/domain-registration-api',
      },
      {
        title: 'DNS for AI agents',
        description: 'Discover structured DNS operations.',
        href: '/dns-for-ai-agents',
      },
    ],
  },
  {
    slug: 'coinbase-agentkit',
    path: '/integrations/coinbase-agentkit',
    title: 'Coinbase AgentKit Integration for Agent Domains and x402',
    description:
      'Use AgentDomain actions inside Coinbase AgentKit for Base-native domain search, x402 registration, identity management, DNS, email, and renewals.',
    eyebrow: 'Coinbase AgentKit integration',
    heading: 'Connect Base-native agent wallets to real internet identity infrastructure',
    introduction: [
      'The AgentDomain AgentKit action provider lets an AgentKit runtime discover and invoke identity operations.',
      'It uses the wallet and Base capabilities already present in the agent stack.',
    ],
    distinction:
      'AgentKit supplies the agent runtime and wallet integration. AgentDomain supplies registrar, DNS, SSL, email, AgentID, plan, and renewal lifecycle operations behind a consistent API.',
    flow: [
      { label: 'Install', detail: 'Add the public AgentDomain AgentKit plugin.' },
      { label: 'Register', detail: 'Attach the action provider to the AgentKit runtime.' },
      { label: 'Quote', detail: 'Discover live domain and identity payment requirements.' },
      { label: 'Execute', detail: 'Use the Base wallet for owner-authorized x402 operations.' },
    ],
    sections: [
      {
        title: 'Native alignment with Base',
        body: 'AgentDomain registrations and premium purchases use USDC on Base through x402 v2 and Coinbase CDP. The resulting identity includes an AgentID on Base and optional Basename support.',
      },
      {
        title: 'Actions stay typed and constrained',
        body: 'The plugin maps AgentKit actions to the reviewed SDK and API schemas. DNS capabilities, plan SKUs, and validation bounds remain machine-readable rather than prompt-only instructions.',
      },
      {
        title: 'Agents and developers share one system',
        body: 'A developer can verify the same identity in the web dashboard while the AgentKit runtime uses programmatic operations. There is no separate shadow registry for autonomous clients.',
      },
    ],
    codeTitle: 'Register the AgentDomain action provider',
    code: `import { AgentDomainActionProvider }
  from '@agentdomain/agentkit-plugin';

const agentkit = await AgentKit.from({
  walletProvider,
  actionProviders: [new AgentDomainActionProvider()]
});`,
    codeCaption:
      'The public plugin adds AgentDomain actions without embedding private provisioning logic in the agent runtime.',
    related: [
      {
        title: 'x402 agent payments',
        description: 'Understand the payment handshake.',
        href: '/x402-agent-payments',
      },
      {
        title: 'Onchain agent identity',
        description: 'See the Base identity result.',
        href: '/onchain-agent-identity',
      },
      {
        title: 'MCP integration',
        description: 'Use AgentDomain from another agent protocol.',
        href: '/integrations/mcp',
      },
    ],
  },
];

export function getSolutionPage(slug: string) {
  return solutionPages.find((page) => page.slug === slug) ?? null;
}

export function getIntegrationPage(slug: string) {
  return integrationPages.find((page) => page.slug === slug) ?? null;
}

export const solutionSlugs = solutionPages.map((page) => page.slug);
export const integrationSlugs = integrationPages.map((page) => page.slug);
