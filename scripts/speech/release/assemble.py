#!/usr/bin/env python3
"""Build deterministic, allowlisted recipient source archives. Never crawls repo."""
import argparse
import concurrent.futures
import gzip
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import posixpath
import re
import stat
import shutil
import tarfile
import urllib.request
import zipfile
from retain import restore, write_history

ROOT = Path(__file__).resolve().parents[3]
LOCK = Path(__file__).with_name("component-lock.json")
WEIGHTS = {".onnx", ".ort", ".npy", ".npz", ".pt", ".pth", ".safetensors", ".ckpt", ".h5", ".hdf5", ".tflite", ".model", ".bin", ".wav", ".mp3", ".flac", ".ogg"}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def safe(path):
    p = PurePosixPath(path)
    if p.is_absolute() or ".." in p.parts or not p.parts:
        raise ValueError(f"Unsafe source path: {path}")
    return p


def fetch(component, cache):
    path = cache / component["cacheFile"]
    if path.exists() and digest(path.read_bytes()) == component["sha256"]:
        return path
    url = component["url"]
    url = re.sub(r"https://github.com/([^/]+/[^/]+)/archive/(.*)\.zip$", r"https://codeload.github.com/\1/zip/\2", url)
    temporary = path.with_suffix(path.suffix + ".partial")
    with urllib.request.urlopen(url, timeout=120) as response, temporary.open("wb") as target:
        shutil.copyfileobj(response, target)
    if digest(temporary.read_bytes()) != component["sha256"]:
        temporary.unlink()
        raise ValueError(f"Source integrity mismatch: {component['name']}")
    temporary.replace(path)
    return path


def retained(name, component):
    parts = safe(name).parts
    if any(p in {".git", "node_modules", ".angular", "testdata", "__tests__"} for p in parts):
        return False
    # eSpeak phoneme WAVs are preferred pronunciation build input, not recordings
    # from users or neural weights. Native dictionary compilation requires them.
    if component == "espeak-ng" and name.startswith("phsource/"):
        return True
    if PurePosixPath(name).suffix.lower() in WEIGHTS:
        return False
    # Only this component's common1.21 is bundled, not its older native runtime.
    if component == "onnxruntime-common121":
        return name.startswith(("js/common/", "js/scripts/")) or name in {
            "LICENSE", "ThirdPartyNotices.txt", "package.json", "js/package.json", "js/package-lock.json", "js/tsconfig.json"
        }
    return True


def component_entries(path, component):
    entries = {}
    if component["format"] == "zip":
        with zipfile.ZipFile(path) as archive:
            for info in archive.infolist():
                if info.is_dir():
                    continue
                name = "/".join(safe(info.filename).parts[1:])
                if name and retained(name, component["name"]):
                    source = info
                    if stat.S_ISLNK(info.external_attr >> 16):
                        target = posixpath.normpath(posixpath.join(posixpath.dirname(info.filename), archive.read(info).decode()))
                        if safe(target).parts[0] != safe(info.filename).parts[0]:
                            raise ValueError("ZIP source link escapes component")
                        try:
                            source = archive.getinfo(target)
                        except KeyError:
                            # Directory links reference Java/Kotlin test fixtures.
                            if any(item.filename.startswith(target.rstrip("/") + "/") for item in archive.infolist()):
                                continue
                            raise
                        if source.is_dir():
                            continue
                    entries[name] = (archive.read(source), 0o755 if (source.external_attr >> 16) & 0o111 else 0o644)
    else:
        with tarfile.open(path) as archive:
            for info in archive:
                if not (info.isfile() or info.issym() or info.islnk()):
                    continue
                name = "/".join(safe(info.name).parts[1:])
                if name and retained(name, component["name"]):
                    # Resolve upstream file links to actual preferred text. Directory
                    # links only reference test fixtures and are not needed to build.
                    try:
                        source = archive.extractfile(info)
                    except KeyError:
                        if info.issym():
                            continue
                        raise
                    if source is not None:
                        entries[name] = (source.read(), 0o755 if info.mode & 0o111 else 0o644)
    entries["SAYBOARD-SOURCE-PROVENANCE.json"] = (json.dumps(component, indent=2).encode() + b"\n", 0o644)
    return entries


def write_archive(target, prefix, entries):
    # gzip filename/mtime and tar owner/order/times are deliberately fixed.
    temporary = target.with_suffix(target.suffix + ".partial")
    with temporary.open("wb") as raw, gzip.GzipFile(fileobj=raw, mode="wb", filename="", mtime=0, compresslevel=6) as zipped:
        with tarfile.open(fileobj=zipped, mode="w", format=tarfile.PAX_FORMAT) as archive:
            for name, (data, mode) in sorted(entries.items()):
                safe(name)
                info = tarfile.TarInfo(prefix + "/" + name)
                info.size, info.mode, info.mtime = len(data), mode, 0
                info.uid = info.gid = 0
                info.uname = info.gname = ""
                archive.addfile(info, io.BytesIO(data))
    temporary.replace(target)
    return {"file": target.name, "sha256": digest(target.read_bytes()), "bytes": target.stat().st_size}


def standalone_lock(package, lock):
    """Keep the installed frozen frontend dependency closure without npm rewriting."""
    original = lock["packages"]

    def resolve(name, parent):
        while True:
            key = (parent + "/" if parent else "") + "node_modules/" + name
            if key in original and not original[key].get("link"):
                return key
            if not parent:
                return None
            parent = parent.rsplit("/node_modules/", 1)[0] if "/node_modules/" in parent else ""

    keep = {""}
    pending = []
    for field in ["dependencies", "devDependencies", "optionalDependencies"]:
        for name in package.get(field, {}):
            key = resolve(name, "")
            if key is None and field != "optionalDependencies":
                raise ValueError("Frozen frontend root dependency missing: " + name)
            if key:
                pending.append(key)
    while pending:
        key = pending.pop()
        if key in keep:
            continue
        keep.add(key)
        item = original[key]
        for field in ["dependencies", "optionalDependencies", "peerDependencies"]:
            for name in item.get(field, {}):
                resolved = resolve(name, key)
                if resolved is None and field == "dependencies":
                    raise ValueError("Frozen dependency missing: " + name + " required by " + key)
                if resolved:
                    pending.append(resolved)
    lock["packages"] = {key: item for key, item in original.items() if key in keep}
    root = lock["packages"][""]
    root.pop("workspaces", None)
    for field in ["dependencies", "devDependencies", "optionalDependencies"]:
        if field in package:
            root[field] = package[field]
        else:
            root.pop(field, None)
    return lock


def frontend_entries():
    paths = []
    for base in ["src", "scripts/speech/espeak", "scripts/speech/release"]:
        paths.extend(p for p in (ROOT / base).rglob("*") if p.is_file() and "__pycache__" not in p.parts
                     and p.name not in {"proposal-manifest.json", "retention-policy.json"})
    paths.extend(ROOT / p for p in ["index.html", "package.json", "package-lock.json", "tsconfig.json", "vite.config.ts", "eslint.config.js", "vitest.config.ts", "CATALOGUE-LICENSE.txt", "ICON-LICENSE.txt"])
    paths.extend(p for p in (ROOT / "public").iterdir() if p.is_file())
    paths.extend(ROOT / p for p in ["LICENSE", "LICENSING.md", "LICENSE-OWNER-MIT", "LICENSE-MIT", "COPYING", "THIRD-PARTY-NOTICES.txt", "THIRD-PARTY-NOTICES.md"] if (ROOT / p).exists())
    # Include only the isolated frontend speech harness/tests, no account/backend tests.
    paths.extend((ROOT / "tests/browser").glob("speech.*"))
    paths.extend((ROOT / "tests/browser").glob("tts-app.mjs"))
    paths.extend((ROOT / "tests/browser").glob("vite.config.mjs"))
    paths.extend((ROOT / "tests").glob("*speech*.test.ts"))
    paths.extend((ROOT / "tests").glob("kokoro*.test.ts"))
    paths.extend((ROOT / "tests").glob("browser-output.test.ts"))
    entries = {}
    for path in sorted(set(paths)):
        relative = path.relative_to(ROOT).as_posix()
        safe(relative)
        if path.is_symlink() or any(part.startswith(".env") for part in path.parts):
            raise ValueError(f"Forbidden frontend source: {relative}")
        entries[relative] = (path.read_bytes(), 0o755 if path.stat().st_mode & 0o111 else 0o644)
    package = json.loads(entries["package.json"][0])
    package.pop("workspaces", None)
    package["scripts"] = {name: command for name, command in package["scripts"].items()
                          if name in {"dev", "build", "typecheck", "lint", "test", "preview", "test:speech:browser", "source:assemble"}}
    package["scripts"].pop("source:assemble", None)
    # Pure frozen-lock closure avoids npm-version/platform metadata differences.
    package["scripts"]["build"] = "tsc --noEmit && vite build"
    config = json.loads(entries["tsconfig.json"][0])
    config["include"] = ["src", "tests", "*.ts"]
    entries["package.json"] = (json.dumps(package, indent=2).encode() + b"\n", 0o644)
    entries["tsconfig.json"] = (json.dumps(config, indent=2).encode() + b"\n", 0o644)
    lock = standalone_lock(package, json.loads(entries["package-lock.json"][0]))
    entries["package-lock.json"] = (json.dumps(lock, indent=2).encode() + b"\n", 0o644)
    entries["SOURCE-README.md"] = ((
        "# Sayboard browser frontend corresponding source\n\n"
        "The combined browser frontend is distributed under GPL-3.0-or-later. Preserve the included licences and component notices. Owner-authored reusable modules may also carry MIT terms. No backend, deployment secrets, account data, user boards or audio is included.\n\n"
        "Use Node 22.13+ or 24+. Run `npm ci --ignore-scripts` then `npm run build`. The ignored install scripts concern native ORT/sharp dependencies unused by this browser build. Browser dependencies remain frozen in package-lock.json.\n\n"
        "For this standalone browser reproduction package, backend workspace entries and unreachable dependencies were removed from package.json/package-lock.json, and tsconfig excludes api/. The full project also licenses its original backend under GPL-3.0-or-later; see LICENSING.md. Browser source and Vite build settings are unchanged. Public source archives are not recursively embedded. All speech sources, eSpeak binaries and recipes are included. Companion archives supply original preferred runtime dependency sources and build scripts.\n\n"
        "eSpeak rebuild instructions are in scripts/speech/espeak/README.md. ORT source includes its native C/C++/JS/TS, CMake dependencies, JS lock and WASM CI recipes. The supplied runtime is the upstream npm WASM artifact pinned by lock integrity; its full local recompilation was not performed. The upstream matching recipe uses Emscripten4.0.4, Release, build_wasm+SIMD+threads+JSEP+WebNN. eSpeak uses Emscripten3.1.64. Companion Emscripten archives include the linked musl/runtime preferred sources. General compiler/tool executables are installed separately.\n"
    ).encode(), 0o644)
    return entries


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache", type=Path, default=Path(os.environ.get("SAYBOARD_SOURCE_CACHE", str(ROOT / "node_modules/.cache/source"))))
    parser.add_argument("--output", type=Path, default=ROOT / "public/source")
    parser.add_argument("--components-only", action="store_true")
    args = parser.parse_args()
    args.cache.mkdir(parents=True, exist_ok=True)
    components = json.loads(LOCK.read_text())
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as workers:
        list(workers.map(lambda component: fetch(component, args.cache), components))
    component_dir = args.output / "components"
    component_dir.mkdir(parents=True, exist_ok=True)
    normalized = args.cache / "normalized"
    normalized.mkdir(parents=True, exist_ok=True)
    results = []
    packaging = digest(Path(__file__).read_bytes())[:12]
    for component in components:
        cached = normalized / (component["name"] + "-" + component["sha256"][:16] + "-" + packaging + ".tar.gz")
        if not cached.exists():
            report = write_archive(cached, "sayboard-" + component["name"] + "-source", component_entries(args.cache / component["cacheFile"], component))
        else:
            report = {"file": cached.name, "sha256": digest(cached.read_bytes()), "bytes": cached.stat().st_size}
        target = component_dir / (component["name"] + "-" + report["sha256"] + ".tar.gz")
        if not target.exists() or digest(target.read_bytes()) != report["sha256"]:
            temporary = target.with_suffix(target.suffix + ".partial")
            shutil.copyfile(cached, temporary)
            temporary.replace(target)
        report["file"] = target.name
        results.append(dict(report, component=component, path="../components/" + target.name))
        print(component["name"], report["bytes"], flush=True)
    if args.components_only:
        (component_dir / "manifest.json").write_text(json.dumps(results, indent=2) + "\n")
        return
    by_name = {component["name"]: component for component in components}
    espeak_entries = component_entries(args.cache / by_name["espeak-ng"]["cacheFile"], by_name["espeak-ng"])
    sonic_entries = component_entries(args.cache / by_name["sonic"]["cacheFile"], by_name["sonic"])
    for name, value in sonic_entries.items():
        espeak_entries["sayboard-recipe/sonic/" + name] = value
    for name in ["build.sh", "glue.c", "README.md", "provenance.json"]:
        source = ROOT / "scripts/speech/espeak" / name
        espeak_entries["sayboard-recipe/" + name] = (source.read_bytes(), 0o755 if name == "build.sh" else 0o644)
    espeak_entries["sayboard-recipe/phonemizer.ts"] = ((ROOT / "src/speech/phonemizer.ts").read_bytes(), 0o644)
    for name in ["EMSCRIPTEN-AUTHORS", "EMSCRIPTEN-LICENSE"]:
        espeak_entries["sayboard-recipe/" + name] = ((ROOT / "src/speech/vendor/espeak" / name).read_bytes(), 0o644)
    entries = frontend_entries()
    identity = digest(b"".join(name.encode() + b"\0" + data for name, (data, _) in sorted(entries.items())))
    release = args.output / identity
    release.mkdir(parents=True, exist_ok=True)
    frontend = write_archive(release / "frontend-source.tar.gz", "sayboard-frontend-source", entries)
    espeak = write_archive(release / "espeak-source.tar.gz", "sayboard-espeak-source", espeak_entries)
    manifest = {"release": identity, "licence": "GPL-3.0-or-later combined browser frontend; preserved third-party terms", "frontend": frontend,
                "frontendInventory": [{"path": name, "sha256": digest(data), "bytes": len(data)} for name, (data, _) in sorted(entries.items())],
                "espeak": espeak, "components": results}
    (release / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    previous = restore(args.output, identity, Path(os.environ.get("SAYBOARD_SOURCE_POLICY", str(Path(__file__).with_name("retention-policy.json")))))
    seed = write_history(args.output, previous, identity, (release / "manifest.json").read_bytes())
    # Release maintainers check this generated seed into retention-policy.json
    # after initial capture. The acquisition policy is not a runtime input.
    print("SOURCE_RETENTION_SEED=" + json.dumps(seed, separators=(",", ":")))
    # Plain GET links work without GitHub accounts or JavaScript.
    links = [f'<li><a href="{identity}/frontend-source.tar.gz">Frontend source</a></li>', f'<li><a href="{identity}/espeak-source.tar.gz">eSpeak preferred source and build recipe</a></li>', f'<li><a href="{identity}/manifest.json">Release manifest and hashes</a></li>']
    links.extend(f'<li><a href="components/{item["file"]}">{item["component"]["name"]} preferred source</a></li>' for item in results)
    page = '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Sayboard source and licences</title><body><h1>Sayboard source and licences</h1><p>This browser frontend is distributed under GPL-3.0-or-later. You may copy, modify and redistribute it under those terms. These source archives are free and require no GitHub login. Backend implementation, credentials and user data are excluded.</p><p>Release ' + identity + '</p><ul>' + ''.join(links) + '</ul><p>The manifest contains exact versions and SHA-256 checksums. Build instructions and notices are included in each archive.</p></body></html>\n'
    (args.output / "index.html").write_text(page)
    (args.output / "current.json").write_text(json.dumps({"release": identity, "manifest": identity + "/manifest.json"}) + "\n")
    print("SOURCE_RELEASE=" + identity)


if __name__ == "__main__":
    main()
