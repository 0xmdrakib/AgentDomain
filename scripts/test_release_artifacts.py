import importlib.util
import io
import json
import os
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch
import zipfile

spec = importlib.util.spec_from_file_location("release_artifacts", Path(__file__).with_name("release-artifacts.py"))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="agentdomain-release-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def wheel(self, project="agentdomain-crewai", version="0.11.0", extra=None, license="Apache-2.0", include_license=True):
        norm = project.replace("-", "_")
        path = self.root / f"{norm}-0.11.0-py3-none-any.whl"
        with zipfile.ZipFile(path, "w") as archive:
            archive.writestr(f"{norm}-0.11.0.dist-info/METADATA", f"Metadata-Version: 2.4\nName: {project}\nVersion: {version}\nLicense-Expression: {license}\nLicense-File: LICENSE\nLicense-File: NOTICE\n")
            archive.writestr(f"{norm}/__init__.py", "")
            if include_license:
                archive.writestr(f"{norm}-0.11.0.dist-info/licenses/LICENSE", "Apache License\nVersion 2.0, January 2004\n")
                archive.writestr(f"{norm}-0.11.0.dist-info/licenses/NOTICE", "AgentDomain Contributors")
            if extra:
                archive.writestr(extra, "do not extract")
        return path

    def test_valid_wheel(self):
        self.assertEqual(release.inspect_python(self.wheel(), "agentdomain-crewai")["project"], "agentdomain-crewai")

    def test_wrong_metadata_version(self):
        with self.assertRaises(ValueError):
            release.inspect_python(self.wheel(version="0.10.0"), "agentdomain-crewai")

    def test_wrong_project(self):
        with self.assertRaises(ValueError):
            release.inspect_python(self.wheel(), "agentdomain-autogen")

    def test_python_license_required(self):
        for options in ({"license": "UNLICENSED"}, {"include_license": False}):
            with self.subTest(options=options), self.assertRaises(ValueError):
                release.inspect_python(self.wheel(**options), "agentdomain-crewai")

    def test_sdist_license_and_metadata_required(self):
        for license in ("Apache-2.0", "MIT"):
            prefix = "agentdomain_crewai-0.11.0/"
            files = {
                prefix + "PKG-INFO": f"Name: agentdomain-crewai\nVersion: 0.11.0\nLicense-Expression: {license}\nLicense-File: LICENSE\nLicense-File: NOTICE\n".encode(),
                prefix + "src/agentdomain_crewai/__init__.py": b"",
                prefix + "LICENSE": b"Apache License\nVersion 2.0, January 2004",
                prefix + "NOTICE": b"AgentDomain",
            }
            path = self.root / "agentdomain_crewai-0.11.0.tar.gz"
            with tarfile.open(path, "w:gz") as archive:
                for name, value in files.items():
                    info = tarfile.TarInfo(name)
                    info.size = len(value)
                    archive.addfile(info, io.BytesIO(value))
            if license == "Apache-2.0":
                release.inspect_python(path, "agentdomain-crewai")
            else:
                with self.assertRaises(ValueError):
                    release.inspect_python(path, "agentdomain-crewai")

    def test_hidden_artifact_injection(self):
        for file in (".venv/bin/python", ".venv-consumer/key", ".qa/capture", ".codex/state", "secrets.json"):
            with self.subTest(file=file), self.assertRaises(ValueError):
                release.inspect_python(self.wheel(extra="agentdomain_crewai/" + file), "agentdomain-crewai")

    def test_npm_license_metadata_and_files(self):
        for license, include, passes in (("Apache-2.0", True, True), ("MIT", True, False), ("Apache-2.0", False, False)):
            path = self.root / "package.tgz"
            files = {"package/package.json": json.dumps({"name": "@agentdomain/sdk", "version": "0.11.0", "license": license}).encode()}
            if include:
                files.update({"package/LICENSE": b"Apache License\nVersion 2.0, January 2004", "package/NOTICE": b"AgentDomain"})
            with tarfile.open(path, "w:gz") as archive:
                for name, value in files.items():
                    info = tarfile.TarInfo(name)
                    info.size = len(value)
                    archive.addfile(info, io.BytesIO(value))
            if passes:
                release.inspect_npm_package(path, "@agentdomain/sdk")
            else:
                with self.assertRaises(ValueError):
                    release.inspect_npm_package(path, "@agentdomain/sdk")

    def test_unsafe_paths(self):
        for name in ("../outside", "/absolute", "a/../x", "a\\x", "C:/x", "a//x", "a/.env", "a/backend.env", "a/.git/config", "a/private.key"):
            with self.subTest(name=name), self.assertRaises(ValueError):
                release.safe_name(name)

    def test_unapproved_wheel_root(self):
        with self.assertRaises(ValueError):
            release.inspect_python(self.wheel(extra="other/__init__.py"), "agentdomain-crewai")

    def test_zip_symlink(self):
        path = self.wheel()
        with zipfile.ZipFile(path, "a") as archive:
            info = zipfile.ZipInfo("agentdomain_crewai/link")
            info.external_attr = 0o120777 << 16
            archive.writestr(info, "outside")
        with self.assertRaises(ValueError):
            release.contents(path)

    def test_tar_link_and_device(self):
        for kind in (tarfile.SYMTYPE, tarfile.LNKTYPE, tarfile.CHRTYPE):
            path = self.root / "test.tar.gz"
            with tarfile.open(path, "w:gz") as archive:
                info = tarfile.TarInfo("package/link")
                info.type = kind
                info.linkname = "../outside"
                archive.addfile(info)
            with self.assertRaises(ValueError):
                release.contents(path)

    def test_duplicate_tar_member(self):
        path = self.root / "test.tar.gz"
        with tarfile.open(path, "w:gz") as archive:
            for _ in range(2):
                info = tarfile.TarInfo("package/a")
                info.size = 1
                archive.addfile(info, io.BytesIO(b"a"))
        with self.assertRaises(ValueError):
            release.contents(path)

    def test_expansion_limit(self):
        path = self.wheel()
        with patch.object(release, "MAX_EXPANDED", 1), self.assertRaises(ValueError):
            release.contents(path)

    def test_extra_or_missing_python_artifacts(self):
        (self.root / "dist").mkdir()
        with self.assertRaises(ValueError):
            release.python_inventory(self.root)

    def test_tampered_or_wrong_source_manifest(self):
        path = self.root / "release.json"
        path.write_text(json.dumps({"schema": 1}))
        with patch.dict(os.environ, {"EXPECTED_RELEASE_MANIFEST_SHA256": "0" * 64}), self.assertRaises(ValueError):
            release.verify_python(self.root)

    def test_npm_rows_reject_other_target_before_archive_read(self):
        (self.root / "publish-order.tsv").write_text("@agentdomain/langchain-plugin\t0.12.0\t../bad.tgz\n" * 6)
        with self.assertRaises(ValueError):
            release.inspect_npm(self.root)


if __name__ == "__main__":
    unittest.main()
