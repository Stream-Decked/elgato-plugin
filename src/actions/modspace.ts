import {
	SingletonAction,
	action,
	type DialDownEvent,
	type DialRotateEvent,
	type DialUpEvent,
	type KeyDownEvent,
	type KeyUpEvent,
	type TouchTapEvent,
	type WillAppearEvent,
} from "@elgato/streamdeck";
import { bridge } from "../bridge.js";
import { MODSPACE_UUID } from "../config.js";
import { ENCODER_STRIP_WIDTH, rowColumnToKey } from "../decks.js";
import type { InputPayload } from "../protocol.js";

/**
 * A Modspace key is the user's opt-in that a Stream Deck key belongs to a decked
 * Minecraft instance. Pressing one forwards the press to the bound client, which
 * routes it to whatever button it has on that key; keys the client has no button
 * on also get a fresh surface request.
 *
 * A Modspace key left on one of the user's own profiles doubles as the way back
 * into Modspace after the in-app Exit button hands the deck over.
 *
 * The same action doubles as a dial and touchscreen target, so a Stream Deck + reports
 * its encoders and touch strip through here as well.
 */
@action({ UUID: MODSPACE_UUID })
export class Modspace extends SingletonAction {
	/** A placed key is paintable territory: re-apply the client's surface. */
	override async onWillAppear(ev: WillAppearEvent): Promise<void> {
		if (ev.action.isKey()) {
			bridge.repaintDeck(ev.action.device.id);
		}
	}

	override async onKeyDown(ev: KeyDownEvent): Promise<void> {
		this.handlePress(ev, true);
	}

	override async onKeyUp(ev: KeyUpEvent): Promise<void> {
		this.handlePress(ev, false);
	}

	override onDialDown(ev: DialDownEvent): void {
		this.handleEncoder(ev, { type: "encoderDown", encoder: this.encoderOf(ev) });
	}

	override onDialUp(ev: DialUpEvent): void {
		this.handleEncoder(ev, { type: "encoderUp", encoder: this.encoderOf(ev) });
	}

	override onDialRotate(ev: DialRotateEvent): void {
		// A push that also rotated arrives as a separate dialDown, so only the rotation is
		// forwarded from here.
		if (ev.payload.ticks === 0) return;
		this.handleEncoder(ev, {
			type: "encoderRotate",
			encoder: this.encoderOf(ev),
			ticks: ev.payload.ticks,
		});
	}

	override onTouchTap(ev: TouchTapEvent): void {
		const column = ev.action.coordinates?.column ?? 0;
		// tapPos is relative to this encoder's slice of the touch strip, so shift it into
		// whole-strip coordinates before forwarding.
		const [x, y] = ev.payload.tapPos;
		this.handleEncoder(ev, {
			type: "screenTap",
			x: column * ENCODER_STRIP_WIDTH + x,
			y,
			hold: ev.payload.hold,
		});
	}

	private handlePress(ev: KeyDownEvent | KeyUpEvent, down: boolean): void {
		if (!ev.action.isKey()) return;
		const coordinates = ev.action.coordinates;
		if (!coordinates) return;
		const device = ev.action.device;
		const key = rowColumnToKey(coordinates, device.size);
		bridge.ensureModspace(device.id);
		bridge.press(device.id, key, down);
	}

	/** Forwards a dial or touchscreen event to the client bound to that deck. */
	private handleEncoder(
		ev: DialDownEvent | DialUpEvent | DialRotateEvent | TouchTapEvent,
		payload: InputPayload,
	): void {
		const deckId = ev.action.device.id;
		bridge.ensureModspace(deckId);
		bridge.input(deckId, payload);
	}

	/** An encoder's index is its column in the encoder row. */
	private encoderOf(ev: DialDownEvent | DialUpEvent | DialRotateEvent): number {
		return ev.action.coordinates?.column ?? 0;
	}
}