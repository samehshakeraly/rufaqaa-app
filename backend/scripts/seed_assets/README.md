# seed_assets — `scripts.seed_demo` inputs

Static, **clearly-fake** assets used by `python -m scripts.seed_demo`. They are
uploaded to MinIO through the app's own storage layer (`app.services.storage`)
and referenced from the seeded `media` / `documents` rows.

| File | Used for | Notes |
| --- | --- | --- |
| `boy.jpg` | Profile photo for **male** orphans | Flat gender illustration, watermarked `DEMO`. Shared by all boys. |
| `girl.jpg` | Profile photo for **female** orphans | Flat gender illustration, watermarked `DEMO`. Shared by all girls. |
| `sample_document.svg` | The single reusable document placeholder | Stamped **عينة / SAMPLE — NOT A REAL DOCUMENT**. Every seeded document points here. |

## Overriding / fallback

* Drop your own `boy.jpg` / `girl.jpg` here to replace the illustrations — the
  seed detects the content type from the file's magic bytes, so PNG/SVG work too
  (keep the `boy.*` / `girl.*` base name).
* If a profile image is **missing**, the seed falls back to a generated,
  gender-coloured SVG avatar (stdlib only — no Pillow at runtime).
* If `sample_document.svg` is missing, an identical placeholder is generated
  in-process.

Nothing here is a real photo or a real document. Never replace these with images
of real children or real paperwork.
