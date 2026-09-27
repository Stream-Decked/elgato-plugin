/**
 * StreamDecked wire protocol: all frames are JSON objects with a `type` field.
 * The plugin hosts the server; library embeddings, one per running client,
 * connect as clients.
 */

/** Opaque JSON carried on a button and echoed back verbatim when it is pressed. */
export type JsonValue =
	| string
	| number
	| boolean
	| null
	| JsonValue[]
	| { [key: string]: JsonValue };

/** A single paintable button the client placed on its surface. */
export interface ButtonSpec {
	/** Linear key index on the deck (row-major: key = row * columns + column). */
	key: number;
	/** Page the button lives on. */
	page: number;
	/** Title painted on the key; omitted keeps the previous title. */
	title?: string;
	/** Raw base64 image bytes (usually PNG); omitted keeps the previous image. */
	imageBase64?: string;
	/** Client defined payload, returned verbatim on press. */
	data?: JsonValue;
}

/** One page of the client's surface model. */
export interface PageSpec {
	page: number;
	buttons: ButtonSpec[];
}

/** Full page model the client pushes when asked for its surface. */
export interface SurfaceModel {
	pages: PageSpec[];
	activePage: number;
}

// ---------------------------------------------------------------------------
// Client -> server
// ---------------------------------------------------------------------------

export interface HelloMessage {
	type: "hello";
	token: string;
	clientName: string;
	libVersion: string;
	[key: string]: unknown;
}

export interface SurfaceMessage {
	type: "surface";
	pages: PageSpec[];
	activePage: number;
	[key: string]: unknown;
}

export interface SetTitleMessage {
	type: "setTitle";
	key: number;
	page: number;
	title: string;
	[key: string]: unknown;
}

export interface SetImageMessage {
	type: "setImage";
	key: number;
	page: number;
	imageBase64: string;
	[key: string]: unknown;
}

export interface SetPageMessage {
	type: "setPage";
	page: number;
	[key: string]: unknown;
}

export interface RemoveButtonMessage {
	type: "removeButton";
	key: number;
	page: number;
	[key: string]: unknown;
}

export interface PingMessage {
	type: "ping";
	[key: string]: unknown;
}

export interface ExitMessage {
	type: "exit";
	[key: string]: unknown;
}

export type ClientMessage =
	| HelloMessage
	| SurfaceMessage
	| SetTitleMessage
	| SetImageMessage
	| SetPageMessage
	| RemoveButtonMessage
	| PingMessage
	| ExitMessage;

// ---------------------------------------------------------------------------
// Server -> client
// ---------------------------------------------------------------------------

export interface DeckInfo {
	deckId: string;
	/** Model display name, matched by the client's DeckModel.fromDisplayName(...). */
	model: string;
	/** Real key grid reported by the device, not the model's canonical size. */
	columns: number;
	rows: number;
	/** Name of the client currently bound to the deck, when any. */
	boundClient?: string | null;
}

export interface HelloOkMessage {
	type: "helloOk";
	pluginVersion: string;
	appVersion: string;
	/** Deck assigned to this client, or null while the client is queued. */
	deckId: string | null;
	decks: DeckInfo[];
}

export interface KeyMessage {
	type: "keyDown" | "keyUp";
	key: number;
	page: number;
	/** Button data attached by the client, when the pressed key was painted. */
	data?: JsonValue;
	deckId: string;
}

export interface PageChangeMessage {
	type: "pageChange";
	page: number;
	deckId: string;
}

export interface EncoderDownMessage {
	type: "encoderDown";
	/** Encoder index, counted from the left of the encoder row. */
	encoder: number;
	deckId: string;
}

export interface EncoderUpMessage {
	type: "encoderUp";
	encoder: number;
	deckId: string;
}

export interface EncoderRotateMessage {
	type: "encoderRotate";
	encoder: number;
	/** Detents since the last event; positive is clockwise. */
	ticks: number;
	deckId: string;
}

export interface ScreenTapMessage {
	type: "screenTap";
	/** Touch strip pixels, origin top left of the whole strip. */
	x: number;
	y: number;
	/** The app reports a held tap through the same event. */
	hold: boolean;
	deckId: string;
}

export interface DeckConnectMessage {
	type: "deckConnect";
	deckId: string;
	model: string;
	columns: number;
	rows: number;
	/** True for device types this plugin does not model; the client should trust columns/rows and paint untransformed. */
	generic: boolean;
}

export interface DeckDisconnectMessage {
	type: "deckDisconnect";
	deckId: string;
	model: string;
	columns: number;
	rows: number;
	generic: boolean;
}

export interface DecksChangedMessage {
	type: "decksChanged";
	decks: DeckInfo[];
}

export interface ErrMessage {
	type: "error";
	message: string;
}

/** Asks the client to (re)push its full surface page model. */
export interface SurfaceRequestMessage {
	type: "surface";
	request: true;
}

export interface PongMessage {
	type: "pong";
}

/** Input the app reports for controls other than the keys. */
export type InputMessage = EncoderDownMessage | EncoderUpMessage | EncoderRotateMessage | ScreenTapMessage;

export type ServerMessage =
	| HelloOkMessage
	| KeyMessage
	| PageChangeMessage
	| DeckConnectMessage
	| DeckDisconnectMessage
	| DecksChangedMessage
	| ErrMessage
	| SurfaceRequestMessage
	| PongMessage
	| InputMessage;

/** `Omit` that distributes over a union, so each variant keeps only its own fields. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** An input frame minus the deck it came from, which the bridge fills in. */
export type InputPayload = DistributiveOmit<InputMessage, "deckId">;

/** Converts raw base64 image bytes into a data URL the Stream Deck app accepts. */
export function dataUrlFor(imageBase64: string): string {
	let mime = "image/png";
	const bytes = Buffer.from(imageBase64, "base64");
	if (bytes.length >= 8 && bytes[0] === 0xff && bytes[1] === 0xd8) {
		mime = "image/jpeg";
	} else if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) {
		mime = "image/bmp";
	}
	return `data:${mime};base64,${imageBase64}`;
}

export function marshal(message: ServerMessage): string {
	return JSON.stringify(message);
}