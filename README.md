# Historia

Git-native temporal memory for code, AI conversations, and local agent context.

Historia stores authoritative content and ancestry in Git, then builds local,
rebuildable SQLite projections for fast search, lineage, and bounded retrieval.
The core workflow requires no LLM, MCP server, vector database, embedding
provider, or remote service.

## What Historia includes

- **Historian** walks a repository's complete commit DAG, analyzes changed blobs
  once, follows symbols through revisions, and retrieves historical code with
  exact commit provenance.
- **Historia Chat Archive** imports official ChatGPT exports without flattening
  regenerated branches or overwriting edited message revisions.
- **Historia Collect** captures explicitly selected rendered ChatGPT
  conversations through a restricted local browser bridge.
- **Context bundles** give Codex, Kimi, and other local agents bounded,
  token-aware access to archived conversations without modifying their private
  session databases.

Git remains the source of truth. SQLite search indexes, context bundles,
summaries, and application views are derived projections that can be deleted and
rebuilt.

## Installation

### Standalone release

The public [`v0.1.0` GitHub Release](https://github.com/greenways-ai/historia/releases/tag/v0.1.0)
contains verified archives for:

```text
Linux x64 and ARM64
macOS Intel and Apple Silicon
Windows x64 and ARM64
```

Every platform archive contains:

```text
bin/gw-historian
bin/historia
bin/historia-collect
bin/historia-collect-host
```

Download the matching archive and `SHA256SUMS`, verify the digest, then keep the
extracted directory structure intact. See [`docs/releases.md`](docs/releases.md)
for the full verification and installation workflow.

### npm package

The npm package name is:

```text
@greenways-ai/historian
```

The first scoped registry publication needs a one-time granular npm credential
before token-free Trusted Publishing can be configured. Until that bootstrap is
complete, use the standalone release or a source checkout rather than assuming
`npm install` is available.

The exact bootstrap, trusted-publisher configuration, and token-removal process
is documented in [`docs/npm-publishing.md`](docs/npm-publishing.md).

After npm exposes the package:

```bash
npm install -g @greenways-ai/historian
gw-historian doctor
```

The npm package is a Bun package: npm is the distribution channel, while the
installed CLIs run on Bun because they use `bun:sqlite`.

## Requirements for source and npm installations

- Bun 1.2.18 or newer
- Git 2.43 or newer
- Python 3.10 or newer for Python analysis
- Babashka 1.12.218 or newer for Clojure analysis
- clj-kondo for the primary Clojure analyzer

`rewrite-clj` is a Clojure library declared in `bb.edn` and loaded through
Babashka. It is not a separate executable.

Standalone binaries embed Bun. The code-history archive still includes Python,
Babashka, and clj-kondo integrations where those language analyzers are used.

## Conversation memory quick start

Initialize the private local vault:

```bash
historia vault init
```

Import an official ChatGPT export ZIP, extracted directory, or conversation JSON:

```bash
historia chat inspect-openai ~/Downloads/chatgpt-export.zip
historia chat import-openai ~/Downloads/chatgpt-export.zip
```

Build or refresh the rebuildable chat index:

```bash
historia chat index
```

Search current message revisions:

```bash
historia chat search "signed rooms"
```

Construct a bounded context package:

```bash
historia context build \
  "Hestia keys and private rooms" \
  --budget 12000 \
  --include-branches
```

Start the loopback-only Collect application:

```bash
historia collect serve
```

Install the browser-to-native bridge:

```bash
historia-collect install --browser chrome
historia-collect doctor --browser chrome
```

The installer supports Chrome, Chromium, Brave, Edge, and Firefox. It embeds the
complete unpacked extension, materializes it with checksum verification, and
registers the native host at user scope. See:

- [`docs/collect-install.md`](docs/collect-install.md)
- [`docs/browser-collect.md`](docs/browser-collect.md)
- [`docs/collect-app.md`](docs/collect-app.md)
- [`docs/chat-retrieval.md`](docs/chat-retrieval.md)

## Code-history quick start

Copy the example configuration, initialize the SQLite projection, and index a
complete Git clone:

```bash
cp greenways-historian.example.json greenways-historian.json
gw-historian doctor
gw-historian init
gw-historian index /path/to/repository
gw-historian update /path/to/repository
```

Query indexed history:

```bash
gw-historian search "qualified symbol"
gw-historian retrieve "historical context"
gw-historian similar "example.core/answer"
gw-historian changes "parser rename"
gw-historian history "example.core/answer"
gw-historian trace "revision-id"
```

The default database is `.greenways-historian/index.sqlite`. It uses SQLite WAL
mode and content-addressed analyzer results. `update` processes only newly
reachable commits and changed blobs.

Use a complete clone: shallow histories are rejected because Historia cannot
make complete ancestry claims from missing Git objects. Keep one independent
Historian database per repository identity.

See:

- [`spec/temporal-index.md`](spec/temporal-index.md)
- [`docs/operations.md`](docs/operations.md)
- [`docs/analyzer-authoring.md`](docs/analyzer-authoring.md)

## Agent skills

Install the conversation-retrieval skill:

```bash
historia agent install codex
historia agent install kimi
```

Project scope is also supported:

```bash
historia agent install codex --scope project
historia agent install kimi --scope project
```

The code-history skill remains available under
[`skills/greenways-historian-agent/`](skills/greenways-historian-agent/), and the
conversation skill under
[`skills/historia-chat-agent/`](skills/historia-chat-agent/).

Skills instruct agents to use narrow deterministic retrieval, preserve commit
and message provenance, distinguish current and historical revisions, and
report missing analysis instead of inventing history.

## Storage model

A conversation vault is a bare Git repository with source refs such as:

```text
refs/historia/sources/openai/<source-key-digest>
refs/historia/sources/openai-browser/<source-key-digest>
```

One Git commit represents one atomic collection transaction—not one message.
Trees keep normalized message revisions, raw provider records, conversation
graphs, assets, source metadata, and import receipts reachable.

Browser captures are classified as `browser-observed`. They prove what Historia
recorded from a rendered page at a particular archive transaction; they do not
claim provider authorship or account completeness.

The default vault is local, has no configured remote, and emits no core
telemetry.

## Development

```bash
bun install --frozen-lockfile
bun run check
bun run conformance
bun run conformance:typescript
bun run conformance:python
bun run benchmark:validate
```

Build the primary executables:

```bash
bun run build:historia-binary
bun run build:collect-installer-binary
bun run build:collect-host-binary
```

Build all standalone release targets:

```bash
bun run release:build
```

The release builder cross-compiles six platform archives, verifies layouts,
executes host-compatible smoke tests, validates the embedded extension, and
writes `release-manifest-v1.json` plus `SHA256SUMS`.

## npm publishing

Normal tags publish through `.github/workflows/publish.yml` using npm Trusted
Publishing and GitHub OIDC. The workflow validates package identity, tests,
analyzers, tarball contents, and the exact immutable registry version.

The first package version uses the manually dispatched **Bootstrap npm package**
workflow after a short-lived granular `NPM_TOKEN` is added. Once the package
exists, configure `publish.yml` as its Trusted Publisher, test a later tag, then
delete the GitHub secret and revoke the token. See
[`docs/npm-publishing.md`](docs/npm-publishing.md).

## Documentation portal

The complete portal is published at:

```text
https://opensource.greenways.ai/historia/
```

The source is under `site/` and is validated in CI with Node 24, Astro, and
Starlight.

## License

Apache-2.0

The Greenways and Historia names, mosaic marks, logos, and authored artwork are
reserved brand assets as described in [`BRAND.md`](BRAND.md).
