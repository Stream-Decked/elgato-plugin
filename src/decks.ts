/**
 * Deck geometry helpers: the app addresses keys by row/column, the protocol
 * uses linear indices in row-major order (key = row * columns + column), the
 * same convention as the client library.
 */

export interface DeckSize {
	columns: number;
	rows: number;
}

/**
 * Width in logical pixels of the touch strip slice one encoder action owns. The app reports a
 * tap relative to its own action's canvas, so a whole-strip coordinate is
 * `column * ENCODER_STRIP_WIDTH + tapPos.x`. The 800x100 Plus strip is four of these, and the
 * 1200x100 Plus XL strip is six.
 */
export const ENCODER_STRIP_WIDTH = 200;

export interface RowColumn {
	row: number;
	column: number;
}

export function rowColumnToKey(coordinates: RowColumn, size: DeckSize): number {
	return coordinates.row * size.columns + coordinates.column;
}

export function keyToRowColumn(key: number, size: DeckSize): RowColumn {
	return { row: Math.floor(key / size.columns), column: key % size.columns };
}

//TODO - Maybe don't hardcode types and model sizes
//These are what is currently supported though and some others
const MODELS_BY_TYPE: Readonly<Record<string, string>> = {
	"0": "Stream Deck",
	"1": "Stream Deck Mini",
	"2": "Stream Deck XL",
	"3": "Stream Deck Mobile",
	"5": "Stream Deck Pedal",
	"7": "Stream Deck +",
	"9": "Stream Deck Neo",
	"10": "Stream Deck Studio",
	"12": "Galleon 100 SD",
	"13": "Stream Deck + XL",
};

/** Canonical key grid of each modelled hardware type, matching the client library's DeckModel constants. */
const MODELS_SIZE: Readonly<Record<string, DeckSize>> = {
	"0": { columns: 5, rows: 3 },
	"1": { columns: 3, rows: 2 },
	"2": { columns: 8, rows: 4 },
	"5": { columns: 3, rows: 1 },
	"7": { columns: 4, rows: 2 },
	"9": { columns: 4, rows: 2 },
	"13": { columns: 9, rows: 4 },
};

/**
 * Maps a device type (a numeric DeviceType enum value) to the model display
 * name the client library recognises in DeckModel.fromDisplayName(...).
 * Unknown types fall back to a readable name; the client ignores them.
 */
export function modelNameFor(type: string | number | undefined): string {
	if (typeof type === "string") {
		const named = MODELS_BY_TYPE[type];
		if (named) return named;
		return type.replace(/([a-z])([A-Z])/g, "$1 $2");
	}
	return MODELS_BY_TYPE[String(type)] ?? "Stream Deck";
}

/** Whether the device type maps to a known hardware model with a canonical geometry. */
export function isKnownType(type: string | number | undefined): boolean {
	return typeof type === "string" ? type in MODELS_BY_TYPE : String(type) in MODELS_BY_TYPE;
}

/**
 * Whether a deck must be treated as generic. Unknown types always are; a known type is only
 * trusted when the device reports the model's canonical grid, so a virtual deck that emulates a
 * known type but has a different physical layout is still driven by its live geometry.
 */
export function isGeneric(type: string | number | undefined, size: DeckSize): boolean {
	if (!isKnownType(type)) return true;
	const canonical = MODELS_SIZE[String(type)];
	if (!canonical) return false;
	return canonical.columns !== size.columns || canonical.rows !== size.rows;
}