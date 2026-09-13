"""Guarded native AutoGen integration for AgentDomain; no wallet execution."""

from importlib.metadata import version

from .assistant import create_assistant
from .workbench import (
    MAX_ARGUMENT_BYTES,
    MAX_RESULT_BYTES,
    MCP_NPM_VERSION,
    READ_TIMEOUT_SECONDS,
    SYSTEM_ENV_KEYS,
    TOOL_NAMES,
    AgentDomainWorkbench,
    IdentityInput,
    PrepareInput,
    error_result,
    inspect_and_prepare,
    minimal_child_environment,
    require_versions,
    result_json,
    server_parameters,
)

__version__ = version("agentdomain-autogen")

__all__ = [
    "AgentDomainWorkbench",
    "IdentityInput",
    "PrepareInput",
    "MCP_NPM_VERSION",
    "TOOL_NAMES",
    "READ_TIMEOUT_SECONDS",
    "MAX_ARGUMENT_BYTES",
    "MAX_RESULT_BYTES",
    "SYSTEM_ENV_KEYS",
    "require_versions",
    "minimal_child_environment",
    "server_parameters",
    "error_result",
    "result_json",
    "inspect_and_prepare",
    "create_assistant",
    "__version__",
]
