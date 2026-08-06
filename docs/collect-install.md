# Installing Historia for ChatGPT

The `historia-collect` installer materializes the checksum-verified Historia for
ChatGPT extension and registers the local native-messaging host at user scope.
The browser companion manages explicit chat bookmarks and prompts; full history
is imported from official ChatGPT exports in the local Historia application.

## Install for one browser

```bash
historia-collect install --browser chrome
```

Supported browser names are:

```text
chrome
chromium
brave
edge
firefox
```

Firefox 140 or newer is required. The extension declares only the
`browsingActivity` data category for explicit active-tab URL/title access.

Configure several browsers in one operation:

```bash
historia-collect install \
  --browser chrome \
  --browser firefox
```

The command returns JSON containing:

- the installed native-host manifest path for each browser;
- the executable or generated launcher used by the manifest;
- the stable extension identity allowed to call the host;
- the unpacked `extension/` directory;
- the browser page where developer-mode extensions are loaded; and
- post-install integrity checks.

## Stable extension identities

Chromium-family extension ID:

```text
idfjphfgkpmmgggnbomlalheckgdcefj
```

Firefox extension ID:

```text
historia-collect@greenways.ai
```

The native-host manifest allows exactly that identity. An unrelated extension
cannot invoke the host through the registration.

## Load the unpacked extension

Open the extension page reported by the installer:

- Chrome and Chromium: `chrome://extensions`
- Brave: `brave://extensions`
- Microsoft Edge: `edge://extensions`
- Firefox: `about:debugging#/runtime/this-firefox`

Enable developer mode where required and load the reported extension directory.
Firefox uses **Load Temporary Add-on** while the extension remains unpacked.

Open the extension action. A supported ChatGPT conversation shows its normalized
URL and title and can be saved after an explicit click. Select **Open companion**
to manage bookmarks, prompts, official-export import, archive search, context,
ledger, and metadata sync.

## Diagnose an installation

```bash
historia-collect doctor --browser chrome
```

The diagnostic checks:

- the native-host manifest exists and parses;
- its host name is `ai.greenways.historia_collect`;
- its extension allowlist matches Historia's stable identity;
- the referenced host executable exists and is executable;
- the Windows user registry entry exists when applicable; and
- the unpacked extension directory matches the embedded checksum manifest.

## Host executable resolution

The installer chooses the host in this order:

1. `--host-path <absolute-path>`;
2. `HISTORIA_COLLECT_HOST`;
3. a compiled `historia-collect-host` beside the running executable;
4. `dist/historia-collect-host` in the package;
5. on macOS and Linux, an owner-only launcher using the absolute Bun runtime.

Windows requires a compiled `historia-collect-host.exe` or an explicit
`--host-path`.

## Remove registrations

```bash
historia-collect uninstall \
  --browser chrome \
  --browser firefox
```

Uninstalling removes requested native manifests and Windows registry entries. It
does not delete the Historia vault, SQLite projection, imported conversations,
or extension metadata.

## Advanced installation

Use an explicit compiled host:

```bash
historia-collect install \
  --browser chrome \
  --host-path /opt/historia/bin/historia-collect-host
```

Use a portable manifest root:

```bash
historia-collect install \
  --browser chromium \
  --manifest-root ./portable-native-hosts
```

Generate a manifest without installing it:

```bash
historia collect native-manifest \
  --browser chrome \
  --extension-id idfjphfgkpmmgggnbomlalheckgdcefj \
  --host-path /absolute/path/to/historia-collect-host \
  --output /tmp/ai.greenways.historia_collect.json
```
