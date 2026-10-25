# Prepare a public release

Publishing source and launching hosted accounts are separate steps. Keep real boards, credentials, customer records, database copies and internal evidence outside the source repository.

## Prepare the source

1. Review the diff and every candidate path. Keep reusable tests and intentional fixtures. Exclude generated builds, screenshots, benchmark results, local configuration and private records.
2. Run the checks in [CONTRIBUTING.md](../CONTRIBUTING.md), including the free-app browser check and the real VPS check for server changes.
3. Run `npm audit --audit-level=moderate`. Review new dependencies and preserve their licences and preferred-source inputs.
4. Inspect images, archives and arbitrary text for personal data. The publication audit recognises selected credential formats and forbidden paths. It cannot identify every password, private record or token format.

For an initial release with fresh history, use a new local directory:

```sh
python3 scripts/prepare_public_release.py --output /absolute/path/to/new-public-source
```

The script uses an explicit source allowlist, rejects generated and private paths, scans selected credential formats and creates one commit using the maintainer's GitHub noreply address. It never overwrites a directory, modifies the private history, sets a remote or publishes anything. Review its local manifest in `test-results/publication/`.

Install, build and test from that new repository. Run `python3 scripts/public_readiness.py --history` there. It must have only the intended history and no unintended refs or remotes. For later releases, run the same audit from a complete clone with every branch and tag intended for publication.

The audit checks working candidates, the index and optionally blobs reachable from all local refs. Reports contain locations and rule names without matched values. It does not fetch remote refs, scan Git LFS objects, inspect GitHub content or detect arbitrary personal information. Save detailed output with `--report test-results/publication/audit.json`.

## Preserve the private archive

Keep the original repository private. Its old commits, discussions, Actions logs, artifacts and deployment comments belong to that archive. A fresh source repository must not inherit those refs or uploaded artifacts. Preserve a local Git bundle and review evidence outside the publication tree before any repository rename or remote change.

If reusing an existing repository instead, review its complete GitHub history first. Changing visibility can expose existing Actions content as described in [GitHub's visibility guidance](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility). `scripts/review_github.py --help` describes the read-only download and credential-pattern review. Its cache is private, ignored evidence and must never enter the public repository. Credential scanning alone is not a privacy review.

## Publish the reviewed candidate

- Check the licence scope in [LICENSING.md](../LICENSING.md).
- Confirm the public repository name and publish only the reviewed fresh source commit. Keep the private archive separate.
- Enable [private vulnerability reporting](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository) and available secret protection. Check the destination in `SECURITY.md`.
- Run CI on the exact public candidate. Failure artifacts use short retention and synthetic fixtures.
- Verify anonymous source access and the `/source/` inventory on any deployed browser release. Preserve all previously published source URLs using the instance's retained source tree.

Do not change the existing live website as an incidental part of publication. Export local boards before moving users to a different hostname, because browser storage belongs to the original origin.

## Launch hosting separately

Follow [SELF-HOSTING.md](SELF-HOSTING.md) for a VPS and operator-created accounts. Verify backup restoration, access controls, account recovery and data deletion before accepting real records. Classrooms and device pairing are implemented for the [teacher pilot](TEACHER-PILOT.md). Shared school organisations, delegated roles and billing remain planned in [PROJECT.md](PROJECT.md). Decide pricing and personal-backup policy after a teacher pilot.
