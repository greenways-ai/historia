# Installing Historia Collect

Historia Collect connects the browser extension to the local Git-native Historia
vault through a native-messaging host. The `historia-collect` installer registers
that host at user scope and reports the exact extension directory to load.

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

Configure several browsers in one operation by repeating the option:

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
- the browser page where developer-mode extensions are loaded;
- post-install integrity checks.

## Stable extension identities

Historia Collect carries a public extension key in `extension/manifest.json` so
Chromium-family browsers derive the same extension ID on every machine:

```text
idfjphfgkpmmgggnbomlalheckgdcefj
```

Firefox uses the declared extension identity:

```text
historia-collect@greenways.ai
```

The installer writes exactly one allowed origin or extension identity into each
native-host manifest. A different extension cannot invoke the host through that
registration.

## Load the unpacked extension

After installation, open the extension page reported by the command:

- Chrome and Chromium: `chrome://extensions`
- Brave: `brave://extensions`
- Microsoft Edge: `edge://extensions`
- Firefox development loading: `about:debugging#/runtime/this-firefox`

Enable developer mode where required, choose **Load unpacked**, and select the
reported extension directory. Firefox uses **Load Temporary Add-on** while the
extension remains unpacked.

Open the Historia Collect popup and use **Check connection**. A successful ping
confirms that the extension identity, native manifest, executable, and local
vault boundary agree.

## Diagnose an installation

```bash
historia-collect doctor --browser chrome
```

The diagnostic checks:

- the native-host manifest exists and parses;
- its host name is `ai.greenways.historia_collect`;
- its extension allowlist matches Historia's stable identity;
- the referenced host executable exists and is executable;
- the Windows user registry entry exists when running on Windows;
- the unpacked extension directory is present.

The command exits non-zero when any requested browser registration is invalid.

## Host executable resolution

The installer chooses the host in this order:

1. `--host-path <absolute-path>`;
2. `HISTORIA_COLLECT_HOST`;
3. a compiled `historia-collect-host` beside the running executable;
4. `dist/historia-collect-host` in the package;
5. on macOS and Linux, an owner-only launcher that invokes the package's native
   entry with the absolute Bun runtime path.

Windows requires a compiled `historia-collect-host.exe` or an explicit
`--host-path`. The installer writes the browser manifest into Historia's local
configuration directory and registers it under the current user's browser
native-messaging registry key.

## Platform registration locations

At user scope the installer uses the standard native-messaging locations:

- macOS: each browser's `NativeMessagingHosts` directory beneath
  `~/Library/Application Support`;
- Linux: the browser's directory beneath `~/.config`, with Firefox under
  `~/.mozilla/native-messaging-hosts`;
- Windows: a manifest beneath `%LOCALAPPDATA%\Historia` and an `HKCU` browser
  registry entry.

No administrator privileges are required for these registrations.

## Remove registrations

```bash
historia-collect uninstall \
  --browser chrome \
  --browser firefox
```

Uninstalling removes the requested manifests and Windows registry entries. It
does not delete the Historia vault, SQLite projection, imported conversations,
or extension settings.

## Advanced and portable installations

Use an explicit compiled host:

```bash
historia-collect install \
  --browser chrome \
  --host-path /opt/historia/bin/historia-collect-host
```

Use a portable manifest root without touching a browser's normal registration
location:

```bash
historia-collect install \
  --browser chromium \
  --manifest-root ./portable-native-hosts
```

The lower-level manifest generator remains available when another packaging
system owns placement:

```bash
historia collect native-manifest \
  --browser chrome \
  --extension-id idfjphfgkpmmgggnbomlalheckgdcefj \
  --host-path /absolute/path/to/historia-collect-host \
  --output /tmp/ai.greenways.historia_collect.json
```
