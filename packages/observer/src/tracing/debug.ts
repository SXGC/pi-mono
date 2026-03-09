import { getLogger } from "../logger/index.js";

const log = getLogger({ name: "pi-observer" });

export function logTelemetryDebug(message: string, details?: Record<string, unknown>): void {
	if (details) {
		log.debug(details, message);
		return;
	}

	log.debug(message);
}
