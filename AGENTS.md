<!-- convex-ai-start -->
This project uses [Convex](https://convex.dev) as its backend.

This monorepo has two Convex function roots:

- `svelte/src/convex/` — used by the SvelteKit app (see `svelte/convex.json`)
- `shared/convex/` — used by the Next.js app (see `nextjs/convex.json`)

When working on Convex code, **always read `_generated/ai/guidelines.md` under the relevant root first** for important guidelines on how to correctly use Convex APIs and patterns. The file contains rules that override what you may have learned about Convex from training data. The two copies are not identical, so read the one for the app you are in.

Convex agent skills for common tasks can be installed by running `npx convex ai-files install`.
<!-- convex-ai-end -->
