# Historia releases

Historia publishes npm source packages and platform-specific standalone archives.
The standalone archives include the Git-native code index, conversation archive,
Collect installer, native browser host, analyzers, specifications, skills,
configuration examples, and documentation.

## Platform assets

A tagged version produces:

```text
historia-v<version>-linux-x64.tar.gz
historia-v<version>-linux-arm64.tar.gz
historia-v<version>-darwin-x64.tar.gz
historia-v<version>-darwin-arm64.tar.gz
historia-v<version>-windows-x64.zip
historia-v<version>-windows-arm64.zip
historia-collect-extension-v<version>.zip
release-manifest-v1.json
SHA256SUMS
```

Linux and Windows x64 executables use Bun's baseline target for compatibility
with older x64 processors. ARM64 archives use the native ARM64 target.

Each platform archive contains:

```text
historia-v<version>-<platform>/
  bin/
    gw-historian
    historia
    historia-collect
    historia-collect-host
  analyzers/
  docs/
  skills/
  spec/
  bb.edn
  greenways-historian.example.json
  BUILD-INFO.json
  package.json
  README.md
  LICENSE
```

Windows executable names end in `.exe`.

Keep this directory structure intact when using `gw-historian`. The code-history
CLI resolves its analyzer and skill assets relative to the archive root. The
`historia` application embeds its local web interface and chat-agent skill. The
`historia-collect` installer embeds the complete browser extension and
materializes a checksum-verified unpacked copy into Historia's local
configuration directory.

## Verify an asset

Download both the selected archive and `SHA256SUMS`, then verify before
extracting.

On Linux:

```bash
sha256sum --check SHA256SUMS --ignore-missing
```

On macOS:

```bash
shasum -a 256 -c SHA256SUMS
```

PowerShell:

```powershell
$expected = (Get-Content SHA256SUMS | Select-String "windows-x64.zip").ToString().Split()[0]
$actual = (Get-FileHash .\historia-v0.1.0-windows-x64.zip -Algorithm SHA256).Hash.ToLower()
if ($actual -ne $expected) { throw "Historia archive checksum mismatch" }
```

`release-manifest-v1.json` records the version, source commit, Bun release
compiler, target names, extension identities, extension-bundle digest, archive
sizes, and archive SHA-256 values. Every platform package also contains
`BUILD-INFO.json` with target-specific information.

## Run an extracted release

Linux or macOS:

```bash
tar -xzf historia-v0.1.0-linux-x64.tar.gz
cd historia-v0.1.0-linux-x64
./bin/historia --version
./bin/historia vault init
./bin/historia-collect install --browser chrome
./bin/historia collect serve
```

Windows PowerShell:

```powershell
Expand-Archive .\historia-v0.1.0-windows-x64.zip
Set-Location .\historia-v0.1.0-windows-x64
.\bin\historia.exe --version
.\bin\historia.exe vault init
.\bin\historia-collect.exe install --browser edge
```

The native-host installer automatically selects the sibling
`historia-collect-host` executable and writes user-scoped browser registration.
No separate Bun, Node.js, or npm installation is required for these compiled
executables.

## Browser extension ZIP

`historia-collect-extension-v<version>.zip` is provided for extension inspection,
packaging, and manual loading. The same files are embedded in
`historia-collect`; running `historia-collect install` or
`historia-collect paths` creates and verifies the unpacked directory locally.

Chromium-family browsers derive this stable extension ID:

```text
idfjphfgkpmmgggnbomlalheckgdcefj
```

Firefox uses:

```text
historia-collect@greenways.ai
```

## Build artifacts without publishing

Run the complete release build locally with Bun:

```bash
bun install --frozen-lockfile
bun run release:build
```

Build selected targets:

```bash
bun run release:build -- \
  --target linux-x64 \
  --target darwin-arm64
```

The output is written to `dist/release/`. On a compatible host, the builder runs
version checks and materializes the embedded browser extension from the compiled
installer before accepting the archive.

The **Build release artifacts** GitHub workflow can also be dispatched manually.
A manual run validates all targets and exposes the complete release set as a
time-limited workflow artifact without creating a GitHub Release.

## Tagged publication

A Git tag matching `v<package.json version>` starts two independent workflows:

1. npm Trusted Publishing validates and publishes `@greenways-ai/historian`;
2. the release workflow cross-compiles all six platform archives, verifies their
   layouts, writes checksums and manifests, and creates or updates the matching
   GitHub Release.

Publication stops when the tag, optional manually requested version, and
`package.json` version do not match.

## Signing status

The initial standalone archives are checksummed but are not yet Apple-notarized,
Authenticode-signed, or accompanied by Sigstore attestations. Operating systems
may therefore present an unsigned-publisher warning. Do not disable platform
security checks merely to run an unverified download; verify the published
SHA-256, prefer the npm or Homebrew distribution when available, or build from a
reviewed source revision.
