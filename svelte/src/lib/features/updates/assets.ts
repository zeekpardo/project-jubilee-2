// ============================================================
// Which photographs an update still claims
// ============================================================
// `assetIds` is the ONLY handle anything has on an update's blobs: a storage id
// named only from inside the markdown body is invisible to the cascade, which
// keys off columns. So the array the editor sends on save decides two separate
// things at once — what the public renderer is allowed to resolve, and what
// survives. `updateUpdate` deletes every id that falls out of the array,
// because deleting the blob is the only way to revoke a storage URL that has
// already been handed to a visitor. There is no expiry.
//
// That makes BOTH mistakes here real, in opposite directions:
//
//   Sending too many ids — keeping one whose figure the author deleted out of
//   the body — leaves the photograph resolvable and shipped in the page's asset
//   map even though nothing renders it. The author believes they removed a
//   face from a public post, and they did not.
//
//   Sending too few deletes a blob a surviving figure still points at, and the
//   renderer degrades that figure to nothing. A broken post, not a leak.
//
// The first is the one this feature exists to prevent, so removal wins: an id
// is kept only while the body still names it.
// ============================================================

import type { Id } from '$convex/_generated/dataModel';

/**
 * The subset of `tracked` that `body` still refers to.
 *
 * An image lives in the body as `::image{id=<storageId> alt="..."}`, so the raw
 * id appears verbatim in the markdown and a substring test is an exact test —
 * storage ids are opaque and never a substring of ordinary prose. This runs on
 * the markdown the editor holds, never on rendered HTML, where an id would have
 * already been swapped for a URL and every image would look unreferenced.
 */
export function referencedAssetIds(body: string, tracked: Id<'_storage'>[]): Id<'_storage'>[] {
	return tracked.filter((assetId) => body.includes(assetId));
}
