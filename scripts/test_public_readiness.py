"""Prove the publication audit finds staged and deleted synthetic secrets."""
import base64
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

from public_readiness import audit, forbidden_path, scan_bytes


class PublicationAuditTests(unittest.TestCase):
    def test_paths(self):
        for name in [".env", ".env.production", ".vercel/project.json", "backend/.data/a.sqlite", "supabase/.temp/id", "recording.wav", "server-dist/server.cjs", "test-results/report.json", "scripts/performance/results/report.md", "node_modules/demo/index.js", ".git/config"]:
            self.assertTrue(forbidden_path(name), name)
        for name in [".env.example", "supabase/migrations/001.sql", "tests/fixtures/board.json", "tests/fixtures/catalogue-baseline.json", "src/data/words.ts", "public/icon.png"]:
            self.assertFalse(forbidden_path(name), name)

    def test_secret_formats_and_line_numbers(self):
        samples = [
            (b"ghp_" + b"a" * 36, "github-token"),
            (b"sb_secret_" + b"a" * 30, "secret-api-key"),
            (b"re_" + b"a" * 30, "resend-key"),
            (b"-----BEGIN " + b"PRIVATE KEY-----", "private-key"),
        ]
        for secret, rule in samples:
            self.assertIn((2, rule), scan_bytes(b"comment\n" + secret))
        payload = base64.urlsafe_b64encode(json.dumps({"role": "service_role"}).encode()).rstrip(b"=")
        token = b"eyJhbGciOiJIUzI1NiJ9." + payload + b".synthetic"
        self.assertEqual(scan_bytes(token), [(1, "supabase-service-role-jwt")])
        public_payload = base64.urlsafe_b64encode(b'{"role":"anon"}').rstrip(b"=")
        self.assertEqual(scan_bytes(b"eyJhbGciOiJIUzI1NiJ9." + public_payload + b".synthetic"), [])

    def test_real_git_index_history_and_redaction(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)

            def git(*args):
                return subprocess.run(["git", "-C", directory, *args], check=True, capture_output=True)

            git("init")
            git("config", "user.name", "Synthetic audit test")
            git("config", "user.email", "test@example.invalid")
            (root / ".gitignore").write_text(".env.local\n")
            (root / ".env.local").write_text("ignored local configuration")
            secret = "ghp_" + "q" * 36
            candidate = root / "candidate.txt"
            candidate.write_text(secret)
            git("add", ".")
            candidate.write_text("clean working content")
            report = audit(root)
            self.assertTrue(any(f["source"] == "index" and f["rule"] == "github-token" for f in report["findings"]))
            self.assertNotIn(secret, json.dumps(report))
            git("commit", "-m", "synthetic historical secret")
            git("rm", "-f", "candidate.txt")
            git("commit", "-m", "remove synthetic secret")
            self.assertEqual(audit(root)["findings"], [])
            history_report = audit(root, history=True)
            self.assertTrue(any(f["source"] == "history" and f["rule"] == "github-token" for f in history_report["findings"]))
            self.assertNotIn(secret, json.dumps(history_report))
            result = subprocess.run(["python3", str(Path(__file__).with_name("public_readiness.py")), "--history"], cwd=root, capture_output=True, text=True)
            self.assertEqual(result.returncode, 1)
            self.assertNotIn(secret, result.stdout + result.stderr)
            (root / "link.txt").symlink_to(root / ".env.local")
            self.assertTrue(any(f["rule"] == "symlink-needs-review" for f in audit(root)["findings"]))
            with tempfile.TemporaryDirectory() as clone:
                subprocess.run(["git", "clone", "--depth", "1", root.as_uri(), clone], check=True, capture_output=True)
                with self.assertRaisesRegex(RuntimeError, "complete clone"):
                    audit(Path(clone), history=True)

    def test_history_exception_is_exact_and_does_not_hide_credentials(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)

            def git(*args):
                return subprocess.run(["git", "-C", directory, *args], check=True, capture_output=True).stdout

            git("init")
            git("config", "user.name", "Synthetic audit test")
            git("config", "user.email", "test@example.invalid")
            candidate = root / ".env"
            candidate.write_text("ghp_" + "z" * 36)
            git("add", ".")
            object_id = git("rev-parse", ":.env").decode().strip()
            git("commit", "-m", "synthetic private path")
            exceptions = root / "scripts/publication-path-exceptions.json"
            exceptions.parent.mkdir()
            exceptions.write_text(json.dumps([{"path": ".env", "object": object_id, "reason": "Synthetic test exception"}]))
            report = audit(root, history=True)
            self.assertTrue(any(f["source"] == "history" and f["rule"] == "github-token" for f in report["findings"]))
            self.assertFalse(any(f["source"] == "history" and f["rule"] == "private-file-path" for f in report["findings"]))
            self.assertTrue(any(f["source"] == "working" and f["rule"] == "private-file-path" for f in report["findings"]))
            self.assertTrue(any(f["source"] == "index" and f["rule"] == "private-file-path" for f in report["findings"]))
            candidate.write_text("changed content")
            git("add", ".env")
            git("commit", "-m", "different private file bytes")
            self.assertTrue(any(f["source"] == "history" and f["rule"] == "private-file-path" for f in audit(root, history=True)["findings"]))


if __name__ == "__main__":
    unittest.main()
