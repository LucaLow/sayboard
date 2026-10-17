# Security policy

Sayboard is a prototype. Use demonstration data while testing a new installation. Verify account isolation, backup restore and the intended devices before accepting private records. Accounts are operator-provisioned; public signup and email recovery are not implemented.

## Report a vulnerability privately

Use [GitHub private vulnerability reporting](https://github.com/josephtwilliams/sayboard/security/advisories/new). The maintainer must enable this route before the repository's public launch. If the form is unavailable, do not post exploit details or sensitive data in a public issue. A working private reporting route is a launch requirement.

Include the affected version, reproduction steps with synthetic data, expected behaviour and observed impact. Remove tokens, account identifiers, board content and recordings from evidence. No response-time or support guarantee is currently offered.

## Supported versions

Security fixes target the current default branch. Tagged supported releases and a hosted-service support policy have not yet been established.

## Data boundaries

- The free app saves boards in browser storage. Clearing site data can remove them. Export a backup before changing devices or browser profiles.
- Browser code and `VITE_` configuration are public. Secret keys and server credentials must stay on the server.
- Account access must be enforced by server or database permissions. Hidden buttons and caregiver-entry prompts do not provide authentication.
- Do not collect speech histories or upload existing vocabulary on sign-in. Account transfers require a deliberate user action.
- Use separate development and production data. Never commit account databases, exported boards, environment files or audio recordings.
