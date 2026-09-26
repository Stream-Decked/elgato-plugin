import streamDeck from "@elgato/streamdeck";
import { bridge } from "./bridge.js";
import { Modspace } from "./actions/modspace.js";
import { DEFAULT_PORT } from "./config.js";
import { writePairingFile } from "./pairing.js";

streamDeck.logger.setLevel("info");

streamDeck.actions.registerAction(new Modspace());

streamDeck.ui.onSendToPlugin((ev) => {
	const payload = ev.payload as { kind?: string };
	switch (payload?.kind) {
		case "snapshot":
			void streamDeck.ui.sendToPropertyInspector(bridge.snapshot());
			break;
		case "requestSurface":
			bridge.requestAllSurfaces();
			break;
		case "copyToken":
			// The token is already visible in the inspector; nothing further is drawn here.
			break;
	}
});

streamDeck.settings.onDidReceiveGlobalSettings((ev) => {
	const settings = ev.settings as { port?: unknown };
	const port = typeof settings?.port === "number" ? settings.port : DEFAULT_PORT;
	void bridge.start({ port }).catch((err) => streamDeck.logger.error(`could not start the bridge: ${String(err)}`));
});

async function main(): Promise<void> {
	await streamDeck.connect();

	const settings = await streamDeck.settings.getGlobalSettings<{ port?: number }>();
	const port = typeof settings?.port === "number" && settings.port > 0 ? settings.port : DEFAULT_PORT;
	await bridge.start({ port });

	// Make sure a pairing file exists even before any property inspector talk.
	await writePairingFile(bridge.currentPort, bridge.currentToken);
}

void main().catch((err) => streamDeck.logger.error(`startup failed: ${String(err)}`));