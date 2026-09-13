import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location(
    "python_boundary", Path(__file__).with_name("check-python-boundary.py")
)
boundary = importlib.util.module_from_spec(spec)
spec.loader.exec_module(boundary)


class PythonBoundaryTests(unittest.TestCase):
    def test_rejects_private_imports_using_python_syntax(self):
        for source in (
            "import boto3",
            "from google.cloud import storage",
            "from google import cloud",
            "import psycopg as pg",
            "from ..storage import client",
            "from . import database",
            "from services.mail import sender",
            "importlib.import_module('boto3')",
            "__import__('firebase_admin')",
            "from importlib import import_module; import_module('boto3')",
            "from importlib import import_module as load; load('boto3')",
            "importlib.import_module(name='boto3')",
            "__import__(name='redis')",
            "from builtins import __import__ as load; load(name='psycopg')",
            "import builtins; builtins.__import__('redis')",
        ):
            with self.subTest(source=source):
                self.assertTrue(boundary.inspect_source(source))

    def test_allows_frameworks_and_does_not_parse_strings_as_imports(self):
        self.assertEqual(
            boundary.inspect_source(
                "from agentdomain_crewai import readonly_tools\n"
                "from autogen_ext.tools.mcp import McpWorkbench\n"
                "fixture = 'import boto3'\n"
                "# from google.cloud import storage\n"
            ),
            [],
        )

    def test_actual_manifests_pass_and_unlicensed_provider_dependency_fails(self):
        for folder in boundary.PACKAGES:
            source = (boundary.ROOT / "packages" / folder / "pyproject.toml").read_text(
                encoding="utf-8"
            )
            self.assertEqual(boundary.inspect_manifest(source, folder), [])
            self.assertTrue(
                boundary.inspect_manifest(
                    source.replace('license = "Apache-2.0"', 'license = "UNLICENSED"'),
                    folder,
                )
            )
            self.assertTrue(
                boundary.inspect_manifest(source.replace('"mcp==', '"boto3=='), folder)
            )
            self.assertTrue(
                boundary.inspect_manifest(
                    source.replace('"hatchling==1.27.0"', '"hatchling"'), folder
                )
            )

    def test_invalid_syntax_is_not_silently_accepted(self):
        with self.assertRaises(SyntaxError):
            boundary.inspect_source("from ! import broken")
        with self.assertRaises(ValueError):
            boundary.inspect_manifest("invalid [toml", "crewai-plugin")


if __name__ == "__main__":
    unittest.main()
