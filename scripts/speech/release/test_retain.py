import hashlib
import json
from pathlib import Path
import tempfile
import unittest
import urllib.error

from retain import RetentionError, restore, write_history


class RetentionTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.policy = self.root / "policy.json"
        self.current = "1" * 64
        self.previous = "2" * 64
        self.data = b"synthetic source fixture"
        self.archive = {"file": "frontend-source.tar.gz", "bytes": len(self.data), "sha256": hashlib.sha256(self.data).hexdigest()}
        self.manifest = {"release": self.previous, "frontend": self.archive,
                         "espeak": dict(self.archive, file="espeak-source.tar.gz"), "components": []}
        self.raw = json.dumps(self.manifest).encode()
        self.record = {"release": self.previous, "manifestSha256": hashlib.sha256(self.raw).hexdigest()}
        self.urls = {"/source/history.json": json.dumps({"releases": [self.record]}).encode(),
                     f"/source/{self.previous}/manifest.json": self.raw,
                     f"/source/{self.previous}/frontend-source.tar.gz": self.data,
                     f"/source/{self.previous}/espeak-source.tar.gz": self.data}

    def tearDown(self):
        self.temporary.cleanup()

    def fetch(self, path, limit):
        return self.urls[path]

    def test_restores_verified_old_sources(self):
        self.policy.write_text(json.dumps({"expected": [self.record]}))
        result = restore(self.root, self.current, self.policy, self.fetch)
        self.assertEqual(result, [self.record])
        self.assertEqual((self.root / self.previous / "frontend-source.tar.gz").read_bytes(), self.data)
        self.assertEqual((self.root / self.previous / "manifest.json").read_bytes(), self.raw)
        write_history(self.root, result, self.current, b"new manifest")
        self.assertEqual(len(json.loads((self.root / "history.json").read_text())["releases"]), 2)

    def test_missing_known_history_fails_closed(self):
        self.policy.write_text(json.dumps({"expected": [self.record]}))
        with self.assertRaises(RetentionError):
            restore(self.root, self.current, self.policy, lambda path, limit: b"<html>SPA</html>")

    def test_first_release_bootstrap(self):
        self.assertEqual(restore(self.root, self.current, self.policy, lambda path, limit: b"<html>SPA</html>"), [])

    def test_seeded_release_itself_can_be_reproduced(self):
        raw = json.dumps(dict(self.manifest, release=self.current)).encode()
        folder = self.root / self.current
        folder.mkdir()
        (folder / "manifest.json").write_bytes(raw)
        self.policy.write_text(json.dumps({"expected": [{"release": self.current, "manifestSha256": hashlib.sha256(raw).hexdigest()}]}))
        self.assertEqual(restore(self.root, self.current, self.policy, lambda path, limit: b"<html>SPA</html>"), [])

    def test_seeded_manifest_cannot_mutate(self):
        self.policy.write_text(json.dumps({"expected": [dict(self.record, release=self.current)]}))
        with self.assertRaises(RetentionError):
            restore(self.root, self.current, self.policy, lambda path, limit: b"<html>SPA</html>")

    def test_known_release_cannot_disappear(self):
        self.policy.write_text(json.dumps({"expected": [self.record]}))
        self.urls["/source/history.json"] = b'{"releases":[]}'
        with self.assertRaises(RetentionError):
            restore(self.root, self.current, self.policy, self.fetch)

    def test_archive_hash_mismatch_rejected(self):
        self.urls[f"/source/{self.previous}/frontend-source.tar.gz"] = b"corrupted"
        with self.assertRaises(RetentionError):
            restore(self.root, self.current, self.policy, self.fetch)

    def test_manifest_hash_mismatch_rejected(self):
        self.urls[f"/source/{self.previous}/manifest.json"] = b"corrupted"
        with self.assertRaises(RetentionError):
            restore(self.root, self.current, self.policy, self.fetch)

    def test_component_traversal_rejected(self):
        self.manifest["components"] = [dict(self.archive, file="../../private.tar.gz", path="../components/../../private.tar.gz")]
        raw = json.dumps(self.manifest).encode()
        self.urls[f"/source/{self.previous}/manifest.json"] = raw
        self.urls["/source/history.json"] = json.dumps({"releases": [dict(self.record, manifestSha256=hashlib.sha256(raw).hexdigest())]}).encode()
        with self.assertRaises(RetentionError):
            restore(self.root, self.current, self.policy, self.fetch)


if __name__ == "__main__":
    unittest.main()
