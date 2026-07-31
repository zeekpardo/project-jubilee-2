# i18n

Powered by [Paraglide JS](https://paraglidejs.com) (inlang). Messages are compiled at build
time by the Vite plugin in `vite.config.ts` into `src/lib/i18n/paraglide/` (generated, gitignored).

## Usage

```svelte
<script lang="ts">
	import * as m from '$lib/i18n/messages';
</script>

<h1>{m.nav_dashboard()}</h1>
```

Locale helpers live in `$lib/i18n`:

```ts
import { LOCALES, getLocale, switchLocale } from '$lib/i18n';
```

## Adding a new language

- Add the locale tag to `locales` in `project.inlang/settings.json` (e.g. `["en", "fr"]`).
- Copy `messages/en.json` to `messages/<locale>.json` and translate the values — keys must match.
- Add a display name for the tag to `LOCALE_LABELS` in `src/lib/i18n/locale.ts`.
- Restart the dev server (or run `npx paraglide-js compile --project ./project.inlang --outdir ./src/lib/i18n/paraglide`) to regenerate the typed message functions.
- Nothing else changes: detection is `cookie → Accept-Language → baseLocale`, resolved server-side in `src/hooks.server.ts`, so the first paint is already in the right language.
