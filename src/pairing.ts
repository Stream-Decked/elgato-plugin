import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/** Where clients look for the port and handshake token. */
export const PAIRING_PATH = path.join(os.homedir(), ".config", "streamdecked", "pairing.json");

/**
 * Writes the pairing file the library clients read before connecting. Mode 600
 * keeps the token local to this user; Windows ignores the mode flag.
 */
export async function writePairingFile(port: number, token: string): Promise<void> {
	await fs.mkdir(path.dirname(PAIRING_PATH), { recursive: true });
	await fs.writeFile(PAIRING_PATH, JSON.stringify({ port, token }), { mode: 0o600 });
}