import {defineConfig,RolldownOptions} from "rolldown";
import process from "node:process";

const production = process.env.PRODUCTION === "true";

const baseConfig: RolldownOptions = {
  external: ["vscode", "libsodium-wrappers"],
	output: {
		dir: "dist",
		minify: production,
		sourcemap: !production,
		format: "esm",
	}
};

export default defineConfig([
  {
    ...baseConfig,
    input: "src/extension.ts",
    platform: "node",
		transform: {
			define: { PRODUCTION: String(production) }
		}
  },
  {
    ...baseConfig,
    input: "src/langserver.ts",
    platform: "node",
    treeshake: false,
  }
]);
