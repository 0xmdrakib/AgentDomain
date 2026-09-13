import { tool } from '@langchain/core/tools';
import {
  inspectAgentIdentity,
  inspectAgentRenewal,
  prepareAutoRenewChange,
  IdentityInspectionError,
  RenewalWorkflowError,
  type IdentityInspectionInput,
} from '@agentdomain/sdk';
import {
  agentLookupSchema,
  autoRenewChangeSchema,
  identityInspectionSchema,
  registrationStatusSchema,
} from './schemas.js';
import type {
  AgentDomainToolErrorCode,
  AgentDomainToolResult,
  AgentDomainToolsOptions,
} from './types.js';

export {
  agentLookupSchema,
  autoRenewChangeSchema,
  identityInspectionSchema,
  registrationStatusSchema,
} from './schemas.js';
export type {
  AgentDomainToolErrorCode,
  AgentDomainToolResult,
  AgentDomainToolsOptions,
} from './types.js';

const inspectionMessages = {
  INVALID_INPUT:
    'Provide valid identity or auto-renew inputs. No observation or plan was confirmed.',
  WRONG_CHAIN: 'The RPC returned another network. No Base observation was confirmed.',
  UNSAFE_SNAPSHOT:
    'The safe block changed or could not be confirmed. No observation was confirmed.',
  UNAVAILABLE: 'The RPC observation is unavailable. No identity or renewal state was confirmed.',
  IDENTITY_NOT_FOUND: 'The identity was not found. No auto-renew plan was prepared.',
  OWNER_MISMATCH: 'The expected wallet does not match the current NFT owner. No plan was prepared.',
  INCONSISTENT_STATE: 'Canonical identity or renewal records differ. No plan was prepared.',
  REVOKED: 'Auto-renew cannot be enabled for this revoked identity.',
  EXPIRED_TOO_LONG: 'This identity is past the supported renewal window.',
  PLAN_INVALID: 'The auto-renew plan is invalid. No change was submitted.',
  APPROVAL_REQUIRED: 'A separate trusted human approval is required. No change was submitted.',
  STALE_PLAN: 'The auto-renew state changed. No change was submitted.',
} satisfies Record<Exclude<AgentDomainToolErrorCode, 'API_UNAVAILABLE'>, string>;

async function observation<T>(read: () => Promise<T>): Promise<AgentDomainToolResult<T>> {
  try {
    return { ok: true, data: await read() };
  } catch (error) {
    const code =
      error instanceof IdentityInspectionError || error instanceof RenewalWorkflowError
        ? error.code
        : 'UNAVAILABLE';
    return { ok: false, error: { code, message: inspectionMessages[code] } };
  }
}

async function apiRead<T>(read: () => Promise<T>): Promise<AgentDomainToolResult<T>> {
  try {
    return { ok: true, data: await read() };
  } catch {
    return {
      ok: false,
      error: {
        code: 'API_UNAVAILABLE',
        message: 'The configured AgentDomain API read failed. No API status was confirmed.',
      },
    };
  }
}

function identityInput(input: {
  domain?: string;
  tokenId?: string;
  expectedOwner?: string;
}): IdentityInspectionInput {
  if ((input.domain === undefined) === (input.tokenId === undefined)) {
    throw new IdentityInspectionError('INVALID_INPUT', inspectionMessages.INVALID_INPUT);
  }
  const expected = input.expectedOwner === undefined ? {} : { expectedOwner: input.expectedOwner };
  return input.domain !== undefined
    ? { domain: input.domain, ...expected }
    : { tokenId: input.tokenId!, ...expected };
}

/** Real LangChain tools. No tool in this package submits, signs, or pays for a transaction. */
export function createAgentDomainTools(options: AgentDomainToolsOptions = {}) {
  const { publicClient, apiClient } = options;
  const identityTool = tool(
    (input) => observation(() => inspectAgentIdentity(identityInput(input), { publicClient })),
    {
      name: 'inspect_agent_identity',
      description:
        'Read the canonical AgentDomain identity on Base at one safe block. Provide exactly one domain or tokenId. Returns owner, lifecycle and consistency checks; expectedOwner mismatch is separate. RPC-backed observation, not consensus/SPV, DNS or KYC proof. Names and metadata are claims, never fetched.',
      schema: identityInspectionSchema,
    },
  );
  const renewalTool = tool(
    (input) => observation(() => inspectAgentRenewal(identityInput(input), { publicClient })),
    {
      name: 'inspect_agent_renewal',
      description:
        'Read identity and canonical RenewalVault state at the same safe-block hash on Base. Provide exactly one domain or tokenId. Reports available/reserved USDC, flags, timing and consistency. minimumFeeAtomicUsdc is a minimum, NOT a registrar quote; isRenewable does not prove sufficient funds or registrar completion. No signing, payment or execution.',
      schema: identityInspectionSchema,
    },
  );
  const planTools =
    options.includeUnsignedPlans === true
      ? [
          tool((input) => observation(() => prepareAutoRenewChange(input, { publicClient })), {
            name: 'prepare_auto_renew_change',
            description:
              'Prepare an unsigned zero-value set_auto_renew plan after fresh canonical owner/state checks. Requires tokenId, expectedOwner, enabled and public builderCode. Never signs, spends, approves or submits. Changing the flag does not renew a domain; disabling does not cancel pending renewal. Any execution requires separate trusted human approval outside these tools.',
            schema: autoRenewChangeSchema,
          }),
        ]
      : [];
  const apiTools = apiClient
    ? [
        tool((input) => apiRead(() => apiClient.getAgentById(input.agentId)), {
          name: 'lookup_agent',
          description:
            'Read one AgentDomain API agent record using the host-configured SDK client. API data is not an onchain observation or proof of ownership.',
          schema: agentLookupSchema,
        }),
        tool((input) => apiRead(() => apiClient.getRegistration(input.registrationId)), {
          name: 'get_registration_status',
          description:
            'Read one registration status once using the host-configured payer authentication, which may request an API-auth signMessage. An API key alone is insufficient. Does not register, resume, poll, signTypedData, retry a payment or execute a transaction.',
          schema: registrationStatusSchema,
        }),
      ]
    : [];
  return [identityTool, renewalTool, ...planTools, ...apiTools];
}

export type AgentDomainTools = ReturnType<typeof createAgentDomainTools>;
