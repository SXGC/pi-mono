import { createRequire } from "module";

interface ExtractZipOptions {
	dir: string;
}

type ExtractZip = (zipPath: string, options: ExtractZipOptions) => Promise<void>;

const require = createRequire(import.meta.url);
const extractZip = require("extract-zip") as ExtractZip;

export default extractZip;
