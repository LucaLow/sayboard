#!/usr/bin/env python3
"""Download and inspect GitHub publication evidence without printing contents.

Read-only. Raw evidence stays in ignored test-results/github-review with mode 0700.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import zipfile
from public_readiness import scan_bytes


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", required=True)
    args = parser.parse_args()
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", args.repo):
        parser.error("Use owner/repository")
    os.umask(0o077)
    output = Path("test-results/github-review")
    output.mkdir(parents=True, exist_ok=True)
    output.chmod(0o700)
    media = output / "media"
    media.mkdir(exist_ok=True)
    prefix = "repos/" + args.repo + "/"
    findings, unavailable, images, attachments = [], [], {}, set()
    counts = {"runs": 0, "logs": 0, "artifacts": 0, "artifact_entries": 0, "metadata_records": 0}

    def fetch(endpoint, destination, paginated=False):
        path = output / destination
        if path.exists():
            return path.read_bytes()
        command = ["gh", "api", prefix + endpoint if endpoint else prefix.rstrip("/")]
        if paginated:
            command += ["--paginate", "--slurp"]
        result = subprocess.run(command, capture_output=True)
        if result.returncode:
            return None
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(result.stdout)
        return result.stdout

    def inspect(data, source):
        for line, rule in scan_bytes(data):
            findings.append({"source": source, "line": line, "rule": rule})
        for url in re.findall(rb'https://(?:github\.com/user-attachments|user-images\.githubusercontent\.com|private-user-images\.githubusercontent\.com)[^\s"<>\\)]+', data):
            attachments.add(url.decode("utf-8", errors="replace"))

    endpoints = ["", "branches?per_page=100", "tags?per_page=100", "releases?per_page=100", "issues?state=all&per_page=100", "issues/comments?per_page=100", "pulls/comments?per_page=100", "pulls?state=all&per_page=100", "actions/runs?per_page=100", "actions/artifacts?per_page=100"]
    def metadata(endpoint):
        filename = "metadata/" + (endpoint.split("?")[0].replace("/", "-") or "repository") + ".json"
        data = fetch(endpoint, filename, paginated=bool(endpoint))
        if data is None:
            raise RuntimeError("Cannot inventory GitHub metadata: " + endpoint)
        inspect(data, filename)
        pages = json.loads(data)
        if not endpoint:
            return endpoint, pages
        records = []
        for page in pages:
            records.extend(page.get("workflow_runs", page.get("artifacts", [])) if isinstance(page, dict) else page)
        counts["metadata_records"] += len(records)
        return endpoint.split("?")[0], records
    with ThreadPoolExecutor(max_workers=5) as workers:
        inventory = dict(workers.map(metadata, endpoints))
    print("GitHub metadata inventoried", flush=True)
    jobs = []
    for run in inventory["actions/runs"]:
        counts["runs"] += 1
        jobs.append((f"actions/runs/{run['id']}/logs", f"logs/{run['id']}-{run['run_attempt']}.zip", "log"))
    for artifact in inventory["actions/artifacts"]:
        jobs.append((f"actions/artifacts/{artifact['id']}/zip", f"artifacts/{artifact['id']}.zip", "artifact"))
    for pull in inventory["pulls"]:
        jobs.append((f"pulls/{pull['number']}/reviews?per_page=100", f"reviews/{pull['number']}.json", "review"))

    def evidence(job):
        endpoint, filename, kind = job
        data = fetch(endpoint, filename, paginated=kind == "review")
        return job, data
    with ThreadPoolExecutor(max_workers=5) as workers:
        for (endpoint, filename, kind), data in workers.map(evidence, jobs):
            if data is None:
                unavailable.append({"endpoint": endpoint, "kind": kind})
                continue
            if kind == "review":
                inspect(data, filename)
                continue
            counts["logs" if kind == "log" else "artifacts"] += 1
            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                if len(archive.infolist()) > 5000 or sum(item.file_size for item in archive.infolist()) > 250 * 1024 * 1024:
                    raise RuntimeError("Archive exceeds review bounds: " + filename)
                for entry in archive.infolist():
                    path = PurePosixPath(entry.filename)
                    if path.is_absolute() or ".." in path.parts:
                        raise RuntimeError("Unsafe archive path: " + filename)
                    if entry.is_dir():
                        continue
                    content = archive.read(entry)
                    inspect(content, filename + ":" + entry.filename)
                    if kind == "artifact":
                        counts["artifact_entries"] += 1
                        if path.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"}:
                            digest = hashlib.sha256(content).hexdigest()
                            image = media / (digest + path.suffix.lower())
                            image.write_bytes(content)
                            images.setdefault(digest, {"file": str(image), "sources": []})["sources"].append(filename + ":" + entry.filename)
    report = {"repository": args.repo, "visibility": inventory[""]["visibility"], "counts": counts,
              "findings": findings, "unavailable": unavailable, "images": list(images.values()),
              "attachments_needing_review": sorted(attachments),
              "limits": "Credential pattern scan only. Images and arbitrary private text need separate review. No remote content was changed."}
    (output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"counts": counts, "pattern_findings": len(findings), "unavailable": len(unavailable), "unique_images": len(images), "attachment_urls": len(attachments)}), flush=True)


if __name__ == "__main__":
    main()
