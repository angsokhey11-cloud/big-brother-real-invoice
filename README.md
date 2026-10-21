# BIG BROTHER — Real Invoice

Private original paper-invoice attachments for the invoice generator and pending accounts receivable.

Documents belong in the private Supabase Storage bucket, never in GitHub. Invoices are identified by internal `invoice_id`, not the duplicate-prone display invoice number.

## Invoice Scanner V2 — Auto Enhance (2026-10-21)

- **No AI API and no extra cost per image**: all color/B&W enhancement runs inside the staff browser using standard Canvas and JavaScript; no CDN or third-party editor dependency.
- **Auto-preview on all photo paths**: live camera, selected JPG/PNG/WebP, pasted screenshots, and existing manually cropped photos. Staff can switch Original / Enhanced / Black & White, and download the generated temporary copy if needed.
- **Uploaded History**: signed authorized invoice photo displays enhanced by default, with a one-click Original or B&W viewer. One temporary private read is reused for both computed viewing modes.
- **Audit protection**: the existing registration and replacement RPCs are unchanged, and the scanner still uploads the original **selected** Blob as-is. Enhancements are computed from that selected Blob, not saved to the private invoice bucket; no secondary image, DB row or retention exception is created. Manual crop/rotate remains an explicit user edit of the selected source before upload, as previously.
- **Invoice number security**: manual printed-number confirmation remains unchanged; this release does not add generative OCR or infer any text. No AI attempts to reconstruct unreadable details.
- **PDF**: existing upload and viewer are unchanged; only image MIME types receive enhancement controls.
- **Mobile**: process a capped 2400-pixel preview to limit memory and CPU; source photo resolution in private storage remains untouched.
- **Failure**: if decoding/enhancement or signed-url reading fails, the original remains available, with a visible error; enhancement never blocks the Complete/Replace operation.
- **Local Brain**: no SQL migrations or table changes. Sync the Scanner repository code (including the new `invoice-photo-enhancer-v1.js`) using the existing Control Center V3.4 Code Sync. Windows deployment/device testing must be checked by the operator; Cloud-to-Local business data sync is unnecessary.

Repeatable synthetic-only browser tests: [tests/invoice-enhancer.test.html](tests/invoice-enhancer.test.html).

### Practical acceptance test

1. In Pending Scan, choose a handwritten invoice photo. Wait for Enhanced preview; check Original / Enhanced / B&W.
2. Confirm the printed number; check that the original photo, not enhanced copy, remains the private archive.
3. In Uploaded History, open the invoice; Enhanced appears by default and Original still matches the source.
4. On phone/tablet repeat camera capture, clipboard paste, Crop / Restore, and PDF upload. No changes should appear in unrelated invoices, payments or stock.
