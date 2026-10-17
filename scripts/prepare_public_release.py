#!/usr/bin/env python3
"""Prepare a clean local Git repository without publishing or changing remotes."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
from public_readiness import forbidden_path, scan_bytes

ROOT_FILES = {"README.md", "CONTRIBUTING.md", "SECURITY.md", "LICENSE", "LICENSING.md", "LICENSE-OWNER-MIT", "THIRD-PARTY-NOTICES.md", "CATALOGUE-LICENSE.txt", "ICON-LICENSE.txt", "CATEGORIES-CONTRACT.md", "package.json", "package-lock.json", "index.html", "teacher.html", "tsconfig.json", "vite.config.ts", "vitest.config.ts", "eslint.config.js", "Dockerfile", "compose.yaml", ".env.example", ".gitignore", ".dockerignore", ".gitattributes"}
ROOT_DIRS = {"src", "backend", "public", "scripts", "tests", "docs", "deploy", ".github"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    target = args.output.resolve()
    if target.exists():
        parser.error("Use a new output directory; existing releases are never overwritten")
    def git(*arguments):
        return subprocess.check_output(["git", "-C", str(root), *arguments])
    if git("diff", "--name-only", "--diff-filter=U").strip():
        parser.error("Resolve Git conflicts before preparing the release")
    paths = sorted(set(git("ls-files", "--cached", "--others", "--exclude-standard", "-z").decode().split("\0")) - {""})
    entries = []
    for name in paths:
        path = Path(name)
        source = root / path
        if not source.exists():
            continue
        if not (name in ROOT_FILES or path.parts[0] in ROOT_DIRS):
            raise RuntimeError("Unclassified publication path: " + name)
        if source.is_symlink() or forbidden_path(name):
            raise RuntimeError("Private or generated publication path: " + name)
        data = source.read_bytes()
        if scan_bytes(data):
            raise RuntimeError("Credential pattern needs review in " + name)
        entries.append((name, hashlib.sha256(data).hexdigest()))
    target.mkdir(parents=True)
    for name, _ in entries:
        destination = target / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(root / name, destination)
    def release_git(*arguments):
        return subprocess.check_output(["git", "-C", str(target), *arguments], stderr=subprocess.STDOUT)
    release_git("init", "--initial-branch=main")
    release_git("config", "user.name", "Joseph T. Williams")
    release_git("config", "user.email", "64720924+josephtwilliams@users.noreply.github.com")
    release_git("add", ".")
    release_git("-c", "commit.gpgsign=false", "commit", "-m", "Initial open-source Sayboard release")
    report = {"path": str(target), "commit": release_git("rev-parse", "HEAD").decode().strip(), "files": [{"path": name, "sha256": checksum} for name, checksum in entries], "history_commits": 1, "published": False}
    report_path = root / "test-results/publication/public-source-manifest.json"
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"path": str(target), "commit": report["commit"], "file_count": len(entries), "history_commits": 1, "published": False}))


if __name__ == "__main__":
    main()
