# Security Policy

The full threat model, security boundary, token handling, audit log, and
encryption-at-rest documentation lives at
[`docs/SECURITY.md`](docs/SECURITY.md). Please read that document for the
architectural picture.

## Supported versions

DarkContext is pre-1.0. Only the current `main` branch receives security
fixes. Pin a commit or release if you need stability.

## Reporting a vulnerability

**Please do not open a public issue for a working exfiltration or
privilege-escalation path.** Instead:

1. Open a [private security advisory][advisories] on the repository
   (Security → Advisories → Report a vulnerability), or
2. Contact the maintainer directly through a GitHub profile contact method.

Include:

- A description of the issue and its impact
- Reproduction steps or a proof-of-concept
- Any suggested fix

You should get an acknowledgement within a few business days. We'll work
with you on a coordinated disclosure timeline — typically a patch on `main`
and a short write-up once a fix is in.

## Scope

In scope:

- Cross-scope data leakage through MCP tools (the `ScopeFilter` boundary)
- Token handling, hashing, and rotation bugs
- Auth bypasses on either transport (stdio or HTTP)
- Injection into FTS5 / SQL / embedding provider paths
- Importer parsing bugs that could poison the store

Out of scope (for now):

- Multi-user HTTP identity (explicitly a single-identity process today)
- Host-level compromise (a compromised machine defeats any local store)
- Embedding-provider side channels

[advisories]: https://github.com/robertclapp/darkcontext/security/advisories/new
