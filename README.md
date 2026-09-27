# Deckedout MC

The Elgato Stream Deck plugin half of [StreamDecked](https://github.com/Stream-Decked/StreamDecked),
published to the Stream Deck app as **Deckedout MC**.

It runs inside the Stream Deck app, owns a local WebSocket, and connects a Stream Deck to a
Minecraft client running the StreamDecked mod.
The plugin sends deck input to the game and pushes the images the game paints back to the keys.

You do not install this by hand. The mod asks the Stream Deck app to install it, along with a
profile called Modspace that takes the deck over.

## Documentation

**[stream-decked.github.io](https://stream-decked.github.io/)**, under
[How it works](https://stream-decked.github.io/streamdecked/how-it-works.html) for the
protocol, and [Getting started](https://stream-decked.github.io/streamdecked/users/getting-started.html)
for users.

## How it fits together

```
Stream Deck  <--WebSocket-->  this plugin  <--WebSocket-->  Minecraft (StreamDecked mod)
```

Only one Stream Deck app exists per machine and it owns the socket, so the plugin is the server
and every library embedding, including the mod, connects in as a client. A client is bound to a
free deck on connect and told which deck it got.

The pair of connections is a loopback-only WebSocket. The plugin writes
`~/.streamdecked/pairing.json` with a port and a token; the client reads it, sends the token as
its first frame, and the plugin closes anything that does not match.

## The Modspace action

One action, `io.github.stream-decked.modspace`, works on keys, on the dials of a Stream Deck
+ and + XL, and on the touchscreen strip. It is the only action the plugin ships.

- **On a key**: pressing it claims the deck for the game. Once the game has painted buttons, a
  press forwards that key to the game, and keys the game has no button on also trigger a
  surface refresh.
- **On a dial**: push, rotate, and release are forwarded as encoder events.
- **On the touchscreen**: taps and holds are forwarded with coordinates in whole-strip pixels,
  so `x` already spans every dial on a + XL.

A Modspace key left on your own profile doubles as the way back into Modspace after the game's
Exit button hands the deck over.

## Requirements

- Stream Deck app 7.1 or newer
- The StreamDecked mod, Minecraft 1.21.1 on NeoForge
- Node.js 20 or newer to build from source

## Building from source

```bash
npm install
npm run build      # rollup, writes io.github.stream-decked.sdPlugin/bin/plugin.js
npm run watch      # rebuild on change
```

The build output is a plugin folder, `io.github.stream-decked.sdPlugin/`, with `manifest.json`,
the bundle, images, and the shipped profile. `make build` does the same thing if you prefer make.

The images and the profile are committed, so a fresh clone already has everything the manifest
points at. `imgs/` is generated from `svg/` and `profiles/streamdecked.streamDeckProfile` from the
Modspace layout, but both generators are kept out of the repository, so if you change an icon or
the profile layout, regenerate them yourself and commit the result.

### Trying it on your deck

Copy the built folder into the Stream Deck app's plugin directory:

```
%APPDATA%\Elgato\StreamDeck\Plugins\io.github.stream-decked.sdPlugin
```

Delete the destination folder rather than copying over it, and **restart the app** afterwards. It
reloads the plugin on its own, but it will not re-read a profile you replaced underneath it, which
is how you end up with blank keys.

### Checking and packaging

```bash
npm run validate    # streamdeck validate, checks the manifest
npm run pack        # streamdeck pack, writes dist/io.github.stream-decked.streamDeckPlugin
```

Both take the plugin folder as their argument, so run them from the repository root and let the
npm script pass the path. Pointing either at the root instead fails with a confusing
`Name must be in reverse DNS format` error, because it validates the folder you hand it.


### Type checking

```bash
npx tsc --noEmit
```

`manifest.json` validates against [Elgato's published schema](https://schemas.elgato.com/streamdeck/plugins/manifest.json),
which is worth checking if you add an action, since the app silently refuses to load a manifest
that does not.

## Project information

- [Documentation](https://stream-decked.github.io/)
- [Licence](https://stream-decked.github.io/about-us/licence.html), Apache 2.0
- [AI stance](https://stream-decked.github.io/about-us/ai-stance.html)
