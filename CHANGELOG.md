# Changelog

Notable changes to AgentDomain's public npm packages are recorded here. Package
versions are immutable once published to npm.

## 0.8.0 - 2026-09-03

This release establishes the public repository as the canonical source and
release pipeline for all AgentDomain npm packages.

### Highlights

- Ships SDK, shared contracts, MCP server, AgentKit, and ElizaOS packages from
  one reviewed public `main` commit with npm provenance.
- Keeps the MCP server read-only by default and requires an exact explicit
  opt-in before write tools are advertised or dispatched.
- Adds complete public DNS, email, registry, renewal, service-plan, and x402 v2
  integration surfaces.
- Enforces ERC-8021 Builder Code attribution for supported direct Base writes.
- Includes linear-time untrusted-text parsing in the ElizaOS integration.
- Improves npm metadata, package-specific documentation, credential guidance,
  source links, and security reporting links.

### Compatibility

- Package names and public import paths are unchanged.
- The canonical API remains `https://api.agentdomain.app/api/v1`.
- The MCP executable remains `agentdomain-mcp` and requires Node.js 20 or newer.

## 0.7.1 - 2026-09-02

- Hardened ElizaOS untrusted-text parsing against polynomial regular-expression
  behavior.

## 0.7.0 - 2026-09-01

- Added attributed public clients and the current AgentDomain integration
  surface.
