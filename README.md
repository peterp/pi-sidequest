# Sidequest

Sidequest gives [Pi](https://pi.dev) a side channel: ask context-aware questions without pulling the main conversation off track.

Think of it as a better `/btw`: grounded in the active Pi session, threaded, persistent, and tool-capable.

## Install

From GitHub:

```bash
pi install git:github.com/peterp/pi-sidequest
```

After this package is published to npm:

```bash
pi install npm:pi-sidequest
```

For local development:

```bash
pi -e /absolute/path/to/pi-sidequest
```

Or link `sidequest/` as an auto-discovered extension directory:

```bash
ln -s /absolute/path/to/pi-sidequest/sidequest ~/.pi/agent/extensions/sidequest
```

## Use

Open Sidequest inside Pi:

```text
/sidequest
```

Default quake console keys:

```text
§
~
```

Sidequest has two focus areas:

- selection: choose root or a thread
- prompt: type and ask the next question

Press `Tab` to move between them. The inactive area shows `[tab]` in its border.

## Configure the Quake key

Use an env var:

```bash
PI_SIDEQUEST_QUAKE_KEY='`'
```

or a config file:

```json
// ~/.pi/agent/sidequest.json
{
  "quakeKey": "`"
}
```

Multiple keys are supported:

```bash
PI_SIDEQUEST_QUAKE_KEYS='§,~,alt+s'
```

```json
{
  "quakeKeys": ["§", "~", "alt+s"]
}
```

## Tools

Sidequest runs its own isolated, tool-capable Pi worker. By default it enables:

```text
read, grep, find, ls, sidequest_web_search, sidequest_web_fetch
```

Override the allowlist:

```bash
PI_SIDEQUEST_TOOLS='read,grep,find,ls,sidequest_web_search,sidequest_web_fetch'
```

`sidequest_web_search` uses Brave Search when `BRAVE_SEARCH_API_KEY` is set. Otherwise it falls back to DuckDuckGo HTML search. `sidequest_web_fetch` fetches public HTTP(S) pages and extracts readable text.

## Publish

From this directory:

```bash
npm pack --dry-run
npm publish
```
