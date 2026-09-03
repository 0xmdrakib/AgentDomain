# @agentdomain/contracts

Public AgentDomain smart contracts for Base. The source accepts Solidity 0.8.24 or newer; the
checked-in Foundry profile pins the compiler settings recorded for the published deployment.

## Contracts

| Contract                | Public behavior                                         |
| ----------------------- | ------------------------------------------------------- |
| `AgentIdentityRegistry` | ERC-721 representation of an agent identity bundle      |
| `PaymentRouter`         | Idempotent USDC payment and identity-mint coordination  |
| `RenewalVault`          | USDC deposits and controlled identity-renewal execution |

The contracts expose the onchain portion of registration and renewal. Review their source, NatSpec,
and published deployment record before integrating; offchain API responses remain authoritative for
current quotes and supported product flows.

## Local verification

Install [Foundry](https://book.getfoundry.sh/getting-started/installation), then
run from this directory:

```bash
forge build
forge fmt --check
```

These commands compile and format-check the contracts locally without requiring a production
credential. They do not deploy contracts or verify live chain state. Never place wallet keys in
source files, command-line arguments, committed fixtures, or repository configuration.

## Published deployments

Available Base deployment records are stored in
[`deployments/base-mainnet.json`](deployments/base-mainnet.json). Verify the
network, bytecode, contract addresses, and relevant onchain state independently
before relying on a published record.

## Security properties

- Registration processing is idempotent and rejects replayed payment intents.
- `PaymentRouter` supports emergency pausing.
- `RenewalVault` separates deposits, withdrawals, reservations, and completion.
- Renewal completion is bound to the registrar-confirmed expiry.
- ERC-721 transfer hooks keep the registry's owner lookup synchronized.
- Privileged functions enforce the access controls defined in contract source.

Report suspected vulnerabilities through the repository's confidential
[security process](../SECURITY.md).

## License

Unless a file or third-party notice states otherwise, the contracts are licensed
under Apache-2.0.
