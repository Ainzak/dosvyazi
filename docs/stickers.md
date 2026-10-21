# Sticker packs

Signed-in users can create packs and find them by a unique permanent name or from a received sticker. Packs are visible to any signed-in user who knows the name; they are not private community resources. The title and sticker labels may use either UI language. Unique names use 3–32 lowercase ASCII letters, numbers, underscores or hyphens, starting with a letter/number. Names remain reserved after retirement to prevent old message links identifying a different pack.

The creator uploads PNG artwork up to 1 MiB or animated GIF artwork up to 3 MiB, with a maximum canvas of 512 × 512 pixels per sticker. The GIF block/frame bounds also apply. The client shows size errors beside the file picker before uploading; the server and PostgreSQL enforce the same format-specific limits for packs and sent copies. A pack contains up to 64 active stickers, an account can own 20 active packs and save 100 packs. The existing private filesystem quota includes pack artwork and sent message copies. No external sticker/GIF provider, remote URL fetching, archive import, TGS or WebM sticker decoder is involved.

Open Stickers in a channel/DM composer to manage packs or choose a saved/owned/built-in pack. Select Use sticker, optionally enter a caption, then Send. Selection prepares an ID, without fetching artwork to the client. View image explicitly downloads an authorized image/GIF for display. Tap the displayed sticker or its pack-info button to open pack information and Save sticker pack. Saving adds a library reference and downloads no artwork. Library and pack metadata load without image requests; animations start only after View. Download file remains a separate action.

## Permissions and lifecycle

Only the creator may add/remove artwork or retire a user-created pack. Removal affects the source pack; sent stickers remain as independent authorized message attachments with pack-name/source metadata. Community View/Send permissions and DM participation/block rules apply when sending. Downloading a sent copy checks message access; knowing its ID alone grants no access. The original pack artwork is independently available to signed-in users because packs are shareable. This does not reveal the source conversation or its text/participants.

Pack creation/uploads have payload-bound retry IDs. Sticker sends reuse the normal message ID, transaction, quota and outbox; an exact retry can return the existing message even after source retirement/purge, while a new send from that retired source fails. Changed captions/source identities conflict. Retiring a pack removes it from saved libraries and prevents new source downloads; message copies remain until their message is deleted. The cleanup worker retries deletion of known retired source blobs and deleted-message copies. Crash-orphan blobs retain the existing conservative storage policy.

The additive `StickerPacks` migration adds packs, source assets and per-user saves; nullable source metadata on existing community/DM attachments leaves prior data intact. HTTP writes use current cookie sessions, CSRF, per-account command/start limits and the shared two-upload concurrency gate. Source mutations serialize account/pack locks and the existing global storage-quota lock.

## Built-in artwork

Operator-managed built-in packs use `BuiltIn=true`, a null owner and the same validated asset storage. They appear in everyone's picker/library and cannot be changed through user ownership routes. No built-in artwork is bundled yet. After an operator reviews supplied artwork and licensing, a controlled server import/migration can register it; client requests cannot promote packs or set the flag. Keep artwork exports, drafts and pack import experiments private until approved for distribution.

## Checks

API tests cover bounded GIF structure, duplicate names/uploads, ownership/anonymous/CSRF denial, personal saves, operator-only built-in metadata, private channel/DM copies, blocking, source retirement/purge, exact retry and message deletion. Browser tests exercise animated artwork in channels/DMs, discovery/save from a received sticker, unique-name lookup, explicit loading/hiding, request counts, reload/retry and English/Russian desktop/mobile layouts. These checks verify request behavior; comparative bandwidth/resource studies require a separately controlled workload.
