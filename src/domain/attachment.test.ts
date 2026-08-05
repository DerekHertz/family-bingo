import { describe, expect, it } from 'vitest';
import {
  MAX_EDGE,
  PHOTO_EXTENSION,
  SIGNED_URL_TTL_SECONDS,
  attachmentPath,
  familyOfPath,
  photoFailedCopy,
  photoPermissionCopy,
  photoUnavailableCopy,
  photoUnreadableCopy,
  resizeToFit,
} from './attachment';

const FAMILY = '00000000-0000-4000-8000-0000000000f1';
const INCREMENT = '00000000-0000-4000-8000-0000000000c1';

describe('the object key (§16.2, enforce_attachment_path)', () => {
  it('is {family_id}/{increment_id} with an extension', () => {
    expect(attachmentPath(FAMILY, INCREMENT)).toBe(`${FAMILY}/${INCREMENT}.${PHOTO_EXTENSION}`);
  });

  it('never carries the bucket id, which is not part of the name', () => {
    // storage.foldername(name)[1] is the Family segment. A leading "attachments/" would
    // put a word where safe_uuid() expects a uuid, and NULL is in nobody's
    // visible_family_ids() — the upload would be refused by the policy, not by the trigger.
    expect(attachmentPath(FAMILY, INCREMENT).startsWith('attachments/')).toBe(false);
    expect(attachmentPath(FAMILY, INCREMENT).split('/')).toHaveLength(2);
  });

  it('is exactly what the trigger recomputes: family, then increment, in that order', () => {
    const [family, file] = attachmentPath(FAMILY, INCREMENT).split('/');
    expect(family).toBe(FAMILY);
    expect(file?.split('.')[0]).toBe(INCREMENT);
  });

  it('reads its own Family back out', () => {
    expect(familyOfPath(attachmentPath(FAMILY, INCREMENT))).toBe(FAMILY);
  });

  it('answers null for a path with no folder, rather than guessing', () => {
    expect(familyOfPath('loose-file.jpg')).toBeNull();
    expect(familyOfPath('')).toBeNull();
    expect(familyOfPath('/leading-slash.jpg')).toBeNull();
  });
});

describe('§16.4 — 2048px on the long edge, before upload', () => {
  it('constrains the width when the image is landscape', () => {
    expect(resizeToFit(4032, 3024)).toEqual({ width: MAX_EDGE });
  });

  it('constrains the height when the image is portrait', () => {
    expect(resizeToFit(3024, 4032)).toEqual({ height: MAX_EDGE });
  });

  it('constrains one edge only, so the manipulator keeps the ratio', () => {
    const resize = resizeToFit(4032, 3024);
    expect(resize === null ? [] : Object.keys(resize)).toHaveLength(1);
  });

  it('picks the width on a square image, which is the long edge either way', () => {
    expect(resizeToFit(3000, 3000)).toEqual({ width: MAX_EDGE });
  });

  it('leaves an image already inside the bound alone', () => {
    expect(resizeToFit(1600, 1200)).toBeNull();
    expect(resizeToFit(MAX_EDGE, MAX_EDGE)).toBeNull();
  });

  it('scales a panorama on its long edge even though the short one already fits', () => {
    expect(resizeToFit(9000, 600)).toEqual({ width: MAX_EDGE });
  });

  it('leaves a dimension the system did not provide alone', () => {
    // ImagePickerAsset documents width as "can be 0 if the system did not provide it".
    expect(resizeToFit(0, 4032)).toBeNull();
    expect(resizeToFit(4032, 0)).toBeNull();
    expect(resizeToFit(-1, -1)).toBeNull();
    expect(resizeToFit(Number.NaN, 100)).toBeNull();
    expect(resizeToFit(Number.POSITIVE_INFINITY, 100)).toBeNull();
  });

  it('takes a bound, so the rule can be checked at a size a test can read', () => {
    expect(resizeToFit(100, 50, 10)).toEqual({ width: 10 });
    expect(resizeToFit(50, 100, 10)).toEqual({ height: 10 });
  });

  it('reaches the bound on a second pass when the first was handed sideways dimensions', () => {
    // The iPhone portrait case, and why `lib/photo.ts` measures the result rather than
    // trusting one pass. `ImageRef.width`/`height` are the raw `cgImage` pixels, so a
    // portrait photograph reads 4032×3024 — its uprightness is in `UIImage.imageOrientation`
    // and not in the buffer.
    expect(resizeToFit(4032, 3024)).toEqual({ width: MAX_EDGE });

    // `ImageResizeTransformer` works from the orientation-corrected `UIImage.size`, so
    // `{width: 2048}` against a 3:4 upright ratio draws an upright 2048×2731 — over the
    // bound on the edge that turned out to be the long one.
    expect(resizeToFit(2048, 2731)).toEqual({ height: MAX_EDGE });

    // Anything a renderer produced is `.up`, so the second pass is measured on dimensions
    // that finally agree with the picture, and the third has nothing left to do.
    expect(resizeToFit(1536, MAX_EDGE)).toBeNull();
  });
});

describe('§16.2 — the TTL is short, because nothing revokes a signed URL', () => {
  it('is minutes, not hours', () => {
    expect(SIGNED_URL_TTL_SECONDS).toBeGreaterThan(0);
    expect(SIGNED_URL_TTL_SECONDS).toBeLessThanOrEqual(600);
  });
});

describe('the words (§1.1 — plain, and never a colour)', () => {
  const all = [photoPermissionCopy, photoUnavailableCopy, photoFailedCopy, photoUnreadableCopy];

  it('never calls a declined permission or a lost connection an error', () => {
    for (const sentence of all) {
      expect(sentence.toLowerCase()).not.toMatch(/error|failed to|couldn't be|invalid|sorry/);
    }
  });

  it('says the tap landed before it says the photo did not', () => {
    // §11.1: the photo is optional, always. A sentence that leads with the photo reads as
    // though the whole tap was lost.
    for (const sentence of [photoUnavailableCopy, photoFailedCopy]) {
      expect(sentence.indexOf('Logged')).toBe(0);
    }
  });
});
