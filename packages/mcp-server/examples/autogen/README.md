# AutoGen + AgentDomain MCP

Native **Python** integration using the official Microsoft AutoGen
`autogen_ext.tools.mcp.McpWorkbench`. Python starts the separately installed
AgentDomain **Node.js MCP server** over stdio. This is not an npm-native AutoGen
wrapper or a new PyPI package.

The workflow inspects identity, inspects renewal state, and optionally prepares an
unsigned auto-renew **setting change** for separate owner review. It never signs,
broadcasts, funds a vault, grants a token approval, or completes a registrar renewal.
An LLM response or an `approved: true` argument is not owner authorization.

## Versions

- Python 3.12 recommended; tested with 3.12.14.
- Microsoft `autogen-agentchat`, `autogen-core` and `autogen-ext[mcp]`: **0.7.5**.
- Python MCP client: **1.30.0**. The pin is deliberate: AutoGen's dependency does
  not prevent an unqualified MCP major-version upgrade.
- Node.js 20 or newer; tested with Node 24.19.0.
- `@agentdomain/mcp-server`: exact release target **0.10.0**, using SDK 0.10.0.

**Release staging:** 0.10.0 must be published and verified before using the npm
installation commands below. Until then, use the explicit reviewed public-source
build path. There is no automatic download or fallback to an older package.

These are the official Microsoft distributions, not the similarly named
`autogen`/AG2 package. API references: [McpWorkbench](https://microsoft.github.io/autogen/stable/reference/python/autogen_ext.tools.mcp.html),
[AutoGen 0.7.5 release](https://github.com/microsoft/autogen/releases/tag/python-v0.7.5),
[official package](https://pypi.org/project/autogen-ext/0.7.5/).

## Install Python Dependencies

Run from the AgentDomain public checkout. Keep the venv and pip cache under the
ignored `.qa/` directory, not in a source/package folder or a global Python install.

Linux/macOS:

```bash
python3 -m venv .qa/autogen/venv
.qa/autogen/venv/bin/python -m pip install \
  --cache-dir .qa/autogen/pip-cache \
  -r packages/mcp-server/examples/autogen/requirements.txt \
  -c packages/mcp-server/examples/autogen/constraints.txt
```

Windows PowerShell:

```powershell
py -3.12 -m venv .qa/autogen/venv
& .qa/autogen/venv/Scripts/python.exe -m pip install `
  --cache-dir .qa/autogen/pip-cache `
  -r packages/mcp-server/examples/autogen/requirements.txt `
  -c packages/mcp-server/examples/autogen/constraints.txt
```

The deterministic workflow and tests need no paid model or provider key.

## Choose The Trusted Node Server

For a released npm package, install the exact version into an isolated directory:

```bash
npm install --prefix .qa/autogen/node-runtime --ignore-scripts --no-audit --no-fund \
  @agentdomain/mcp-server@0.10.0
```

Supply `.qa/autogen/node-runtime/node_modules/@agentdomain/mcp-server` as
`--installed-package`. The Python launcher checks the package name, exact version
and built `dist/index.js`. Use a trusted Node executable, obtained from your own
installation, as `--node`. It never accepts a command, script, RPC URL, chain,
registry address or credential from an LLM/tool result.

During source development, install the public workspace's locked dependencies and
build only the shared contracts, SDK and MCP package:

```bash
pnpm install --frozen-lockfile
pnpm --filter @agentdomain/shared build
pnpm --filter @agentdomain/sdk build
pnpm --filter @agentdomain/mcp-server build
```

Then use `--source-checkout /absolute/path/to/AgentDomain`. This is an explicit
development mode for reviewed source, not a runtime TS loader or an automatic npm
fallback. It requires the built entrypoint and checks that the required tools are
actually available. Never point it at an untrusted checkout or package directory.

## Read-Only Inspection

```bash
.qa/autogen/venv/bin/python -B packages/mcp-server/examples/autogen/inspect_renewal.py \
  --node /absolute/path/to/node \
  --source-checkout /absolute/path/to/AgentDomain \
  --domain your-domain.xyz
```

On Windows, use `.qa/autogen/venv/Scripts/python.exe`, a trusted absolute `node.exe`
path and PowerShell backticks for continuation. The program also accepts
`--token-id` instead of `--domain`; they are mutually exclusive.

`--expected-owner 0x...` adds an owner-address comparison. It is not wallet
authentication, KYC, DNS ownership or authorization. These are public RPC
observations about the custom AgentDomain ERC-721 registry, not consensus/SPV
proof, nor verification of linked Basename/ENS labels. Unavailable RPC data is an
error, not a fabricated `not_found` or successful identity verdict.

## Prepare A Change, Then Stop

```bash
.qa/autogen/venv/bin/python -B packages/mcp-server/examples/autogen/inspect_renewal.py \
  --node /absolute/path/to/node \
  --source-checkout /absolute/path/to/AgentDomain \
  --token-id 7 \
  --expected-owner 0x1111111111111111111111111111111111111111 \
  --prepare-enable \
  --builder-code your_registered_code
```

The token/address above illustrate argument formatting; use the actual token,
owner and registered public builder code for your application. Use
`--prepare-disable` instead of `--prepare-enable` to propose disabling auto-renew.
Both options produce a plan only.

The exact MCP calls are:

```text
inspect_agent_identity({domain XOR tokenId, expectedOwner?})
inspect_agent_renewal({domain XOR tokenId, expectedOwner?})
prepare_auto_renew_change({tokenId, expectedOwner, enabled, builderCode})
```

All token IDs are decimal strings, not platform agent UUIDs. `enabled` is a JSON
boolean, not a string. `builderCode` contains 1-32 lowercase letters, digits or
underscores. Extra command/RPC/key/approval arguments are rejected.

The prepared result is a JSON-safe `set_auto_renew` plan with an ID, chain/token/
owner/setting/attribution binding, observations, `noChange`, warnings and
`transaction: {to, data, value: "0"}`. Inspection ties identity and vault reads to
the SDK's same-hash snapshot. Minimum renewal fees are **not registrar quotes**.
Turning auto-renew on is **not a completed registrar renewal**; an externally
executed setting transaction can still consume gas even though its value is zero.

The example returns the exact plan under `ownerReview` and stops. A separate
trusted owner-wallet application must display and verify the full plan, obtain
fresh explicit owner approval, then use the SDK's execution/confirmation boundary.
Do not pipe model output into a signer, reinterpret an LLM boolean as consent, or
add a private key to this MCP child. A stale or changed plan requires fresh review.

## Optional AssistantAgent

`assistant_example.py` uses a real `autogen_agentchat.agents.AssistantAgent` with the
same guarded workbench. Install the official `autogen-ext` provider extra for your
chosen model separately in this venv, and provide your own trusted component JSON
in `AUTOGEN_MODEL_CONFIG` through your shell or secret manager. Provider keys remain
in the Python process; the launcher does not forward them to Node or save them.

For example, the official `autogen-ext[openai]==0.7.5` extra supplies this real
component class. Choose a model supported by that client and your account:

```json
{
  "provider": "autogen_ext.models.openai.OpenAIChatCompletionClient",
  "config": { "model": "your_selected_model" }
}
```

Replace `your_selected_model` with your own supported model ID. For this provider,
supply `OPENAI_API_KEY` only through the Python session or secret manager; SDKs
read that environment variable. Do not save it in the config or repository.
[Official OpenAI environment-key guidance](https://developers.openai.com/api/docs/quickstart).
Other AutoGen providers can use their own actual class and configuration.
Do not load component JSON supplied by a model, website, MCP result or other
untrusted source: component loading imports Python code. Optional model calls may
incur your provider's charges; none are made by the deterministic script or tests.

Run `assistant_example.py` with the same CLI options as `inspect_renewal.py`. The
model can discover only the three read/prepare tools. Calls to signing, funding,
registration, execution or arbitrary command tools are denied by code, not merely
by the prompt or MCP annotations. MCP sampling is not configured. The agent is
limited to three tool iterations and cannot execute a returned plan.

Use the workbench as an async context manager and close the model client in
`finally`, as the examples do. Reconstruct this guarded class explicitly when
resuming an application. Component serialization is intentionally refused because
the inherited base-provider config would reload an unfiltered `McpWorkbench`.
Do not persist model config, secrets or conversation state from these examples.

## Environment Boundary

The child receives only a fixed OS-variable allowlist with a minimal PATH. In
particular, `AGENT_PRIVATE_KEY`, `AGENTDOMAIN_API_KEY`, write flags, builder/network/
vault overrides, provider keys, `AUTOGEN_MODEL_CONFIG`, `NODE_OPTIONS`, proxy and
cloud credentials are not forwarded. Python MCP's own default inherited variables
are included in the audited OS allowlist; the package version is checked at startup.

An environment allowlist is not an operating-system sandbox. The pinned MCP server
and its installed dependencies must still be trusted. This example makes no claim
that arbitrary stdio executables are safe to run.

## Run The Integration Checks

After the public MCP/SDK source build, run the actual Python suite:

```bash
AGENTDOMAIN_AUTOGEN_NODE=/absolute/path/to/node \
  .qa/autogen/venv/bin/python -B \
  packages/mcp-server/examples/autogen/tests/test_workbench.py
```

PowerShell:

```powershell
$env:AGENTDOMAIN_AUTOGEN_NODE = 'C:/absolute/path/to/node.exe'
& .qa/autogen/venv/Scripts/python.exe -B `
  packages/mcp-server/examples/autogen/tests/test_workbench.py
```

The Node test harness is also available:

```bash
AGENTDOMAIN_AUTOGEN_PYTHON=/absolute/path/to/AgentDomain/.qa/autogen/venv/bin/python \
  node --test packages/mcp-server/test/autogen.integration.test.mjs
```

Without the explicitly selected isolated Python interpreter, this optional harness
reports a **skip**, not a Python integration pass. It does not modify CI or install
Python packages automatically.

Tests import real AutoGen classes, start the actual Node MCP stdio bridge, call the
actual AgentDomain SDK against ABI-encoded synthetic RPC fixtures, and exercise a
real `AssistantAgent` with the official `ReplayChatCompletionClient`. No mocked
framework imports, paid LLM, wallet, customer data or live-chain write is used.
All fixture observations are explicitly labeled synthetic, never live proof.
