# Historia Collect browser extension

This directory contains the unpacked Manifest V3 extension for explicit local
capture of rendered ChatGPT conversations.

- `src/content.js` extracts semantic message blocks from the current page.
- `src/background.js` owns the native-messaging connection and serializes writes.
- `src/popup.*` provides one-click manual collection and connection checks.
- `src/options.*` manages the private source key and opt-in automatic collection.
- `src/privacy.html` discloses collected data, local transport, excluded
  credentials, automatic collection, and Git retention.

The extension never writes the Git vault directly. It sends a bounded
`historia.collect.browser-observation/v1` document to
`ai.greenways.historia_collect`, where the native host validates and archives
it on the same computer.

## Install the local bridge

```bash
historia-collect install --browser chrome
```

The installer reports the checksum-verified unpacked extension directory and
registers the native host at user scope. It supports Chrome, Chromium, Brave,
Microsoft Edge, and Firefox.

The committed public manifest key gives Chromium-family browsers the stable ID:

```text
idfjphfgkpmmgggnbomlalheckgdcefj
```

Firefox uses the declared identity:

```text
historia-collect@greenways.ai
```

Run a post-install diagnostic with:

```bash
historia-collect doctor --browser chrome
```

## Firefox consent

Firefox 140 or newer is required. The manifest uses Firefox's built-in extension
consent model and declares only the categories transferred to the local native
host:

```text
browsingActivity
personalCommunications
websiteContent
```

These represent the current ChatGPT page identity, rendered chat messages, and
visible page content. They do not indicate that Greenways receives the data.

The cross-browser background declaration intentionally contains both:

```json
{
  "scripts": ["src/background.js"],
  "service_worker": "src/background.js",
  "type": "module"
}
```

Firefox uses `scripts`; Chromium-family browsers use `service_worker`.

## Permission boundary

The extension requests only:

```text
nativeMessaging
storage
tabs
```

and content-script access to the declared ChatGPT origins. It does not request
cookies, history, proxy, debugger, management, web-request interception,
geolocation, downloads, or unlimited storage.

See:

- `docs/collect-install.md` for browser registration;
- `docs/browser-collect.md` for collection behavior;
- `docs/collect-privacy.md` for the full data and retention policy.
