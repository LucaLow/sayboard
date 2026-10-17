#!/usr/bin/env python3
"""Audit publication candidates without printing matched credential values.

This is a focused check, not a complete secret or personal-data detector.
It never modifies Git history, files, credentials or repository visibility.
"""
import argparse
import base64
import json
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys


PATTERNS = {
    "private-key": re.compile(rb"-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----"),
    "github-token": re.compile(rb"\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b"),
    "secret-api-key": re.compile(rb"\b(?:sb_secret_[A-Za-z0-9_-]{20,}|sk_(?:live|test)_[A-Za-z0-9]{20,}|sk-proj-[A-Za-z0-9_-]{20,})\b"),
    "resend-key": re.compile(rb"\bre_[A-Za-z0-9_]{24,}\b"),
    "aws-access-key": re.compile(rb"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b"),
    "google-api-key": re.compile(rb"\bAIza[A-Za-z0-9_-]{35}\b"),
    "slack-token": re.compile(rb"\bxox[baprs]-[A-Za-z0-9-]{20,}\b"),
    "credential-url": re.compile(rb"(?:postgres(?:ql)?|mysql|redis)://[^\s/:@]+:[^\s/@]{16,}@"),
}
JWT = re.compile(rb"\beyJ[A-Za-z0-9_-]+\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+\b")
PRIVATE_PARTS = {".git", ".vercel", ".data", ".temp", ".branches", "node_modules", "__pycache__"}
GENERATED_ROOTS = {"dist", "server-dist", "test-results", "playwright-report", "data"}
PRIVATE_SUFFIXES = {".sqlite", ".sqlite3", ".db", ".pem", ".key", ".p12", ".pfx", ".wav", ".mp3", ".flac"}


def git(root, *args):
    result = subprocess.run(["git", "-C", str(root), *args], capture_output=True)
    if result.returncode:
        raise RuntimeError("Git command failed: " + args[0])
    return result.stdout


def forbidden_path(name):
    path = PurePosixPath(name)
    if path.parts and (path.parts[0] in GENERATED_ROOTS or name.startswith("scripts/performance/results/")):
        return True
    if any(part in PRIVATE_PARTS for part in path.parts):
        return True
    if path.name.startswith(".env") and path.name != ".env.example":
        return True
    return path.suffix.lower() in PRIVATE_SUFFIXES or ".sqlite-" in path.name


def scan_bytes(data):
    """Return locations and rule names, never the matched bytes."""
    findings = set()
    for rule, pattern in PATTERNS.items():
        for match in pattern.finditer(data):
            findings.add((data.count(b"\n", 0, match.start()) + 1, rule))
    for match in JWT.finditer(data):
        try:
            payload = json.loads(base64.urlsafe_b64decode(match[1] + b"=" * (-len(match[1]) % 4)))
        except (ValueError, UnicodeError):
            continue
        if isinstance(payload, dict) and payload.get("role") == "service_role":
            findings.add((data.count(b"\n", 0, match.start()) + 1, "supabase-service-role-jwt"))
    return sorted(findings)


def audit(root, history=False):
    if history and git(root, "rev-parse", "--is-shallow-repository").strip() == b"true":
        raise RuntimeError("History audit requires a complete clone, not a shallow repository")
    findings = []
    counts = {"working_files": 0, "index_blobs": 0, "history_blobs": 0}
    exception_file = root / "scripts/publication-path-exceptions.json"
    exceptions = json.loads(exception_file.read_text()) if exception_file.exists() else []
    reviewed_paths = []
    for item in exceptions:
        if (set(item) != {"path", "object", "reason"} or not isinstance(item["path"], str)
                or not isinstance(item["reason"], str) or not item["reason"].strip()
                or not isinstance(item["object"], str) or not re.fullmatch(r"[0-9a-f]{40,64}", item["object"])):
            raise RuntimeError("Invalid historical path exception")

    def inspect(source, path, data, object_id=None):
        common = {"source": source, "path": path}
        if object_id:
            common["object"] = object_id
        exception = next((item for item in exceptions if source == "history"
                          and item["path"] == path and item["object"] == object_id), None)
        if forbidden_path(path) and exception:
            reviewed_paths.append(exception)
        elif forbidden_path(path):
            findings.append({**common, "line": 1, "rule": "private-file-path"})
        for line, rule in scan_bytes(data):
            findings.append({**common, "line": line, "rule": rule})

    # Read both working content and the index: staged secrets must not disappear
    # from the audit merely because a working file was subsequently cleaned up.
    paths = git(root, "ls-files", "--cached", "--others", "--exclude-standard", "-z").split(b"\0")
    for raw in sorted(set(paths) - {b""}):
        name = raw.decode("utf-8")
        path = root / name
        if path.is_symlink():
            findings.append({"source": "working", "path": name, "line": 1, "rule": "symlink-needs-review"})
        elif path.is_file():
            inspect("working", name, path.read_bytes())
            counts["working_files"] += 1
    for entry in git(root, "ls-files", "--stage", "-z").split(b"\0"):
        if not entry:
            continue
        metadata, raw_path = entry.split(b"\t", 1)
        mode, object_id, stage = metadata.decode().split()
        name = raw_path.decode("utf-8")
        if stage != "0" or mode in {"120000", "160000"}:
            findings.append({"source": "index", "path": name, "line": 1, "rule": "non-file-index-entry-needs-review"})
            continue
        inspect("index", name, git(root, "cat-file", "blob", object_id), object_id)
        counts["index_blobs"] += 1
    if history:
        objects = git(root, "rev-list", "--objects", "--all").splitlines()
        with subprocess.Popen(["git", "-C", str(root), "cat-file", "--batch"],
                              stdin=subprocess.PIPE, stdout=subprocess.PIPE) as process:
            for entry in objects:
                object_id, _, raw_path = entry.partition(b" ")
                process.stdin.write(object_id + b"\n")
                process.stdin.flush()
                header = process.stdout.readline().split()
                if len(header) != 3:
                    raise RuntimeError("Could not read a history object")
                data = process.stdout.read(int(header[2]))
                process.stdout.read(1)
                if header[1] == b"blob":
                    inspect("history", raw_path.decode("utf-8") or "unnamed-object", data, object_id.decode())
                    counts["history_blobs"] += 1
            process.stdin.close()
            if process.wait():
                raise RuntimeError("Git history scan failed")
    return {"history_requested": history, "counts": counts, "findings": findings,
            "reviewed_history_paths": reviewed_paths,
            "limits": "Selected credential formats and paths only. Manually review private data, media, archives and GitHub content."}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--history", action="store_true", help="Also inspect blobs reachable from all local refs")
    parser.add_argument("--report", type=Path, help="Write a JSON report without matched values")
    args = parser.parse_args()
    try:
        root = Path(git(Path.cwd(), "rev-parse", "--show-toplevel").decode().strip())
        report = audit(root, args.history)
    except (OSError, ValueError, RuntimeError, TypeError) as error:
        print(f"Publication audit failed: {error}", file=sys.stderr)
        return 2
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, indent=2) + "\n")
    print("Publication audit: " + json.dumps(report["counts"]))
    for finding in report["findings"]:
        location = f"{finding['source']}:{finding['path']}:{finding['line']}"
        print(f"REVIEW {location} [{finding['rule']}] {finding.get('object', '')}".rstrip())
    print(report["limits"])
    print(f"{len(report['findings'])} findings. Matched values are never printed.")
    return 1 if report["findings"] else 0


if __name__ == "__main__":
    sys.exit(main())
