import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
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

    def python_release(self, folder="release"):
        root = self.root / folder
        (root / "dist").mkdir(parents=True)
        for project in release.PYTHON_PACKAGES:
            wheel = self.wheel(project=project)
            wheel.rename(root / "dist" / wheel.name)
            norm = project.replace("-", "_")
            prefix = f"{norm}-0.11.0/"
            files = {
                prefix + "PKG-INFO": f"Name: {project}\nVersion: 0.11.0\nLicense-Expression: Apache-2.0\nLicense-File: LICENSE\nLicense-File: NOTICE\n".encode(),
                prefix + f"src/{norm}/__init__.py": b"",
                prefix + "LICENSE": b"Apache License\nVersion 2.0, January 2004",
                prefix + "NOTICE": b"AgentDomain Contributors",
            }
            with tarfile.open(root / "dist" / f"{norm}-0.11.0.tar.gz", "w:gz") as archive:
                for name, value in files.items():
                    info = tarfile.TarInfo(name)
                    info.size = len(value)
                    archive.addfile(info, io.BytesIO(value))
        manifest = {
            "schema": 1,
            "repository": "0xmdrakib/AgentDomain",
            "sha": "a" * 40,
            "version": "0.11.0",
            "files": release.python_inventory(root),
        }
        return root, manifest, self.seal(root, manifest)

    def seal(self, root, manifest):
        (root / "release.json").write_text(json.dumps(manifest) + "\n", encoding="utf-8")
        return {
            "EXPECTED_RELEASE_MANIFEST_SHA256": release.digest(root / "release.json"),
            "GITHUB_SHA": "a" * 40,
            "GITHUB_REPOSITORY": "0xmdrakib/AgentDomain",
            "GITHUB_REF": "refs/heads/main",
        }

    def cli(self, root, env, *arguments):
        return subprocess.run(
            [sys.executable, "-B", str(Path(release.__file__).resolve()), *arguments, "--output", str(root)],
            env=env, cwd=self.root, capture_output=True, text=True, check=False,
        )

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

    def test_stage_exact_projects_preserves_all_four_originals_and_manifest(self):
        for project, projects in (
            ("agentdomain-crewai", ["agentdomain-crewai"]),
            ("agentdomain-autogen", ["agentdomain-autogen"]),
            ("all", ["agentdomain-crewai", "agentdomain-autogen"]),
        ):
            with self.subTest(project=project):
                root, manifest, env = self.python_release(project)
                originals = {path.name: path.read_bytes() for path in (root / "dist").iterdir()}
                sealed = (root / "release.json").read_bytes()
                with patch.dict(os.environ, env, clear=True):
                    selected = release.stage_python(root, project)
                    self.assertEqual(release.verify_python(root), manifest)
                expected = {
                    f"{name.replace('-', '_')}-0.11.0{suffix}"
                    for name in projects for suffix in ("-py3-none-any.whl", ".tar.gz")
                }
                self.assertEqual({row["filename"] for row in selected}, expected)
                self.assertEqual({path.name for path in (root / "publish-dist").iterdir()}, expected)
                self.assertEqual(len(expected), 4 if project == "all" else 2)
                for row in selected:
                    path = root / "publish-dist" / row["filename"]
                    self.assertEqual(path.read_bytes(), originals[path.name])
                    self.assertEqual(release.inspect_python(path, row["project"]), row)
                self.assertEqual({path.name: path.read_bytes() for path in (root / "dist").iterdir()}, originals)
                self.assertEqual((root / "release.json").read_bytes(), sealed)

    def test_stage_invalid_selectors_fail_before_verification(self):
        with patch.object(release, "verify_python") as verify:
            for project in (None, "", "*", "ALL", "crewai", "agentdomain_crewai", "../publish-dist", "/tmp/output", "agentdomain-crewai,agentdomain-autogen"):
                with self.subTest(project=project), self.assertRaises(ValueError):
                    release.stage_python(self.root, project)
            verify.assert_not_called()
        self.assertFalse((self.root / "publish-dist").exists())

    def test_stage_cli_selects_exact_two_two_four_artifacts(self):
        for project, count in (("agentdomain-crewai", 2), ("agentdomain-autogen", 2), ("all", 4)):
            with self.subTest(project=project):
                root, manifest, env = self.python_release(project)
                result = self.cli(root, env, "stage-python", "--project", project)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(result.stdout.strip(), f"Staged {count} verified Python artifacts for {project}.")
                self.assertEqual(
                    {path.name for path in (root / "publish-dist").iterdir()},
                    {row["filename"] for row in manifest["files"] if project == "all" or row["project"] == project},
                )
                self.assertEqual(len(list((root / "publish-dist").iterdir())), count)

    def test_cli_requires_explicit_stage_selector_and_rejects_selection_in_other_commands(self):
        root, _, env = self.python_release()
        invalid = [
            ("stage-python",),
            ("stage-python", "--project", ""),
            ("stage-python", "--project", "*"),
            ("stage-python", "--project", "../outside"),
            ("stage-python", "--project", "all", "--publish-dir", "outside"),
            ("stage-python", "--proj", "all"),
            *((command, "--project", "all") for command in ("build-python", "verify-python", "verify-npm")),
        ]
        for arguments in invalid:
            with self.subTest(arguments=arguments):
                result = self.cli(root, env, *arguments)
                self.assertEqual(result.returncode, 2, result.stderr)
                self.assertFalse((root / "publish-dist").exists())
        self.assertEqual(self.cli(root, env, "verify-python").returncode, 0)
        self.assertFalse((root / "publish-dist").exists())

    def test_stage_rejects_tampered_selected_and_unselected_originals(self):
        for index, (selected, tampered) in enumerate((
            ("agentdomain-crewai", "agentdomain-autogen"),
            ("agentdomain-autogen", "agentdomain-crewai"),
            ("agentdomain-crewai", "agentdomain-crewai"),
        )):
            for suffix in ("-py3-none-any.whl", ".tar.gz"):
                with self.subTest(selected=selected, tampered=tampered, suffix=suffix):
                    root, _, env = self.python_release(f"case-{index}-{suffix}")
                    path = root / "dist" / f"{tampered.replace('-', '_')}-0.11.0{suffix}"
                    path.write_bytes(path.read_bytes() + b"changed")
                    with patch.dict(os.environ, env, clear=True), self.assertRaises(ValueError):
                        release.stage_python(root, selected)
                    self.assertFalse((root / "publish-dist").exists())

    def test_stage_rejects_missing_extra_and_invalid_metadata_originals(self):
        for corruption in ("missing", "extra", "metadata"):
            with self.subTest(corruption=corruption):
                root, manifest, env = self.python_release(corruption)
                path = root / "dist" / "agentdomain_autogen-0.11.0-py3-none-any.whl"
                if corruption == "missing":
                    path.unlink()
                elif corruption == "extra":
                    (root / "dist" / "unexpected.whl").write_bytes(b"extra")
                else:
                    path.write_bytes(self.wheel(project="agentdomain-autogen", version="0.10.0").read_bytes())
                    row = next(row for row in manifest["files"] if row["filename"] == path.name)
                    row.update(sha256=release.digest(path), bytes=path.stat().st_size)
                    env = self.seal(root, manifest)
                with patch.dict(os.environ, env, clear=True), self.assertRaises(ValueError):
                    release.stage_python(root, "agentdomain-crewai")
                self.assertFalse((root / "publish-dist").exists())

    def test_stage_rejects_wrong_seal_and_source_context(self):
        root, _, env = self.python_release()
        for key, value in (
            ("EXPECTED_RELEASE_MANIFEST_SHA256", ""),
            ("EXPECTED_RELEASE_MANIFEST_SHA256", "0" * 64),
            ("GITHUB_SHA", "b" * 40),
            ("GITHUB_REPOSITORY", "someone/AgentDomain"),
            ("GITHUB_REF", "refs/heads/feature"),
        ):
            with self.subTest(key=key, value=value):
                with patch.dict(os.environ, {**env, key: value}, clear=True), self.assertRaises(ValueError):
                    release.stage_python(root, "agentdomain-crewai")
                self.assertFalse((root / "publish-dist").exists())

    def test_stage_rejects_sealed_manifest_row_mismatches(self):
        for key, value in (("filename", "../outside.whl"), ("project", "other"), ("bytes", 1), ("sha256", "0" * 64)):
            with self.subTest(key=key):
                root, manifest, _ = self.python_release(key)
                manifest["files"][0][key] = value
                env = self.seal(root, manifest)
                with patch.dict(os.environ, env, clear=True), self.assertRaises(ValueError):
                    release.stage_python(root, "agentdomain-crewai")
                self.assertFalse((root / "publish-dist").exists())

    def test_stage_refuses_any_existing_destination_without_overwriting(self):
        for kind in ("file", "empty-directory", "populated-directory"):
            with self.subTest(kind=kind):
                root, _, env = self.python_release(kind)
                target = root / "publish-dist"
                if kind == "file":
                    target.write_bytes(b"preserve")
                else:
                    target.mkdir()
                    if kind == "populated-directory":
                        (target / "agentdomain_crewai-0.11.0-py3-none-any.whl").write_bytes(b"preserve")
                with patch.dict(os.environ, env, clear=True), self.assertRaises(FileExistsError):
                    release.stage_python(root, "agentdomain-crewai")
                if kind == "file":
                    self.assertEqual(target.read_bytes(), b"preserve")
                else:
                    self.assertEqual([path.read_bytes() for path in target.iterdir()], [b"preserve"] if kind == "populated-directory" else [])

    def test_stage_exclusive_file_creation_rejects_injected_destination_file(self):
        root, _, env = self.python_release()
        injected = root / "publish-dist" / "agentdomain_crewai-0.11.0.tar.gz"
        copy = release.shutil.copyfileobj

        def copy_and_inject(original, staged):
            copy(original, staged)
            injected.write_bytes(b"preserve")

        with patch.dict(os.environ, env, clear=True), patch.object(release.shutil, "copyfileobj", copy_and_inject):
            with self.assertRaises(FileExistsError):
                release.stage_python(root, "agentdomain-crewai")
        self.assertEqual(injected.read_bytes(), b"preserve")

    def test_stage_rejects_copied_content_size_and_metadata_mismatches(self):
        for corruption in ("content", "size", "metadata"):
            with self.subTest(corruption=corruption):
                root, _, env = self.python_release(corruption)

                def corrupt_copy(original, staged):
                    payload = original.read()
                    if corruption == "size":
                        staged.write(payload + b"extra")
                    elif Path(staged.name).suffix == ".whl":
                        buffer = io.BytesIO()
                        with zipfile.ZipFile(io.BytesIO(payload)) as source, zipfile.ZipFile(buffer, "w") as target:
                            for item in source.infolist():
                                value = source.read(item)
                                if corruption == "content" and item.filename.endswith("/NOTICE"):
                                    value = value.replace(b"Contributors", b"Contribution")
                                if corruption == "metadata" and item.filename.endswith("/METADATA"):
                                    value = value.replace(b"Version: 0.11.0", b"Version: 0.10.0")
                                target.writestr(item, value)
                        self.assertEqual(len(buffer.getvalue()), len(payload))
                        staged.write(buffer.getvalue())
                    else:
                        staged.write(payload)

                with patch.dict(os.environ, env, clear=True), patch.object(release.shutil, "copyfileobj", corrupt_copy):
                    with self.assertRaises(ValueError):
                        release.stage_python(root, "agentdomain-crewai")

    def test_stage_rechecks_extra_files_manifest_and_unselected_inputs_after_copy(self):
        copy = release.shutil.copyfileobj
        for corruption in ("extra", "manifest", "unselected"):
            with self.subTest(corruption=corruption):
                root, _, env = self.python_release(corruption)
                paths = {
                    "extra": root / "publish-dist" / "unexpected.whl",
                    "manifest": root / "release.json",
                    "unselected": root / "dist" / "agentdomain_autogen-0.11.0-py3-none-any.whl",
                }

                def copy_and_tamper(original, staged):
                    copy(original, staged)
                    with paths[corruption].open("ab") as target:
                        target.write(b"\n")

                with patch.dict(os.environ, env, clear=True), patch.object(release.shutil, "copyfileobj", copy_and_tamper):
                    with self.assertRaises(ValueError):
                        release.stage_python(root, "agentdomain-crewai")

    def test_stage_rejects_symlinked_inputs_and_destination(self):
        for kind in ("root", "dist", "manifest", "artifact", "destination", "dangling-destination"):
            with self.subTest(kind=kind):
                root, _, env = self.python_release(kind)
                paths = {
                    "root": root,
                    "dist": root / "dist",
                    "manifest": root / "release.json",
                    "artifact": root / "dist" / "agentdomain_autogen-0.11.0-py3-none-any.whl",
                    "destination": root / "publish-dist",
                    "dangling-destination": root / "publish-dist",
                }
                path = paths[kind]
                target = self.root / f"symlink-target-{kind}"
                if kind == "destination":
                    target.mkdir()
                    (target / "preserve").write_bytes(b"preserve")
                elif kind != "dangling-destination":
                    path.rename(target)
                try:
                    path.symlink_to(target, target_is_directory=target.is_dir() or kind == "dangling-destination")
                except OSError as error:
                    if getattr(error, "winerror", None) == 1314:
                        self.skipTest("Creating filesystem symlinks requires Windows privileges")
                    raise
                with patch.dict(os.environ, env, clear=True), self.assertRaises((ValueError, FileExistsError)):
                    release.stage_python(root, "agentdomain-crewai")
                if kind == "root":
                    self.assertEqual(self.cli(root, env, "stage-python", "--project", "all").returncode, 1)
                elif kind == "destination":
                    self.assertEqual({item.name for item in target.iterdir()}, {"preserve"})
                    self.assertEqual((target / "preserve").read_bytes(), b"preserve")
                elif kind == "dangling-destination":
                    self.assertFalse(target.exists())

    def test_npm_rows_reject_other_target_before_archive_read(self):
        (self.root / "publish-order.tsv").write_text("@agentdomain/langchain-plugin\t0.12.0\t../bad.tgz\n" * 6)
        with self.assertRaises(ValueError):
            release.inspect_npm(self.root)


if __name__ == "__main__":
    unittest.main()
