# npm publication and Trusted Publishing

Historia publishes the Bun-based CLI package as:

```text
@greenways-ai/historian
```

The normal release path uses npm Trusted Publishing from
`.github/workflows/publish.yml`. Trusted Publishing exchanges GitHub Actions'
short-lived OpenID Connect identity for npm publication authorization and does
not require a stored write token.

A package must already exist on npm before its trusted publisher can be
configured. The first registry version therefore has a separate, explicit
bootstrap workflow.

## Current v0.1.0 state

The Git tag and GitHub Release for `v0.1.0` are public. The standalone Linux,
macOS, and Windows archives, browser-extension ZIP, release manifest, and
`SHA256SUMS` were generated and published successfully.

The initial npm attempt passed the complete tests, analyzer conformance, and
`npm pack --dry-run`, but npm rejected `npm publish` with `ENEEDAUTH` because:

- `@greenways-ai/historian` did not yet exist;
- no Trusted Publisher could therefore be attached to the package;
- no repository secret named `NPM_TOKEN` was configured.

The package itself was not rejected.

## Bootstrap the first npm version

### 1. Create a short-lived granular token

Sign in to npmjs.com as a user who can publish under the `@greenways-ai` scope,
then create a **Granular Access Token** with:

- a descriptive name such as `historia-first-publish`;
- the shortest practical expiration period;
- **Read and write** package access;
- package/scope selection that covers `@greenways-ai`;
- **Bypass two-factor authentication** enabled.

Selecting npm organization-management access is not sufficient by itself to
publish packages. The token needs package or scope write access.

Do not reuse a broad personal token. Legacy access tokens are no longer
supported by npm. This token exists only to create the first immutable registry
version.

### 2. Add the GitHub repository secret

In `greenways-ai/historia`, create the Actions secret:

```text
NPM_TOKEN
```

Paste the granular token as the value. Do not place the token in a workflow,
issue, pull request, source file, command argument, or Actions variable.

### 3. Run the bootstrap workflow

In GitHub Actions, run **Bootstrap npm package** from the default branch with:

```text
version:    0.1.0
source_ref: v0.1.0
```

The workflow:

1. checks out the immutable source ref;
2. verifies its package version;
3. exits without changing anything when that exact npm version already exists;
4. fails before installing dependencies when the token is absent;
5. runs the complete test and conformance suites;
6. applies a deterministic npm-only metadata correction for the historical
   `v0.1.0` package checkout;
7. validates the tarball with `npm pack --dry-run`;
8. publishes the scoped package as public;
9. polls npm until the exact version and registry integrity metadata are visible.

The metadata correction changes only these package fields in the workflow
checkout:

```json
{
  "repository": {
    "type": "git",
    "url": "git+https://github.com/greenways-ai/historia.git"
  },
  "bugs": {
    "url": "https://github.com/greenways-ai/historia/issues"
  },
  "homepage": "https://opensource.greenways.ai/historia/"
}
```

It also removes redundant leading `./` prefixes from npm `bin` paths. Source
files, analyzers, specifications, and runtime behavior remain those of the
selected immutable ref.

The token-authenticated bootstrap intentionally does not request npm provenance.
The workflow itself lives on the default branch while it packages an earlier
release tag, so an attestation to the workflow commit could be mistaken for the
packaged source revision. Subsequent Trusted Publishing releases generate npm
provenance automatically from their matching tag workflow.

## Configure Trusted Publishing

After npm exposes `@greenways-ai/historian`, open the package settings on
npmjs.com and add a Trusted Publisher:

```text
Provider:                    GitHub Actions
GitHub organization/user:    greenways-ai
Repository:                  historia
Workflow filename:           publish.yml
Allowed action:              npm publish
Environment:                 leave empty unless the workflow is updated to use one
```

The workflow filename is only `publish.yml`, not
`.github/workflows/publish.yml`. All names are case-sensitive.

The package's `repository.url` must exactly match the public GitHub repository.
Current package metadata is validated in CI by:

```bash
bun run package:validate
```

Trusted Publishing requires a current npm client and Node runtime. The permanent
workflow pins Node 24 and npm 11.18.0, grants `id-token: write`, runs on a
GitHub-hosted runner, validates the package, and invokes:

```bash
npm publish --access public
```

npm detects the GitHub OIDC environment, issues a short-lived trust token, and
automatically generates provenance for the public package.

## Remove the bootstrap credential

After a later tag has published successfully through `publish.yml`:

1. delete the GitHub repository secret `NPM_TOKEN`;
2. revoke the granular access token on npmjs.com;
3. open the npm package's **Publishing access** settings;
4. select the option requiring two-factor authentication and disallowing
   traditional tokens;
5. retain the GitHub Actions Trusted Publisher.

The token restriction does not disable Trusted Publishing because OIDC uses
short-lived trust tokens rather than traditional access tokens.

The `npm trust` CLI can manage trust relationships, but it cannot authenticate
those package-setting changes with a bypass-2FA granular token. It requires an
interactive two-factor-authenticated account session. For a single package, the
npmjs.com package settings are the clearest handoff.

## Normal tagged releases

For versions after bootstrap:

1. update `package.json` with `npm version` or an equivalent reviewed change;
2. merge the version change;
3. create and push the matching `v*` tag;
4. let `publish.yml` publish npm through OIDC;
5. let `release.yml` build the six standalone platform archives and GitHub
   Release assets independently.

The npm workflow verifies that the tag is `v<package version>`. Rerunning it is
safe: when the immutable npm version already exists, the job reports a no-op.

## Troubleshooting

### `ENEEDAUTH`

For the first package version, confirm that `NPM_TOKEN` exists and is a granular
write token with Bypass 2FA enabled. For later versions, confirm the Trusted
Publisher fields match the GitHub repository and `publish.yml` exactly.

### `E404`

Before bootstrap, a registry lookup for the package is expected to return 404.
After a successful publish, verify the selected npm account owns or can publish
to the `@greenways-ai` scope.

### 2FA challenge in CI

A direct automated publish needs a granular write token created with Bypass 2FA.
A token without bypass can be used for staged publication, but direct
`npm publish` can require proof of presence. The one-time bootstrap workflow is
intentionally a direct publication.

### Provenance or repository mismatch

Confirm:

```text
git+https://github.com/greenways-ai/historia.git
```

is the exact `repository.url`, the repository is public, the workflow runs on a
GitHub-hosted runner, and `id-token: write` is granted.

### Package already exists

npm versions are immutable. Both bootstrap and normal workflows query the exact
version before publishing and leave an existing version unchanged.
