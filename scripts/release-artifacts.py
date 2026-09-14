"""Bounded, non-extracting release archive checks and Python artifact builder."""

import argparse
import email.parser
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import subprocess
import sys
import tarfile
import zipfile

VERSION = "0.11.0"
PYTHON_PACKAGES = {"agentdomain-crewai": "crewai-plugin", "agentdomain-autogen": "autogen-plugin"}
NPM_PACKAGES = ["shared", "sdk", "mcp-server", "agentkit-plugin", "eliza-plugin", "langchain-plugin"]
MAX_ARCHIVE = 64 * 1024 * 1024
MAX_EXPANDED = 256 * 1024 * 1024


def require(condition, code="INVALID_RELEASE_ARTIFACT"):
    if not condition:
        raise ValueError(code)


def digest(path):
    require(path.is_file() and not path.is_symlink() and path.stat().st_size <= MAX_ARCHIVE)
    return hashlib.sha256(path.read_bytes()).hexdigest()


def safe_name(name, tooling=False):
    require(isinstance(name, str) and bool(name) and "\\" not in name and ":" not in name)
    parts = name.rstrip("/").split("/")
    require(all(p not in ("", ".", "..") for p in parts))
    require(not PurePosixPath(name).is_absolute())
    require(not any(p.lower() in (".git", ".env", ".qa", ".codex", "secrets.json", "operations.env", "backend.env", "frontend.env") or p.lower().startswith(".venv") for p in parts))
    require(not name.endswith((".pfx", ".key")))
    # npm's immutable upstream CLI includes node-gyp Python bytecode; our
    # product distributions must never ship locally generated caches.
    require(tooling or ("__pycache__" not in parts and not name.endswith(".pyc")))


def contents(path, tooling=False):
    digest(path)
    result = {}
    expanded = 0
    if path.name.endswith(".whl"):
        with zipfile.ZipFile(path) as archive:
            require(len(archive.infolist()) <= 20000)
            for item in archive.infolist():
                safe_name(item.filename, tooling)
                require(not stat.S_ISLNK(item.external_attr >> 16))
                require(item.filename not in result)
                expanded += item.file_size
                require(expanded <= MAX_EXPANDED)
                result[item.filename] = b"" if item.is_dir() else archive.read(item)
    else:
        with tarfile.open(path, "r:gz") as archive:
            for index, item in enumerate(archive):
                require(index < 20000 and (item.isfile() or item.isdir()))
                safe_name(item.name, tooling)
                require(item.name not in result)
                expanded += item.size
                require(expanded <= MAX_EXPANDED)
                result[item.name] = archive.extractfile(item).read() if item.isfile() else b""
    require(result)
    return result


def apache_license(files, prefix):
    license_text = files.get(prefix + "LICENSE", b"")
    require(b"Apache License" in license_text and b"Version 2.0, January 2004" in license_text)
    require(bool(files.get(prefix + "NOTICE", b"").strip()))


def inspect_npm_package(path, name):
    require(name in [f"@agentdomain/{slug}" for slug in NPM_PACKAGES])
    files = contents(path)
    require(all(member.startswith("package/") or member == "package" for member in files))
    manifest = json.loads(files["package/package.json"])
    require(manifest["name"] == name and manifest["version"] == VERSION and not manifest.get("private"))
    require(manifest.get("license") == "Apache-2.0")
    apache_license(files, "package/")


def inspect_python(path, project):
    require(project in PYTHON_PACKAGES)
    normalized = project.replace("-", "_")
    expected = {f"{normalized}-{VERSION}-py3-none-any.whl", f"{normalized}-{VERSION}.tar.gz"}
    require(path.name in expected)
    files = contents(path)
    metadata = f"{normalized}-{VERSION}.dist-info/METADATA" if path.name.endswith(".whl") else f"{normalized}-{VERSION}/PKG-INFO"
    require(metadata in files)
    parsed = email.parser.BytesParser().parsebytes(files[metadata])
    require(parsed.get_all("Name") == [project] and parsed.get_all("Version") == [VERSION])
    require(parsed.get_all("License-Expression") == ["Apache-2.0"])
    require(sorted(parsed.get_all("License-File") or []) == ["LICENSE", "NOTICE"])
    license_prefix = f"{normalized}-{VERSION}.dist-info/licenses/" if path.name.endswith(".whl") else f"{normalized}-{VERSION}/"
    apache_license(files, license_prefix)
    require(any(name.endswith("/__init__.py") and f"{normalized}/" in name for name in files))
    if path.name.endswith(".whl"):
        require(all(name.startswith((f"{normalized}/", f"{normalized}-{VERSION}.dist-info/")) for name in files))
    else:
        require(all(name.startswith(f"{normalized}-{VERSION}/") for name in files))
    return {"filename": path.name, "sha256": digest(path), "bytes": path.stat().st_size, "project": project}


def inspect_npm(root):
    rows = (root / "publish-order.tsv").read_text().splitlines()
    require(len(rows) == len(NPM_PACKAGES))
    for row, slug in zip(rows, NPM_PACKAGES):
        expected = [f"@agentdomain/{slug}", VERSION, f"packages/agentdomain-{slug}-{VERSION}.tgz"]
        require(row.split("\t") == expected)
        inspect_npm_package(root / expected[2], expected[0])
    tooling = contents(root / "tooling/npm-11.5.1.tgz", tooling=True)
    require(all(name.startswith("package/") or name == "package" for name in tooling))
    manifest = json.loads(tooling["package/package.json"])
    require(manifest["name"] == "npm" and manifest["version"] == "11.5.1")


def python_inventory(root):
    expected = {f"{name.replace('-', '_')}-{VERSION}{suffix}": name for name in PYTHON_PACKAGES for suffix in ("-py3-none-any.whl", ".tar.gz")}
    directory = root / "dist"
    require(directory.is_dir() and not directory.is_symlink())
    require({p.name for p in directory.iterdir()} == set(expected))
    return [inspect_python(directory / name, project) for name, project in sorted(expected.items())]


def build_python(root):
    repo = Path(__file__).resolve().parent.parent
    root.mkdir(parents=True, exist_ok=False)
    (root / "dist").mkdir()
    for folder in PYTHON_PACKAGES.values():
        subprocess.run([sys.executable, "-m", "build", "--no-isolation", "--outdir", str(root / "dist"), str(repo / "packages" / folder)], check=True, timeout=180)
    sha = os.environ.get("GITHUB_SHA") or subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=repo, text=True).strip()
    require(re.fullmatch(r"[0-9a-f]{40}", sha))
    manifest = {"schema": 1, "repository": "0xmdrakib/AgentDomain", "sha": sha, "version": VERSION, "files": python_inventory(root)}
    (root / "release.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    seal = digest(root / "release.json")
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as output:
            output.write(f"release-manifest-sha256={seal}\n")
    print(f"Validated four Python artifacts; manifest SHA256 {seal}")


def verify_python(root):
    expected = os.environ.get("EXPECTED_RELEASE_MANIFEST_SHA256", "")
    require(re.fullmatch(r"[0-9a-f]{64}", expected))
    require(digest(root / "release.json") == expected)
    manifest = json.loads((root / "release.json").read_bytes())
    require(manifest == {"schema": 1, "repository": "0xmdrakib/AgentDomain", "sha": os.environ.get("GITHUB_SHA"), "version": VERSION, "files": python_inventory(root)})
    require(os.environ.get("GITHUB_REPOSITORY") == manifest["repository"] and os.environ.get("GITHUB_REF") == "refs/heads/main")
    return manifest


def stage_python(root, project):
    require(project in ("all", *PYTHON_PACKAGES))
    require(root.is_dir() and not root.is_symlink())
    # Selection never narrows the sealed input inventory or its validation.
    manifest = verify_python(root)
    selected = [row for row in manifest["files"] if project == "all" or row["project"] == project]
    directory = root / "publish-dist"
    directory.mkdir(exist_ok=False)
    for row in selected:
        require(directory.is_dir() and not directory.is_symlink())
        source = root / "dist" / row["filename"]
        require(source.is_file() and not source.is_symlink() and source.stat().st_size == row["bytes"])
        with source.open("rb") as original, (directory / row["filename"]).open("xb") as staged:
            shutil.copyfileobj(original, staged)
    require(directory.is_dir() and not directory.is_symlink())
    require({path.name for path in directory.iterdir()} == {row["filename"] for row in selected})
    require([inspect_python(directory / row["filename"], row["project"]) for row in selected] == selected)
    require(verify_python(root) == manifest)
    return selected


def main():
    parser = argparse.ArgumentParser(allow_abbrev=False)
    parser.add_argument("command", choices=("build-python", "verify-python", "stage-python", "verify-npm"))
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--project", choices=("all", *PYTHON_PACKAGES))
    args = parser.parse_args()
    if args.command == "stage-python":
        if args.project is None:
            parser.error("stage-python requires --project")
        selected = stage_python(args.output.absolute(), args.project)
        print(f"Staged {len(selected)} verified Python artifacts for {args.project}.")
        return
    if args.project is not None:
        parser.error("--project is only valid with stage-python")
    root = args.output.resolve()
    {"build-python": build_python, "verify-python": verify_python, "verify-npm": inspect_npm}[args.command](root)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print("Release artifact validation failed; nothing was published.", file=sys.stderr)
        sys.exit(1)
