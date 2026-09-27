import { randomBytes } from "node:crypto";
import streamDeck, { type KeyAction } from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";
import { WebSocket, WebSocketServer } from "ws";
import { DEFAULT_PORT, MODSPACE_PROFILE, MODSPACE_UUID } from "./config.js";
import { isGeneric, modelNameFor, rowColumnToKey } from "./decks.js";
import { writePairingFile } from "./pairing.js";
import {
	type ButtonSpec,
	type ClientMessage,
	type DeckInfo,
	type InputPayload,
	type JsonValue,
	type ServerMessage,
	type SurfaceModel,
	dataUrlFor,
	marshal,
} from "./protocol.js";

/** Structural view of a deck the plugin reasons about; keeps `Device`'s private shape out of the way. */
interface DeckLike {
	id: string;
	type: string | number | undefined;
	size: { columns: number; rows: number };
	isConnected: boolean;
}

interface ClientSession {
	socket: WebSocket;
	clientName: string;
	libVersion: string;
	/** Set once the token handshake has validated. */
	ready: boolean;
	/** Deck currently assigned to this client, or null while queued. */
	boundDeckId: string | null;
	surface: SurfaceModel | null;
	activePage: number;
}

interface DeckEntry {
	id: string;
	model: string;
	type: string | number;
	columns: number;
	rows: number;
	generic: boolean;
	connected: boolean;
}

type Snapshot = {
	port: number;
	token: string;
	clients: JsonValue[];
	decks: JsonValue[];
};

const log = streamDeck.logger;

/** A Modspace key as the SDK hands it back, with the SDK's own settings type. */
type ModspaceAction = KeyAction<JsonObject>;

function parseClientMessage(raw: string): ClientMessage | null {
	try {
		const parsed = JSON.parse(raw) as Partial<ClientMessage>;
		if (typeof parsed?.type !== "string") return null;
		return parsed as ClientMessage;
	} catch {
		return null;
	}
}

/**
 * Owns the local bridge: the WebSocket server clients connect to, the deck
 * registry, and the assignment of one free deck to each connected client.
 */
export class Bridge {
	private readonly token: string = randomBytes(24).toString("base64url");
	private readonly sessions = new Set<ClientSession>();
	private readonly decks = new Map<string, DeckEntry>();
	/** Decks currently parked on the shipped Modspace profile. */
	private readonly inModspace = new Set<string>();

	/** In-flight profile switch per deck, awaited by paint work. See {@link switchProfile}. */
	private readonly switching = new Map<string, Promise<void>>();
	private wss: WebSocketServer | null = null;
	private port = DEFAULT_PORT;

	/** Binds the socket, writes the pairing file, and starts watching devices. */
	async start(overrides: { port?: number } = {}): Promise<void> {
		if (this.wss) return;
		this.port = overrides.port && overrides.port > 0 ? overrides.port : DEFAULT_PORT;
		await this.listen();
		this.observeDevices();
		this.seedDecks();
	}

	get currentPort(): number {
		return this.port;
	}

	get currentToken(): string {
		return this.token;
	}

	/** Snapshot for the property inspector. */
	snapshot(): Snapshot {
		return {
			port: this.port,
			token: this.token,
			clients: [...this.sessions].map((s) => ({ name: s.clientName, libVersion: s.libVersion, deckId: s.boundDeckId })),
			decks: [...this.decks.values()].map((d) => ({
				deckId: d.id,
				model: d.model,
				connected: d.connected,
				boundClient: this.boundClientFor(d.id),
			})),
		};
	}

	/** Requests the surface page model from every ready client. */
	requestAllSurfaces(): void {
		for (const session of this.sessions) {
			this.requestSurface(session);
		}
	}

	/** True while a client is bound to `deckId` and can be sent presses. */
	hasBoundClient(deckId: string): boolean {
		return this.sessionForDeck(deckId) !== undefined;
	}

	/**
	 * True when `deckId` is currently showing the shipped Modspace profile.
	 *
	 * The SDK will not say which profile is active, but `device.actions` always reflects
	 * whichever one is showing, and the shipped Modspace profile is made up entirely of
	 * Modspace actions. A full set of them therefore means we are on Modspace, whereas one of
	 * the user's own profiles only has the keys they chose to place.
	 *
	 * This is ground truth, unlike the `inModspace` set, which only records that a client asked
	 * to enter or leave and is empty whenever the game is closed.
	 */
	isShowingModspaceProfile(deckId: string): boolean {
		const device = streamDeck.devices.getDeviceById(deckId);
		const size = device?.size;
		if (!device || !size) return false;
		const keyCount = size.rows * size.columns;
		if (keyCount <= 0) return false;
		return this.modspaceActions(deckId).size >= keyCount;
	}

	/**
	 * Handles a Modspace key or encoder being used while no client is bound to `deckId`.
	 *
	 * Leaving Modspace is normally driven by the mod, which sends an `exit` frame when the
	 * in-app Exit key is pressed. With the game closed there is no socket, so that frame can
	 * never arrive and the deck would be stranded on the Modspace profile. A press is the only
	 * signal left, so use it to switch back to the previous profile.
	 *
	 * Only does this while Modspace is genuinely showing. Switching "to the previous profile"
	 * is only meaningful from Modspace; issued from one of the user's own profiles it would
	 * walk the deck further back through their profile history instead of doing nothing.
	 *
	 * This deliberately does not go through `ensureModspace`: re-entering Modspace with no
	 * client to serve it would both do nothing useful and make the Modspace profile the
	 * deck's own "previous profile", which is what makes a later real exit a no-op.
	 */
	leaveModspaceIfIdle(deckId: string): void {
		if (!this.isShowingModspaceProfile(deckId)) {
			log.info(`deck ${deckId} is not showing Modspace; ignoring press with no client bound`);
			return;
		}
		log.info(`no client bound for deck ${deckId}; leaving Modspace so the deck is not stranded`);
		this.exitModspace(deckId);
	}

	/**
	 * A Modspace key was pressed or released at `key` on `deckId`. Every press is forwarded
	 * to the bound client, which ignores keys it has no button on; keys with no known button
	 * also get a fresh surface request in case the client has repainted since.
	 */
	press(deckId: string, key: number, down: boolean): void {
		const session = this.sessionForDeck(deckId);
		if (!session) {
			log.info(`no bound client for deck ${deckId}; ignoring press on key ${key}`);
			return;
		}
		const spec = this.buttonAt(session, key);
		log.info(`press ${down ? "down" : "up"} on deck ${deckId} key ${key}`);
		this.send(session, {
			type: down ? "keyDown" : "keyUp",
			key,
			page: spec?.page ?? session.activePage,
			deckId,
			...(spec?.data !== undefined ? { data: spec.data as JsonValue } : {}),
		});
		if (!spec) {
			this.requestSurface(session);
			this.repaintDeck(deckId);
		}
	}

	/**
	 * A Modspace encoder or touchscreen action was used on `deckId`. Encoders are addressed by
	 * their column, and a strip tap is reported relative to the one encoder's slice of the
	 * touch strip, so the absolute coordinate is worked out by the caller.
	 */
	input(deckId: string, payload: InputPayload): void {
		const session = this.sessionForDeck(deckId);
		if (!session) {
			log.info(`no bound client for deck ${deckId}; ignoring ${JSON.stringify(payload)}`);
			return;
		}
		this.send(session, { ...payload, deckId } as ServerMessage);
	}

	/** Re-applies the bound client's surface to the Modspace actions on `deckId`. */
	repaintDeck(deckId: string, page?: number): void {
		this.afterSwitch(deckId, () => this.paintDeck(deckId, page));
	}

	private paintDeck(deckId: string, page?: number): void {
		const session = this.sessionForDeck(deckId);
		if (!session?.surface || !this.isShowingModspaceProfile(deckId)) return;
		const actions = this.modspaceActions(deckId);
		let applied = 0;
		let total = 0;
		const missing: number[] = [];
		for (const pageSpec of session.surface.pages) {
			if (page !== undefined && pageSpec.page !== page) continue;
			for (const button of pageSpec.buttons) {
				total++;
				const action = actions.get(button.key);
				if (!action) {
					missing.push(button.key);
					continue;
				}
				applied++;
				if (button.title !== undefined) {
					action.setTitle(button.title).catch((err) => log.warn(`setTitle failed: ${String(err)}`));
				}
				if (button.imageBase64 !== undefined) {
					action.setImage(dataUrlFor(button.imageBase64)).catch((err) => log.warn(`setImage failed: ${String(err)}`));
				}
			}
		}
		const hint = missing.length ? `; no Modspace action on key(s) ${missing.join(",")}` : "";
		log.info(`repainting deck ${deckId}: applied ${applied}/${total} button(s)${hint}`);
	}

	// -----------------------------------------------------------------------
	// Socket serving
	// -----------------------------------------------------------------------

	private listen(): Promise<void> {
		return new Promise((resolve) => {
			const wss = new WebSocketServer({ host: "127.0.0.1", port: this.port }, () => {
				this.wss = wss;
				log.info(`StreamDecked bridge listening on 127.0.0.1:${this.port}`);
				writePairingFile(this.port, this.token).catch((err) =>
					log.error(`could not write pairing file: ${String(err)}`)
				);
				wss.on("connection", (socket) => this.onConnection(socket));
				resolve();
			});
			wss.on("error", (err) => {
				log.error(`bridge error: ${String(err)}`);
				if (!this.wss) resolve();
			});
		});
	}

	private onConnection(socket: WebSocket): void {
		const session: ClientSession = {
			socket,
			clientName: "?",
			libVersion: "?",
			ready: false,
			boundDeckId: null,
			surface: null,
			activePage: 0,
		};
		socket.on("message", (data) => {
			const message = parseClientMessage(data.toString());
			if (!message) {
				this.send(session, { type: "error", message: "expected a JSON object with a type field" });
				socket.close(1003, "bad frame");
				return;
			}
			this.dispatch(session, message);
		});
		socket.on("close", () => this.onClose(session));
		socket.on("error", (err) => log.debug(`client socket error: ${String(err)}`));
	}

	private onClose(session: ClientSession): void {
		this.sessions.delete(session);
		if (session.boundDeckId) {
			const deckId = session.boundDeckId;
			session.boundDeckId = null;
			this.exitModspace(deckId);
			this.bindQueued();
			this.broadcastDecksChanged();
		}
	}

	private dispatch(session: ClientSession, message: ClientMessage): void {
		if (!session.ready && message.type !== "hello") {
			this.send(session, { type: "error", message: "authenticate with hello first" });
			session.socket.close(1008, "not authenticated");
			return;
		}
		switch (message.type) {
			case "hello":
				this.handleHello(session, message);
				break;
			case "surface":
				this.handleSurface(session, message);
				break;
			case "setTitle":
				this.paintButton(session, message.key, message.page, message.title, undefined);
				break;
			case "setImage":
				this.paintButton(session, message.key, message.page, undefined, message.imageBase64);
				break;
			case "setPage":
				this.handleSetPage(session, message.page);
				break;
			case "removeButton":
				this.handleRemoveButton(session, message.key, message.page);
				break;
			case "ping":
				this.send(session, { type: "pong" });
				break;
			case "exit":
				if (session.boundDeckId) {
					this.exitModspace(session.boundDeckId);
					log.info(`client "${session.clientName}" left Modspace on ${session.boundDeckId}`);
				}
				break;
		}
	}

	private handleHello(session: ClientSession, message: ClientMessage & { type: "hello" }): void {
		if (session.ready) {
			this.send(session, { type: "error", message: "already authenticated" });
			return;
		}
		if (message.token !== this.token) {
			this.send(session, { type: "error", message: "invalid token" });
			session.socket.close(1008, "invalid token");
			return;
		}
		session.clientName = String(message.clientName ?? "unnamed").slice(0, 64);
		session.libVersion = String(message.libVersion ?? "unknown").slice(0, 64);
		session.ready = true;
		this.sessions.add(session);

		this.assignDeck(session);
		this.sendHelloOk(session);
		this.broadcastDecksChanged();

		if (session.boundDeckId) {
			const deck = this.decks.get(session.boundDeckId);
			if (deck) this.send(session, this.deckConnectMessage(deck));
		}
		this.enterModspace(session.boundDeckId);
		log.info(`client "${session.clientName}" (lib ${session.libVersion}) connected, bound to deck ${session.boundDeckId ?? "none"}`);
	}

	private handleSurface(session: ClientSession, message: ClientMessage & { type: "surface" }): void {
		const pages = Array.isArray(message.pages) ? message.pages : [];
		session.surface = {
			pages: pages.filter((p) => p && typeof p.page === "number" && Array.isArray(p.buttons)),
			activePage: Number.isFinite(message.activePage) ? message.activePage : session.activePage,
		};
		session.activePage = session.surface.activePage;
		if (session.boundDeckId) this.repaintDeck(session.boundDeckId);
	}

	private handleSetPage(session: ClientSession, page: number): void {
		if (!Number.isFinite(page)) return;
		session.activePage = page;
		if (session.boundDeckId) {
			this.repaintDeck(session.boundDeckId, page);
			this.send(session, { type: "pageChange", page, deckId: session.boundDeckId });
		}
	}

	private handleRemoveButton(session: ClientSession, key: number, page: number): void {
		this.paintButton(session, key, page, undefined, undefined);
		if (session.surface) {
			for (const pageSpec of session.surface.pages) {
				if (pageSpec.page !== page) continue;
				pageSpec.buttons = pageSpec.buttons.filter((b) => b.key !== key);
			}
		}
	}

	/**
	 * Applies a title or image (or resets both with undefined) to the Modspace
	 * action instance at the given key on the client's bound deck.
	 */
	private paintButton(session: ClientSession, key: number, page: number, title: string | undefined, imageBase64: string | undefined): void {
		// The cached surface is always kept up to date, so a later repaint can restore it.
		if (session.surface) {
			const pageSpec = session.surface.pages.find((p) => p.page === page);
			if (pageSpec) {
				let button = pageSpec.buttons.find((b) => b.key === key);
				if (button) {
					if (title !== undefined) button.title = title;
					if (imageBase64 !== undefined) button.imageBase64 = imageBase64;
				} else if (title !== undefined || imageBase64 !== undefined) {
					button = { key, page };
					if (title !== undefined) button.title = title;
					if (imageBase64 !== undefined) button.imageBase64 = imageBase64;
					pageSpec.buttons.push(button);
				}
			}
		}
		const deckId = session.boundDeckId;
		if (!deckId || !this.isShowingModspaceProfile(deckId)) return;
		// Hold the frame until any profile switch in flight has settled, otherwise
		// device.actions still describes the profile being left and the image lands there.
		this.afterSwitch(deckId, () => {
			const action = this.modspaceActions(deckId).get(key);
			if (!action) return;
			if (title !== undefined) action.setTitle(title).catch((err) => log.warn(`setTitle failed: ${String(err)}`));
			if (imageBase64 !== undefined) action.setImage(dataUrlFor(imageBase64)).catch((err) => log.warn(`setImage failed: ${String(err)}`));
		});
	}

	// -----------------------------------------------------------------------
	// Deck registry and binding
	// -----------------------------------------------------------------------

	private observeDevices(): void {
		streamDeck.devices.onDeviceDidConnect((ev) => this.connectDeck(ev.device));
		streamDeck.devices.onDeviceDidDisconnect((ev) => this.disconnectDeck(ev.device.id));
		streamDeck.devices.onDeviceDidChange((ev) => this.changeDeck(ev.device));
	}

	private seedDecks(): void {
		for (const device of streamDeck.devices) {
			if (!this.decks.has(device.id)) {
				this.decks.set(device.id, this.entryFrom(device));
			}
		}
		this.bindQueued();
		this.broadcastDecksChanged();
	}

	private connectDeck(device: DeckLike): void {
		this.decks.set(device.id, this.entryFrom(device));
		this.bindQueued();
		this.broadcastDecksChanged();
	}

	private disconnectDeck(deckId: string): void {
		const deck = this.decks.get(deckId);
		if (!deck) return;
		deck.connected = false;
		const session = this.sessionForDeck(deckId);
		if (session) {
			session.boundDeckId = null;
			this.send(session, {
				type: "deckDisconnect",
				deckId: deck.id,
				model: deck.model,
				columns: deck.columns,
				rows: deck.rows,
				generic: deck.generic,
			});
			log.info(`deck ${deck.id} (${deck.model}) left; client "${session.clientName}" released`);
		}
		this.bindQueued();
		this.broadcastDecksChanged();
	}

	private changeDeck(device: DeckLike): void {
		this.decks.set(device.id, this.entryFrom(device));
		this.broadcastDecksChanged();
	}

	private entryFrom(device: DeckLike): DeckEntry {
		const columns = device.size?.columns ?? 0;
		const rows = device.size?.rows ?? 0;
		const entry: DeckEntry = {
			id: device.id,
			model: modelNameFor(device.type),
			type: device.type as string | number,
			columns,
			rows,
			generic: isGeneric(device.type, { columns, rows }),
			connected: device.isConnected,
		};
		log.info(`deck ${entry.id}: type ${String(entry.type)} ${entry.model} ${columns}x${rows} generic=${entry.generic} connected=${entry.connected}`);
		return entry;
	}

	private deckConnectMessage(deck: DeckEntry): ServerMessage {
		return {
			type: "deckConnect",
			deckId: deck.id,
			model: deck.model,
			columns: deck.columns,
			rows: deck.rows,
			generic: deck.generic,
		};
	}

	/** Gives the next connected, unbound deck to the session, if any. */
	private assignDeck(session: ClientSession): void {
		if (session.boundDeckId) return;
		for (const deck of this.decks.values()) {
			if (deck.connected && !this.sessionForDeck(deck.id)) {
				session.boundDeckId = deck.id;
				return;
			}
		}
	}

	private bindQueued(): void {
		for (const session of this.sessions) {
			if (!session.ready || session.boundDeckId) continue;
			this.assignDeck(session);
			if (session.boundDeckId) {
				this.sendHelloOk(session);
				const deck = this.decks.get(session.boundDeckId);
				if (deck) this.send(session, this.deckConnectMessage(deck));
				this.enterModspace(session.boundDeckId);
			}
		}
	}

	private sendHelloOk(session: ClientSession): void {
		this.send(session, {
			type: "helloOk",
			pluginVersion: streamDeck.info?.plugin?.version ?? "0",
			appVersion: streamDeck.info?.application?.version ?? "0",
			deckId: session.boundDeckId,
			decks: this.connectedDecks(),
		});
	}

	private connectedDecks(): DeckInfo[] {
		return [...this.decks.values()]
			.filter((d) => d.connected)
			.map((d) => ({
				deckId: d.id,
				model: d.model,
				columns: d.columns,
				rows: d.rows,
				boundClient: this.boundClientFor(d.id),
			}));
	}

	private broadcastDecksChanged(): void {
		const decks = this.connectedDecks();
		for (const session of this.sessions) {
			this.send(session, { type: "decksChanged", decks });
		}
	}

	private requestSurface(session: ClientSession): void {
		this.send(session, { type: "surface", request: true });
	}

	/** Switches `deckId` to the shipped Modspace profile (all keys become Modspace). */
	private enterModspace(deckId: string | null): void {
		if (!deckId) return;
		this.inModspace.add(deckId);
		this.switchProfile(deckId, MODSPACE_PROFILE).catch((err) => {
			this.inModspace.delete(deckId);
			log.warn(`could not enter Modspace on ${deckId}: ${String(err)}`);
		});
	}

	/** Restores the deck's previous profile, leaving Modspace. */
	private exitModspace(deckId: string): void {
		this.inModspace.delete(deckId);
		this.switchProfile(deckId).catch((err) => log.warn(`could not leave Modspace on ${deckId}: ${String(err)}`));
	}

	/**
	 * Serialises profile switches per deck and remembers the in-flight one.
	 *
	 * `switchToProfile` is asynchronous, and until it settles `device.actions` still describes
	 * the profile the deck is leaving. Painting in that window stamps the Modspace images onto
	 * the user's own profile and leaves Modspace blank, so paint work is held until the switch
	 * this deck is waiting on has finished.
	 */
	private switchProfile(deckId: string, profile?: string): Promise<void> {
		const next = (this.switching.get(deckId) ?? Promise.resolve())
			.catch(() => undefined)
			.then(() => streamDeck.profiles.switchToProfile(deckId, profile))
			.finally(() => {
				// Only clear our own entry; a later switch may already have replaced it.
				if (this.switching.get(deckId) === next) this.switching.delete(deckId);
			});
		this.switching.set(deckId, next);
		return next;
	}

	/**
	 * Runs `work` once any profile switch in flight on `deckId` has settled, so that it sees
	 * the actions of the profile that will actually be showing. Runs immediately if the deck is
	 * not switching, and still runs if the switch failed.
	 */
	private afterSwitch(deckId: string, work: () => void): void {
		const pending = this.switching.get(deckId);
		if (!pending) {
			work();
			return;
		}
		// `work` runs exactly once: on fulfilment, or on rejection so a failed switch does
		// not strand the deck's display. The trailing catch keeps a throw inside `work`
		// from becoming an unhandled rejection, without re-running it.
		pending.then(work, work).catch((err) => log.warn(`deferred paint on ${deckId} failed: ${String(err)}`));
	}

	/** True while `deckId` is parked on the Modspace profile. */
	isInModspace(deckId: string): boolean {
		return this.inModspace.has(deckId);
	}

	/**
	 * Puts `deckId` back on Modspace unless it already is. This is what makes a Modspace
	 * key left in the user's own profile work as a re-entry point after an Exit press,
	 * so leaving Modspace never strands the deck in an unreachable state.
	 */
	ensureModspace(deckId: string): void {
		if (this.inModspace.has(deckId)) return;
		this.enterModspace(deckId);
	}

	// -----------------------------------------------------------------------
	// Lookups
	// -----------------------------------------------------------------------

	private sessionForDeck(deckId: string): ClientSession | undefined {
		for (const session of this.sessions) {
			if (session.ready && session.boundDeckId === deckId) return session;
		}
		return undefined;
	}

	private boundClientFor(deckId: string): string | null {
		return this.sessionForDeck(deckId)?.clientName ?? null;
	}

	private buttonAt(session: ClientSession, key: number): ButtonSpec | undefined {
		const surface = session.surface;
		if (!surface) return undefined;
		for (const page of surface.pages) {
			if (page.page !== session.activePage) continue;
			const button = page.buttons.find((b) => b.key === key);
			if (button) return button;
		}
		for (const page of surface.pages) {
			const button = page.buttons.find((b) => b.key === key);
			if (button) return button;
		}
		return undefined;
	}

	private modspaceActions(deckId: string): Map<number, ModspaceAction> {
		const map = new Map<number, ModspaceAction>();
		const device = streamDeck.devices.getDeviceById(deckId);
		if (!device) return map;
		for (const action of device.actions) {
			if (!action.isKey() || action.manifestId !== MODSPACE_UUID) continue;
			if (action.isInMultiAction()) continue;
			const coordinates = action.coordinates;
			if (!coordinates) continue;
			map.set(rowColumnToKey(coordinates, device.size), action);
		}
		return map;
	}

	private send(session: ClientSession, message: ServerMessage): void {
		if (!session.ready || session.socket.readyState !== WebSocket.OPEN) return;
		session.socket.send(marshal(message));
	}
}

export const bridge = new Bridge();