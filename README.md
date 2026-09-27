# StreamDecked

The Elgato Stream Deck plugin half of StreamDecked.

It runs inside the Stream Deck app, owns a local WebSocket, and connects a Stream Deck to a
Minecraft client running the [StreamDecked mod](https://github.com/Stream-Decked/StreamDecked).
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

The build output is a complete plugin folder, `io.github.stream-decked.sdPlugin/`, with
`manifest.json`, the bundle, images, and the shipped profile. Copy it to your Stream Deck
plugins directory to try it:

```
%APPDATA%\Elgato\StreamDeck\Plugins\io.github.stream-decked.sdPlugin
```

The Stream Deck app caches the manifest, the bundle, images, and profiles, so **restart the app**
after copying. It reloads the plugin on its own, but it will not re-read a profile you replaced
underneath it.

### Other scripts

```bash
node scripts/generate-icons.mjs     # renders the PNGs from svg/ at each size the manifest wants
python scripts/generate-profile.py   # rebuilds profiles/streamdecked.streamDeckProfile
```

`generate-profile.py` is what fills the Encoder slots in the shipped profile, six of them so a
+ XL is covered and a deck with no dials simply ignores them. Run both scripts before
`npm run build` if you change an icon or the profile layout.

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
