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
			strategy: ['cookie', 'preferredLanguage', 'baseLocale'],
			// MUST match the `--output-structure` the postinstall script passes.
			// It defaults to 'message-modules', which writes a different file
			// layout than the 'locale-modules' one postinstall produces — and the
			// app imports `paraglide/messages.js`, which re-exports
			// `messages/_index.js`, a file only the locale-modules structure
			// generates. With the two disagreeing, `pnpm dev` compiled into the
			// other layout and left `_index.js` exactly as the last `pnpm install`
			// had written it, so a newly added message key resolved to undefined
			// and its call site threw `m.someKey is not a function`. Whether that
			// bit you depended on how recently you had installed.
			outputStructure: 'locale-modules'
		}),
		tailwindcss(),
		sveltekit()
	],
	server: {
		fs: {
			// Allow serving files from one level up from the project root (includes node_modules)
			allow: ['..']
		}
	},
	test: {
		include: ['src/**/*.{test,spec}.{js,ts}']
	}
};

export default defineConfig(config);
