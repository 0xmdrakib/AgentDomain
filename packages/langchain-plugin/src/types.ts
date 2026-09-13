import type {
  AgentDomain,
  IdentityInspectionErrorCode,
  IdentityInspectionOptions,
  RenewalWorkflowErrorCode,
} from '@agentdomain/sdk';

export interface AgentDomainToolsOptions {
  /** Trusted host configuration only. Must disable CCIP Read. No model-controlled RPC URLs. */
  publicClient?: IdentityInspectionOptions['publicClient'];
  /**
   * Explicitly configured SDK client for API reads. Registration status uses
   * the SDK's payer authentication, not the ordinary API key alone.
   */
  apiClient?: AgentDomain;
  /** Add unsigned auto-renew planning only. No execution tool exists. Defaults to false. */
  includeUnsignedPlans?: boolean;
}

export type AgentDomainToolErrorCode =
  IdentityInspectionErrorCode | RenewalWorkflowErrorCode | 'API_UNAVAILABLE';

export type AgentDomainToolResult<T> =
  { ok: true; data: T } | { ok: false; error: { code: AgentDomainToolErrorCode; message: string } };
