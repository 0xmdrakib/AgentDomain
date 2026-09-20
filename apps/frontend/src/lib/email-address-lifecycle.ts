import {
  emailAddressChangeResultSchema,
  emailAliasCreatedSchema,
  emailAliasDeletedSchema,
  primaryEmailUpdatedSchema,
  type EmailAddressChange,
  type EmailServiceStatus,
} from '@agentdomain/shared';
import {
  emailAddressObservationSchema,
  emailInboxViewSchema,
  type EmailAddressView,
  type EmailInboxView,
} from './backend-contracts';

export type AddressRequest = Pick<EmailAddressChange, 'requestId' | 'action' | 'target'>;
export interface EmailAddressState {
  addresses: EmailAddressView[] | undefined;
  change: EmailAddressChange | null;
  changeUnavailable: boolean;
  service: EmailServiceStatus | undefined;
  observed: boolean;
  request: AddressRequest | null;
  outcome: 'sending' | 'unknown' | 'accepted' | null;
}

export const initialEmailAddressState = (): EmailAddressState => ({
  addresses: undefined,
  change: null,
  changeUnavailable: false,
  service: undefined,
  observed: false,
  request: null,
  outcome: null,
});
export const isAddressChangeTerminal = (change: EmailAddressChange | null) =>
  !change || change.phase === 'completed' || change.phase === 'cancelled';

export function activeEmailAddresses(
  addresses: EmailAddressView[] | undefined,
  inbox: EmailInboxView | null,
): EmailAddressView[] {
  if (addresses !== undefined) return addresses.filter((entry) => entry.status === 'active');
  return inbox
    ? [
        {
          id: inbox.id,
          agentId: inbox.agentId,
          emailAddress: inbox.emailAddress,
          kind: 'primary',
          status: 'active',
          createdAt: inbox.createdAt,
          updatedAt: inbox.createdAt,
        },
      ]
    : [];
}

export function reconcileEmailFrom(current: string, active: EmailAddressView[]): string {
  return (
    active.find((entry) => entry.emailAddress.toLowerCase() === current.toLowerCase())
      ?.emailAddress ??
    active.find((entry) => entry.kind === 'primary')?.emailAddress ??
    active[0]?.emailAddress ??
    ''
  );
}

export function addressControlsBlocked(state: EmailAddressState): boolean {
  return (
    !state.observed ||
    state.changeUnavailable ||
    Boolean(state.request) ||
    !isAddressChangeTerminal(state.change)
  );
}

export function emailSendAllowed(
  state: EmailAddressState,
  from: string,
  active: EmailAddressView[],
): boolean {
  return emailFromCanReconcile(state) && active.some((entry) => entry.emailAddress === from);
}

export function emailFromCanReconcile(state: EmailAddressState): boolean {
  return (
    !addressControlsBlocked(state) &&
    (!state.service ||
      state.service.state === 'provider-managed' ||
      state.service.state === 'ready')
  );
}

export function invalidateEmailObservation(state: EmailAddressState): EmailAddressState {
  return {
    ...state,
    observed: false,
    service:
      state.service && state.service.state !== 'provider-managed'
        ? { state: 'unchecked' }
        : state.service,
  };
}

function matches(request: AddressRequest, change: EmailAddressChange) {
  return (
    request.requestId === change.requestId &&
    request.action === change.action &&
    request.target.toLowerCase() === change.target.toLowerCase()
  );
}

export function observeEmailAddresses(
  state: EmailAddressState,
  input: unknown,
  agentId: string,
  sync: boolean,
) {
  const value = emailAddressObservationSchema.parse(input);
  const unavailable = value.addressChange?.phase === 'unavailable';
  const observedChange = value.addressChange?.phase === 'unavailable' ? null : value.addressChange;
  if (
    (value.inbox && value.inbox.agentId !== agentId) ||
    value.addresses?.some((entry) => entry.agentId !== agentId)
  )
    throw new Error('EMAIL_ADDRESS_OBSERVATION_INVALID');
  if (
    state.request &&
    observedChange?.requestId === state.request.requestId &&
    !matches(state.request, observedChange)
  )
    throw new Error('EMAIL_ADDRESS_OBSERVATION_INVALID');
  const change = observedChange ?? state.change;
  const matched = Boolean(state.request && change && matches(state.request, change));
  const completed = matched && isAddressChangeTerminal(change);
  const service =
    value.mailStatus ??
    (state.service && state.service.state !== 'provider-managed'
      ? { state: 'unchecked' as const }
      : undefined);
  return {
    value,
    state: {
      ...state,
      addresses: value.addresses ?? state.addresses,
      change,
      changeUnavailable:
        unavailable || (value.addressChange === undefined && state.changeUnavailable),
      service:
        !sync && service && service.state !== 'provider-managed'
          ? { state: 'unchecked' as const }
          : service,
      observed: true,
      request: completed ? null : state.request,
      outcome: completed ? null : matched ? ('accepted' as const) : state.outcome,
    },
  };
}

export function addressMutationRequest(agentId: string, request: AddressRequest) {
  // Validate the identity with the public contract before issuing or retrying it.
  emailAddressChangeResultSchema.parse({ change: { ...request, phase: 'pending' } });
  const base = `/api/v1/agents/${encodeURIComponent(agentId)}/email`;
  const username = request.target.slice(0, request.target.lastIndexOf('@'));
  return {
    url:
      request.action === 'primary-rename'
        ? base
        : base +
          '/aliases' +
          (request.action === 'alias-delete'
            ? '?' + new URLSearchParams({ emailAddress: request.target })
            : ''),
    init: {
      method:
        request.action === 'primary-rename'
          ? 'PATCH'
          : request.action === 'alias-create'
            ? 'POST'
            : 'DELETE',
      credentials: 'include' as const,
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': request.requestId },
      ...(request.action === 'alias-delete'
        ? {}
        : {
            body: JSON.stringify({
              username,
              ...(request.action === 'primary-rename' ? { confirmReplace: true } : {}),
            }),
          }),
    },
  };
}

export function readAddressMutation(
  status: number,
  input: unknown,
  request: AddressRequest,
  agentId: string,
  allowLegacy: boolean,
) {
  if (status === 202 || (input && typeof input === 'object' && 'change' in input)) {
    const { change } = emailAddressChangeResultSchema.parse(input);
    if (
      ![200, 202].includes(status) ||
      !matches(request, change) ||
      (status === 200) !== (change.phase === 'completed')
    )
      throw new Error('EMAIL_ADDRESS_RESULT_UNCONFIRMED');
    return { kind: 'async' as const, change };
  }
  if (
    !allowLegacy ||
    (request.action === 'alias-create' ? status !== 201 && status !== 200 : status !== 200)
  )
    throw new Error('EMAIL_ADDRESS_RESULT_UNCONFIRMED');
  const result =
    request.action === 'primary-rename'
      ? primaryEmailUpdatedSchema.parse(input)
      : request.action === 'alias-create'
        ? emailAliasCreatedSchema.parse(input)
        : emailAliasDeletedSchema.parse(input);
  if (result.addresses.some((entry) => entry.agentId !== agentId))
    throw new Error('EMAIL_ADDRESS_RESULT_UNCONFIRMED');
  const inbox = 'inbox' in result ? emailInboxViewSchema.strip().parse(result.inbox) : undefined;
  if (inbox && inbox.agentId !== agentId) throw new Error('EMAIL_ADDRESS_RESULT_UNCONFIRMED');
  const target = result.addresses.find(
    (entry) =>
      entry.status === 'active' &&
      entry.emailAddress.toLowerCase() === request.target.toLowerCase(),
  );
  if (
    request.action === 'alias-delete'
      ? Boolean(target)
      : !target || target.kind !== (request.action === 'primary-rename' ? 'primary' : 'alias')
  )
    throw new Error('EMAIL_ADDRESS_RESULT_UNCONFIRMED');
  return { kind: 'legacy' as const, addresses: result.addresses, inbox };
}

export function addressChangeLabel(change: EmailAddressChange): string {
  switch (change.phase) {
    case 'completed':
      return 'Address change completed';
    case 'cancelled':
      return 'Address change cancelled';
    case 'uncertain':
    case 'rejected':
      return 'Address change needs review';
    case 'native_applied':
    case 'projected':
      return 'Verifying address change';
    case 'pending':
      return 'Address change queued';
    default:
      return 'Updating email address';
  }
}
