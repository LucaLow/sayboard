# Dependency maintenance

Run `npm ci --ignore-scripts`, then `npm audit --audit-level=moderate` against the root lockfile. The root npm workspace lock is authoritative; there is no separate backend lockfile.

Two targeted overrides address advisories in the browser speech SDK's indirect Node-only dependencies:

- `sharp` is pinned to 0.35.5, which contains the patched native image libraries identified by [GHSA-wq5f-xc86-pv6w](https://github.com/advisories/GHSA-wq5f-xc86-pv6w).
- `global-agent` is pinned to 4.1.3. It removes the old logging chain that pulled in vulnerable `sprintf-js`, for which the registry currently has no patched release. Its `bootstrap` export remains compatible with the ONNX Node installer invocation. The supported app uses the browser ONNX runtime, and the VPS server does not run neural inference.

These overrides do not update the pinned Kokoro model, eSpeak binary, Transformers browser bundle or ONNX browser runtime. Recheck their source inventories when changing speech dependencies. Test the actual browser path and a clean source build after a dependency change.

The standalone server has no managed-authentication, hosting lifecycle or analytics SDK. Its runtime container contains bundled server code, static assets and Node. Optional PostgreSQL uses the standard `pg` driver. A clean npm audit is a registry-advisory result, not a claim that all software or container operating-system packages are free of vulnerabilities.
