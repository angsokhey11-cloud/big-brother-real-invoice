# BIG BROTHER — Real Invoice

Private original paper-invoice attachments for the invoice generator and pending accounts receivable.

Documents belong in the private Supabase Storage bucket, never in GitHub. Invoices are identified by internal `invoice_id`, not the duplicate-prone display invoice number.

## Invoice Scanner V3 — Original First and Collapsible Enhancement (2026-10-21)

Staff feedback: the earlier code-based Auto Enhance was not nearly as effective as
AI image editing, and automatic processing after importing photos was unwanted.

### Intended behavior

- **Original first, always**: after **camera capture, select photo, paste, crop
  confirmation, or restore**, display the current selected original image
  immediately. **Do not start enhancement** or spend CPU on image processing.
- **Enhancement tools collapsed by default**: the **Photo Enhancement Tools**
  disclosure stays closed after each image selection. Opening the disclosure
  alone does not run processing.
- **Manual modes only**: Original, Enhanced Color, Black & White, or the new
  **Document Clean** high-contrast document-paper mode. Clicking an enhancement
  button is the first event that can request processing.
- **Uploaded History**: authorized private invoice pictures also start in
  **Original** with their enhancement disclosure closed. Opening it alone
  does not fetch an additional image or run Canvas; selecting a processing
  mode does so locally, after the usual short-lived signed URL was issued.
- **Natural / Clear / Strong**: three adjustable strengths remain available
  inside the open disclosure. Clear is the default slider setting, **not** an
  instruction to automatically enhance a newly imported image.
- **Optional enhanced download**: save a viewing copy manually to the device;
  there is no additional Supabase image or attachment.
- **Document Clean — natural tone refinement**: previously forced paper
  to pure white and converted colored writing into grayscale. The revised
  mode applies **bounded local shadow correction** and moderate handwriting
  contrast, while retaining the captured paper's warm color, blue/red pen and
  stamp hues, and more of the fine background texture. Natural / Clear /
  Strong remain selectable; even Strong is capped to avoid bleaching paper.
  It is **not AI** and cannot restore missing photographic detail. Very pale
  marks or security patterns can still be affected. Always compare Original
  when confirming invoice numbers, amounts, and signatures.

### Natural-paper refinement (after live invoice preview feedback)

An actual handwritten-invoice test showed that the old Document Clean Strong
result was *too white* and made some pen strokes look faint. This update tunes
only the local `scan` pixel algorithm; it does **not** change the other Color
and B&W modes, the Original-first/default-collapsed interaction, or storage.

- Target a natural warm paper tone instead of setting every pixel to `255`.
- Keep the red/blue ink color-channel differences instead of forcing gray.
- Brighten dark paper gradually while maintaining real ink-to-paper edges.
- Use a conservative, capped lift at all three strength settings.
- Preserve the exact original file as the official audit evidence.

Tests use synthetic warm paper, shadow gradients, colored handwriting, a faint
pencil stroke, and grayscale pages. Real-world results depend on camera
sharpness and lighting; inspect Original before trusting any processed view.

### Accounting and technical protections

- **Audit evidence**: the normal upload still sends exactly `body:chosen`,
  the original **selected** Blob, to private Supabase Storage. Processing
  variants remain in temporary browser memory. If the user deliberately
  performs an existing manual crop/rotation, that explicitly edited selection
  is still used as before; this feature does not change crop policy.
- **Invoice number**: the existing staff-entered, securely verified printed
  invoice-number confirmation is untouched. No generative OCR, no fabricated
  digits, no payment, stock, A/R or invoice database changes.
- **PDF uploads and history**: existing behavior preserved, no enhancement panel.
- **Performance**: 2400-pixel preview cap; one active enhancement job per
  modal; rapid slider changes queue the latest selected mode/strength. When
  switching images or closing viewers, temporary Blob URLs are revoked.
- **Costs**: no paid AI API or external enhancement service. Browser-only
  JavaScript Canvas processing, no additional per-image service charge.
- **Failure**: if processing is unsupported or fails, the user can still
  inspect and upload the original without losing any data.

### Deployment

Cloud source repository: `angsokhey11-cloud/big-brother-real-invoice`.

Windows Local Brain requires the existing **Control Center V3.4 → Code Sync**
to update `index.html` and `invoice-photo-enhancer-v1.js`. **No Code SQL
Migration** and no Cloud-to-Local business-data synchronization needed.

Repeatable synthetic-only browser tests: [tests/invoice-enhancer.test.html](tests/invoice-enhancer.test.html).

### Practical acceptance test

1. Pending Scan: select or capture a photo. **Original** displays; tool panel
   is **collapsed**; no enhancement starts.
2. Expand **Photo Enhancement Tools**. The original remains unchanged.
   Select **Document Clean**, then compare with **Original**, **Enhanced
   Color**, and **B&W**. Change Natural/Clear/Strong.
3. Confirm the printed number and upload. Verify the private archived photo
   still equals the original selected photo, not any processed variant.
4. Uploaded History: opening a photo displays Original with tools collapsed.
   Only manually clicking a mode triggers enhancement; PDF has no such panel.
5. Verify on tablet and desktop, including camera, clipboard, manual crop,
   restore, signed-image viewing and closing the modal mid-processing.

Automated code tests do not replace signed-in live browser and Local Brain
device acceptance testing.
