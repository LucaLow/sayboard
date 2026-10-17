import copy
import unittest
from assemble import standalone_lock


class FrozenLockTests(unittest.TestCase):
    def setUp(self):
        self.package = {"dependencies": {"browser": "1.0.0"}}
        self.lock = {"lockfileVersion": 3, "packages": {
            "": {"dependencies": self.package["dependencies"], "workspaces": ["backend"]},
            "backend": {"dependencies": {"server": "1.0.0"}},
            "node_modules/backend": {"link": True, "resolved": "backend"},
            "node_modules/browser": {"version": "1.0.0", "integrity": "frozen-browser", "dependencies": {"shared": "1.0.0"}, "peerDependencies": {"peer": "2.0.0"}, "optionalDependencies": {"platform": "1.0.0"}},
            "node_modules/browser/node_modules/shared": {"version": "1.0.0", "integrity": "frozen-nested"},
            "node_modules/shared": {"version": "9.0.0"},
            "node_modules/peer": {"version": "2.0.0"},
            "node_modules/platform": {"version": "1.0.0", "os": ["darwin"]},
            "node_modules/server": {"version": "1.0.0"},
        }}

    def test_preserves_nested_optional_peer_slots_and_integrity(self):
        result = standalone_lock(self.package, copy.deepcopy(self.lock))
        self.assertEqual(set(result["packages"]), {"", "node_modules/browser", "node_modules/browser/node_modules/shared", "node_modules/peer", "node_modules/platform"})
        self.assertEqual(result["packages"]["node_modules/browser"]["integrity"], "frozen-browser")
        self.assertNotIn("workspaces", result["packages"][""])

    def test_missing_required_dependency_rejected(self):
        del self.lock["packages"]["node_modules/browser/node_modules/shared"]
        del self.lock["packages"]["node_modules/shared"]
        with self.assertRaises(ValueError):
            standalone_lock(self.package, self.lock)

    def test_missing_root_dependency_rejected(self):
        del self.lock["packages"]["node_modules/browser"]
        with self.assertRaises(ValueError):
            standalone_lock(self.package, self.lock)


if __name__ == "__main__":
    unittest.main()
