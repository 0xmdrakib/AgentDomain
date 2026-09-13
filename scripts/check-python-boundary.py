"""Pre-install checks for public Python source and package declarations."""

import ast
import json
from pathlib import Path
import sys
import tomllib

ROOT = Path(__file__).resolve().parent.parent
MAX_INPUT = 1024 * 1024
PACKAGES = {
    "crewai-plugin": (
        "agentdomain-crewai",
        {"crewai==1.15.21", "mcp==1.28.1"},
    ),
    "autogen-plugin": (
        "agentdomain-autogen",
        {
            "autogen-agentchat==0.7.5",
            "autogen-core==0.7.5",
            "autogen-ext[mcp]==0.7.5",
            "mcp==1.30.0",
            "pydantic==2.13.5",
        },
    ),
}
PRIVATE_MODULES = (
    "boto3",
    "botocore",
    "google.cloud",
    "firebase_admin",
    "psycopg",
    "psycopg2",
    "asyncpg",
    "pymongo",
    "redis",
    "sqlalchemy",
)
PRIVATE_AREAS = {"db", "database", "services", "storage"}


def forbidden_import(name, relative=False):
    return (
        name.split(".")[0] in PRIVATE_AREAS
        or any(
            name == prefix or name.startswith(prefix + ".")
            for prefix in PRIVATE_MODULES
        )
        or (relative and bool(set(name.split(".")) & PRIVATE_AREAS))
    )


def inspect_source(source):
    errors = []
    tree = ast.parse(source)
    dynamic_names = {"__import__"}
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            for item in node.names:
                if (node.module, item.name) in {
                    ("importlib", "import_module"),
                    ("builtins", "__import__"),
                }:
                    dynamic_names.add(item.asname or item.name)
    for node in ast.walk(tree):
        imports = []
        if isinstance(node, ast.Import):
            imports = [(item.name, False) for item in node.names]
        elif isinstance(node, ast.ImportFrom):
            module = node.module or ""
            imports = [(module, bool(node.level))]
            imports += [
                (".".join(filter(None, (module, item.name))), bool(node.level))
                for item in node.names
            ]
        elif isinstance(node, ast.Call):
            function = node.func
            dynamic = isinstance(function, ast.Name) and function.id in dynamic_names
            dynamic |= isinstance(function, ast.Attribute) and function.attr in {
                "import_module",
                "__import__",
            }
            argument = (
                node.args[0]
                if node.args
                else next(
                    (
                        keyword.value
                        for keyword in node.keywords
                        if keyword.arg == "name"
                    ),
                    None,
                )
            )
            if (
                dynamic
                and isinstance(argument, ast.Constant)
                and isinstance(argument.value, str)
            ):
                name = argument.value
                imports = [(name.lstrip("."), name.startswith("."))]
        if any(forbidden_import(name, relative) for name, relative in imports):
            errors.append(f"line {node.lineno}: private provider or backend import")
    return errors


def inspect_manifest(source, folder):
    expected_name, dependencies = PACKAGES[folder]
    document = tomllib.loads(source)
    project = document.get("project", {})
    errors = []
    if project.get("name") != expected_name:
        errors.append("unexpected Python package name")
    if project.get("license") != "Apache-2.0":
        errors.append("Python package license must be Apache-2.0")
    if project.get("license-files") != ["LICENSE", "NOTICE"]:
        errors.append("Python package must include LICENSE and NOTICE")
    if set(project.get("dependencies", [])) != dependencies:
        errors.append(
            "Python dependencies must match the reviewed framework declarations"
        )
    if project.get("optional-dependencies") or project.get("dynamic"):
        errors.append("unreviewed optional or dynamic Python metadata")
    if document.get("build-system") != {
        "requires": ["hatchling==1.27.0"],
        "build-backend": "hatchling.build",
    }:
        errors.append("Python build backend must match the reviewed pinned builder")
    return errors


def main():
    raw = sys.stdin.buffer.read(MAX_INPUT + 1)
    if len(raw) > MAX_INPUT:
        raise ValueError("Python boundary inventory is too large")
    files = json.loads(raw)
    if not isinstance(files, list) or not all(isinstance(path, str) for path in files):
        raise ValueError("Invalid Python boundary inventory")
    errors = []
    for name in files:
        parts = Path(name).parts
        manifest = (
            len(parts) == 3
            and parts[0] == "packages"
            and parts[1] in PACKAGES
            and parts[2] == "pyproject.toml"
        )
        if not name.endswith(".py") and not manifest:
            continue
        candidate = ROOT / name
        if not candidate.exists():
            continue
        if (
            candidate.is_symlink()
            or not candidate.resolve().is_relative_to(ROOT)
            or candidate.stat().st_size > MAX_INPUT
        ):
            errors.append(f"{name}: unsafe or oversized Python input")
            continue
        try:
            source = candidate.read_text(encoding="utf-8")
            findings = (
                inspect_manifest(source, parts[1])
                if manifest
                else inspect_source(source)
            )
            errors.extend(f"{name}: {finding}" for finding in findings)
        except (ValueError, SyntaxError, TypeError):
            errors.append(f"{name}: invalid Python source or metadata")
    if errors:
        print("\n".join(errors), file=sys.stderr)
        return 1
    print("Public Python source and package boundary checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
