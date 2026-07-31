import { defineConfig, type Plugin, type UserConfig } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { paraglideVitePlugin } from '@inlang/paraglide-js';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

const projectRoot = process.cwd();
const sharedConvexRoot = path.resolve(projectRoot, '../shared/convex');
const symlinkedConvexRoot = path.resolve(projectRoot, 'src/convex');

function isBareImport(source: string): boolean {
	return !source.startsWith('.') && !source.startsWith('/') && !source.startsWith('\0');
}

type VitestConfig = UserConfig & {
	test?: {
		include?: string[];
	};
};

const resolveSharedConvexDepsPlugin: Plugin = {
	name: 'resolve-shared-convex-deps',
	enforce: 'pre',
	async resolveId(source, importer) {
		if (!importer || !isBareImport(source)) {
			return null;
		}

		const normalizedImporter = path.normalize(importer);
		if (!normalizedImporter.startsWith(sharedConvexRoot + path.sep)) {
			return null;
		}

		const remappedImporter = path.join(
			symlinkedConvexRoot,
			path.relative(sharedConvexRoot, normalizedImporter)
		);

		return this.resolve(source, remappedImporter, { skipSelf: true });
	}
};

const config: VitestConfig = {
	plugins: [
		resolveSharedConvexDepsPlugin,
		paraglideVitePlugin({
			project: './project.inlang',
			outdir: './src/lib/i18n/paraglide',
			strategy: ['cookie', 'preferredLanguage', 'baseLocale']
		}),
		tailwindcss(),
		sveltekit()
	],
	server: {
		fs: {
			// Allow serving files from one level up from the project root (includes node_modules)
			allow: ['..']
		},
		watch: {
			// Paraglide's output is generated, and watching it is actively harmful:
			// it rewrites every message module on each compile, so one compile
			// became hundreds of page reloads. Watching only part of it is worse
			// still — the plugin's writes to the barrel files feed its own
			// recompile and the dev server never finishes starting.
			//
			// Consequence: a NEW message key needs a dev-server restart to appear.
			// `pnpm dev` recompiles on boot, so restarting is the whole fix.
			ignored: ['**/src/lib/i18n/paraglide/**']
		}
	},
	test: {
		include: ['src/**/*.{test,spec}.{js,ts}']
	}
};

export default defineConfig(config);
