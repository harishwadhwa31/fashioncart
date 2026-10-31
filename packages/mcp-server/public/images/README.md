# Product images

Served same-origin with the MCP endpoint at `/images/<SKU>/`. Each SKU has `thumb` (320x400) and
a gallery `01`..`0n` (640x800), each as WebP with a JPEG fallback. Every view of a SKU is cut from
one source image; gallery views after `01` are small rotations of it.

Same-origin with the SERVER is still cross-origin from inside the widget, which executes on a
host-controlled sandbox origin. That is why the deployment's public URL is declared in
`_meta.ui.csp.resourceDomains`.

## Where the images come from

Each SKU's `credit` in `data/catalog.json` (mirrored in `data/image_credits.json`) records it:

- `"source": "pexels"`: a stock photograph from Pexels, used under the Pexels License. Each one
  was reviewed at full size and kept only if no logo, wordmark, label text or brand-identifying
  design was visible anywhere in frame. `url` is the photo's Pexels page.
- `"source": "generated"`: a plain synthetic image drawn by `scripts/build_images.py --source
  synthetic` (CC0-1.0). Used wherever a photo could not be verified free of brand elements.

Never add real retailer or brand product photography here, and check any replacement photo for
labels, tags, hardware stamps and packaging before committing it.
