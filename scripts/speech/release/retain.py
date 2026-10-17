"""Keep corresponding source from earlier public Sayboard releases available."""
import hashlib
import json
import os
from pathlib import Path
import re
import urllib.error
import urllib.parse
import urllib.request

ORIGIN = os.environ.get("SAYBOARD_SOURCE_ORIGIN", "").rstrip("/")
SHA = re.compile(r"^[a-f0-9]{64}$")
FILE = re.compile(r"^[A-Za-z0-9@_.-]+\.tar\.gz$")


class RetentionError(ValueError):
    pass


def sha(data):
    return hashlib.sha256(data).hexdigest()


def get(path, limit):
    if not path.startswith("/source/") or ".." in path or "?" in path or "#" in path:
        raise RetentionError("Unsafe public source GET path")
    if not ORIGIN:
        raise urllib.error.URLError("No prior source origin configured for this independent build")
    parsed = urllib.parse.urlsplit(ORIGIN)
    if parsed.scheme != "https" or not parsed.netloc or parsed.path or parsed.query or parsed.fragment or parsed.username or parsed.password:
        raise RetentionError("Prior source origin must be an exact HTTPS origin")
    request = urllib.request.Request(ORIGIN + path, headers={"Accept": "application/json, application/octet-stream"})
    with urllib.request.urlopen(request, timeout=120) as response:
        if response.geturl() != ORIGIN + path:
            raise RetentionError("Public source request redirected; equivalent unauthenticated access not established")
        data = response.read(limit + 1)
    if len(data) > limit:
        raise RetentionError("Public source response exceeded its bound")
    return data


def identifier(value):
    if not isinstance(value, str) or not SHA.fullmatch(value):
        raise RetentionError("Invalid historical release/content hash")
    return value


def restore(output, current, policy_path, fetch=get):
    """Return exact old manifest records; network source never changes current ID."""
    identifier(current)
    policy = json.loads(Path(policy_path).read_text()) if Path(policy_path).exists() else {"expected": []}
    expected = policy.get("expected", [])
    for record in expected:
        identifier(record["release"])
        identifier(record["manifestSha256"])
        if record["release"] == current:
            manifest = Path(output) / current / "manifest.json"
            if not manifest.exists() or sha(manifest.read_bytes()) != record["manifestSha256"]:
                raise RetentionError("Recreated seeded release manifest differs; refusing mutable source version")
    try:
        history = json.loads(fetch("/source/history.json", 1024 * 1024))
        records = history["releases"]
        if not isinstance(records, list) or len(records) > 256:
            raise RetentionError("Invalid historical release list")
    except (urllib.error.HTTPError, urllib.error.URLError, json.JSONDecodeError, KeyError) as error:
        # A fresh site returns404 or SPAHTML. Bootstrap remains valid only if
        # this build reproduces every seeded release, which can only be itself.
        if any(record["release"] != current for record in expected):
            raise RetentionError("Known published source history is unavailable; refusing release") from error
        return []
    by_release = {}
    for record in records:
        release = identifier(record["release"])
        identifier(record["manifestSha256"])
        if release in by_release and by_release[release] != record:
            raise RetentionError("Conflicting historical manifests")
        by_release[release] = record
    for record in expected:
        if record["release"] == current:
            continue
        if by_release.get(record["release"]) != record:
            raise RetentionError("Known published source omitted or changed")
    for release, record in sorted(by_release.items()):
        if release == current:
            continue
        raw = fetch(f"/source/{release}/manifest.json", 4 * 1024 * 1024)
        if sha(raw) != record["manifestSha256"]:
            raise RetentionError("Historical manifest integrity mismatch")
        manifest = json.loads(raw)
        if manifest.get("release") != release:
            raise RetentionError("Historical release/version mismatch")
        archive_records = []
        for kind, filename in [("frontend", "frontend-source.tar.gz"), ("espeak", "espeak-source.tar.gz")]:
            item = manifest[kind]
            if item.get("file") != filename:
                raise RetentionError("Unexpected frontend/component source filename")
            archive_records.append((f"{release}/{filename}", item))
        components = manifest["components"]
        if not isinstance(components, list) or len(components) > 128:
            raise RetentionError("Invalid historical component list")
        for item in components:
            filename = item["file"]
            if not isinstance(filename, str) or not FILE.fullmatch(filename) or ".." in filename:
                raise RetentionError("Unsafe historical component filename")
            if item.get("path") != "../components/" + filename:
                raise RetentionError("Unexpected historical component path")
            archive_records.append(("components/" + filename, item))
        for relative, item in archive_records:
            checksum = identifier(item["sha256"])
            size = item["bytes"]
            if not isinstance(size, int) or not 0 < size <= 90 * 1024 * 1024:
                raise RetentionError("Historical archive size outside allowed bound")
            target = Path(output) / relative
            if target.exists() and target.stat().st_size == size and sha(target.read_bytes()) == checksum:
                continue
            data = fetch("/source/" + relative, size)
            if len(data) != size or sha(data) != checksum:
                raise RetentionError("Historical source archive integrity mismatch")
            target.parent.mkdir(parents=True, exist_ok=True)
            temporary = target.with_suffix(target.suffix + ".partial")
            temporary.write_bytes(data)
            temporary.replace(target)
        folder = Path(output) / release
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "manifest.json").write_bytes(raw)
    return [record for release, record in sorted(by_release.items()) if release != current]


def write_history(output, previous, current, manifest):
    record = {"release": identifier(current), "manifestSha256": sha(manifest)}
    records = previous + [record]
    (Path(output) / "history.json").write_text(json.dumps({"origin": ORIGIN, "releases": sorted(records, key=lambda item: item["release"])}, indent=2) + "\n")
    return record
