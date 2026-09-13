"""Run the read-only AutoGen workflow without a model or paid LLM call."""

from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path

from agentdomain_workbench import (
    AgentDomainWorkbench,
    inspect_and_prepare,
    server_parameters,
)


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument(
        "--node", type=Path, required=True, help="Trusted absolute Node executable"
    )
    source = result.add_mutually_exclusive_group(required=True)
    source.add_argument(
        "--installed-package",
        type=Path,
        help="Trusted node_modules/@agentdomain/mcp-server directory",
    )
    source.add_argument(
        "--source-checkout",
        type=Path,
        help="Reviewed, built AgentDomain public checkout",
    )
    subject = result.add_mutually_exclusive_group(required=True)
    subject.add_argument("--domain")
    subject.add_argument("--token-id")
    result.add_argument("--expected-owner")
    change = result.add_mutually_exclusive_group()
    change.add_argument("--prepare-enable", action="store_true")
    change.add_argument("--prepare-disable", action="store_true")
    result.add_argument("--builder-code")
    return result


async def run(args: argparse.Namespace) -> dict:
    params = server_parameters(
        args.node,
        installed_package=args.installed_package,
        source_checkout=args.source_checkout,
    )
    subject = (
        {"domain": args.domain}
        if args.domain is not None
        else {"tokenId": args.token_id}
    )
    if args.expected_owner is not None:
        subject["expectedOwner"] = args.expected_owner
    enabled = True if args.prepare_enable else False if args.prepare_disable else None
    async with AgentDomainWorkbench(params) as workbench:
        return await inspect_and_prepare(
            workbench, subject, enabled=enabled, builder_code=args.builder_code
        )


if __name__ == "__main__":
    try:
        print(
            json.dumps(
                asyncio.run(run(parser().parse_args())), indent=2, allow_nan=False
            )
        )
    except (KeyboardInterrupt, Exception) as error:
        raise SystemExit(
            f"Read-only workflow stopped ({type(error).__name__}). "
            "No signing or execution was attempted."
        ) from None
