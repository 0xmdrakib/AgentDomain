# Security Policy

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability. Use GitHub's
[private vulnerability reporting](https://github.com/0xmdrakib/AgentDomain/security/advisories/new)
to send a confidential report to the maintainers.

Include the affected public component, the observable impact, safe reproduction
steps, and any suggested mitigation. Do not include real credentials, private
keys, customer data, private repository material, or production data in a
report. If sensitive evidence is necessary, first ask the maintainers how to
transfer it safely.

Do not perform destructive testing, denial-of-service testing, social
engineering, or testing against accounts or data you do not own. Stop testing
and report immediately if you encounter secrets or personal data.

## Supported versions

Security fixes target the current `main` branch and the latest published public
package versions. Older versions may be asked to upgrade before a fix is
backported.

## Public boundary

This repository intentionally contains public frontend, documentation, SDK,
integration, and verified contract source. Backend services, infrastructure,
storage internals, provider credentials, and operational procedures are not part
of the public security-reporting surface. Reports can describe public API
behavior without disclosing or requesting private implementation details.
