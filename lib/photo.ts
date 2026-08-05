/**
 * Choosing a photo and getting it down to size (PRD §16.4, FRONTEND_DESIGN §3).
 *
 * Everything on the device side of an Attachment: the permission, the picker, the
 * downscale, and reading the bytes. Nothing here talks to Supabase — that is
 * `lib/queries/attachments.ts` — and nothing here decides anything, which is
 * `src/domain/attachment.ts`. This file is only the three native modules and the order
 * they go in.
 *
 * **The library, and not the camera.** §3 asks for one 46pt secondary labelled "Add a
 * photo", not a choice of two; offering a camera as well means a second permission, a
 * second refusal to phrase, and an action sheet the design does not have. Someone who
 * wants a picture of the herons takes it with the camera app and picks it here, which is
 * what people do anyway.
 *
 * **Nothing lands outside the app's private container** (§7.6). The picker hands back a
 * URI inside the app's own cache, the manipulator writes its result there too, and this
 * module deletes that result the moment the bytes have been read. No `MediaLibrary`, no
 * Downloads folder, no shared storage — a photograph of a child does not get written
 * anywhere another app could read it, not even for a second.
 */

import { ImageManipulator, SaveFormat, type ImageRef } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { Platform } from 'react-native';
import {
  PHOTO_CONTENT_TYPE,
  PHOTO_QUALITY,
  resizeToFit,
} from '../src/domain/attachment';

/** A photo, downscaled and re-encoded, ready to be uploaded and then forgotten. */
export interface PickedPhoto {
  /** The re-encoded file, already deleted from disk by the time this is returned. */
  readonly body: ArrayBuffer;
  readonly contentType: string;
  /** Post-downscale, and what goes in the `attachments` row's `width` / `height`. */
  readonly width: number;
  readonly height: number;
  readonly bytes: number;
  /**
   * The **original** picked URI, kept only so the sheet can show a thumbnail of what is
   * about to be attached. Never uploaded — the re-encoded `body` is what goes up.
   *
   * It is a full-resolution copy with its EXIF intact, sitting in the app's cache because
   * the picker put it there, and it is alive for exactly as long as this object is. Hand it
   * to `discardPhoto` the moment the thumbnail is no longer on screen.
   */
  readonly previewUri: string;
}

/**
 * Delete the picker's own copy, which is the one file this module does not write and does
 * have to clean up.
 *
 * The module docblock says this app "deletes that result the moment the bytes have been
 * read", and the `finally` in `pickPhoto` does exactly that — for the re-encoded file. It
 * never touched the picker's original, which is worse in every dimension: full resolution
 * rather than 2048px, EXIF intact rather than stripped (the capture time, the device, very
 * often the GPS coordinates of the house a child was photographed in), and kept alive by
 * `previewUri` for the whole life of the sheet and then forgotten.
 *
 * It is inside the app's private container, so this is not a §7.6 breach — that rule is
 * about a photo cached *outside* it — but it is the same instinct as §16.6 and ADR-0005
 * applied to a copy this app caused to exist. It cannot be deleted inside `pickPhoto`,
 * because the thumbnail is still rendering from it; the sheet owns the moment instead.
 *
 * Best effort and never throws: a cache file that outlives us is not worth failing a tap.
 */
export const discardPhoto = (photo: PickedPhoto): void => {
  try {
    new FileSystem.File(photo.previewUri).delete();
  } catch {
    // Already gone, or a URI with no file behind it (web hands back a blob).
  }
};

/**
 * Four answers, and three of them are not failures.
 *
 * §0.3 — nothing scolds. Cancelling the picker is a Member changing their mind and says
 * nothing at all; declining the permission is an answer, and gets one plain sentence
 * pointing at Settings. Only `unavailable` is a genuine "that didn't work".
 */
/**
 * How many times `pickPhoto` will measure and re-bound before accepting what it has.
 *
 * Two, and the second exists because iOS reports a portrait photograph's dimensions
 * sideways — see the loop for the whole story. It converges there, because anything the
 * manipulator renders is upright by construction; the bound is a ceiling on the work rather
 * than a guess at how many passes it takes.
 */
const RESIZE_PASSES = 2;

export type PickOutcome =
  | { kind: 'photo'; photo: PickedPhoto }
  | { kind: 'cancelled' }
  | { kind: 'denied' }
  | { kind: 'unavailable' };

/**
 * Ask for the photo library **only where the picker actually needs it**, and then only at
 * the moment it is needed.
 *
 * **Not on iOS, and asking there was a real cost rather than a harmless extra tap.**
 * `launchImageLibraryAsync`'s own docstring in the installed package says the permission is
 * *"Required on iOS 10 only"*: every modern iOS uses `PHPickerViewController`, which runs
 * out of process, hands back the one asset the Member chose, and needs no grant at all. So
 * the branch this replaces prompted for **full camera-roll access** — a much larger thing
 * than the app was doing — and then hard-gated the picker on the answer, which made a
 * refusal permanent: iOS answers every later `request` from cache without showing
 * anything, so a Member who declined could never add a photo again on a path that would
 * have worked without ever asking.
 *
 * Where it is still asked, it is asked at the moment the Member taps "Add a photo" and
 * never before. A permission prompt with no visible cause is the one most likely to be
 * refused, and the app gets exactly one ask.
 */
const permitted = async (): Promise<boolean> => {
  if (Platform.OS === 'ios') return true;
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  return permission.granted;
};

/**
 * Android only: ask for a result the picker finished producing while the app was not there
 * to receive it.
 *
 * `expo-image-picker` documents this and the branch shipped without it: *"Android system
 * sometimes kills the `MainActivity` after the `ImagePicker` finishes. When this happens,
 * we lose the data selected using the `ImagePicker`. However, you can retrieve the lost
 * data by calling `getPendingResultAsync`."* It is reproducible on demand with **Don't
 * keep activities** in developer options, which is to say it happens for real on a phone
 * under memory pressure — the exact phone that is also least able to hold a 190 MB bitmap.
 *
 * Without it, the recreated activity answers the relaunched pick with a plain `canceled`
 * and the Member is told nothing at all, having just chosen a photo. This asks before
 * believing the cancellation.
 *
 * **What it cannot recover** is a full process death, where the sheet's own state — which
 * Tile, which note — went with it, so there is nothing left to attach a photo *to*. That
 * case degrades to no photo, which §11.1 makes survivable and this function does not
 * pretend to fix.
 */
const pendingIfCancelled = async (
  picked: ImagePicker.ImagePickerResult,
): Promise<ImagePicker.ImagePickerResult> => {
  if (Platform.OS !== 'android' || !picked.canceled) return picked;
  try {
    // `null` on every other platform, and an `ImagePickerErrorResult` — which has no
    // `canceled` at all — when the picker itself failed. Both read as "nothing recovered".
    const pending = await ImagePicker.getPendingResultAsync();
    if (pending !== null && 'canceled' in pending && !pending.canceled) return pending;
  } catch {
    // A best-effort second ask. Whatever went wrong here, the answer is still the
    // cancellation we already have.
  }
  return picked;
};

/**
 * Pick one photo, downscale it, and hand back the bytes.
 *
 * The order matters and is not the obvious one: **the manipulator runs before anything
 * touches the network**, so a 12-megapixel photograph never exists as an upload body at
 * full size. §16.4 says "downscale to max 2048px long edge **before upload**" and it means
 * before the request is built, not before it is sent.
 */
export const pickPhoto = async (): Promise<PickOutcome> => {
  if (!(await permitted())) return { kind: 'denied' };

  const launched = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: false,
    // §16.1 — one Attachment per Increment, so there is nothing to crop *for*. Editing
    // also forces a square on iOS, which would quietly trim a photograph of a family.
    allowsEditing: false,
    // The capture timestamp, the device, and very often the GPS coordinates of the house
    // a child was photographed in. Not asked for here, and stripped again by the
    // re-encode below — see PHOTO_EXTENSION in src/domain/attachment.ts.
    exif: false,
    // Full quality out of the picker; the compression happens once, in the manipulator,
    // at a size we chose. Compressing twice only loses detail to no smaller a file.
    quality: 1,
  });

  // A cancellation on Android may be the activity having been killed rather than the
  // Member having changed their mind — see `pendingIfCancelled`.
  const picked = await pendingIfCancelled(launched);

  if (picked.canceled) return { kind: 'cancelled' };
  const asset = picked.assets[0];
  if (asset === undefined) return { kind: 'cancelled' };

  let saved: { uri: string; width: number; height: number } | null = null;
  // Every native bitmap this function has caused to exist, so the `finally` can hand them
  // all back — see the note there.
  const bitmaps = new Set<ImageRef>();
  try {
    // **The rendered image's own dimensions, not the picker's.** `ImagePickerAsset`
    // documents `width` as "can be `0` if the system did not provide the width", and
    // `resizeToFit` answers `null` to a zero rather than resizing to a fraction of
    // nothing — so trusting the asset would quietly skip §16.4's bound for exactly the
    // photographs whose metadata the system could not read. Rendering first costs one
    // decode, which `saveAsync` was going to do anyway, and the resize below then works
    // on the already-decoded native image rather than re-reading the file.
    let image = await ImageManipulator.manipulate(asset.uri).renderAsync();
    bitmaps.add(image);

    // **Measure the result and bound it again, because one pass does not always land it.**
    //
    // §16.4's bound is on the long edge, and on iOS the number this reads and the number
    // the resize *uses* are two different things for a photograph taken in portrait.
    // `ImageRef.width`/`height` are `cgImage.width`/`height` — the raw sensor pixels, so a
    // portrait iPhone photo reads 4032×3024 with its uprightness carried in
    // `UIImage.imageOrientation` rather than in the buffer. `ImageResizeTransformer` then
    // works from `UIImage.size`, which *is* orientation-corrected (3024×4032), and draws
    // upright. So one pass constrained the wrong axis: told `{width: 2048}` for what was
    // really the short edge, it produced an upright 2048×2731 and quietly missed §16.4 by
    // a third on every portrait photo an iPhone has ever taken.
    //
    // The second pass costs nothing where it is not needed and needs no knowledge of EXIF
    // at all, which is why it is the fix rather than trying to read the orientation from
    // JS: a resized image is `.up` by construction (it came out of a renderer), so its
    // dimensions and its appearance finally agree, and `resizeToFit` gets the true long
    // edge. It converges in two — Android is already upright, because
    // `expo-image-loader` decodes through Glide, which applies EXIF orientation itself.
    for (let pass = 0; pass < RESIZE_PASSES; pass += 1) {
      const resize = resizeToFit(image.width, image.height);
      if (resize === null) break;

      const smaller = await ImageManipulator.manipulate(image).resize(resize).renderAsync();
      bitmaps.add(smaller);
      // Let the larger bitmap go the instant the smaller one exists, rather than at the end
      // of the function. This is the moment both are alive, and on a 48 MP photograph that
      // is roughly 190 MB of native heap plus its copy — the peak the `finally` alone would
      // not have moved.
      try {
        image.release();
      } catch {
        // Already gone. The `finally` would not have done better.
      }
      bitmaps.delete(image);
      image = smaller;
    }

    // Always re-encoded, even when nothing was resized: this is the step that drops EXIF.
    saved = await image.saveAsync({
      format: SaveFormat.JPEG,
      compress: PHOTO_QUALITY,
    });

    const file = new FileSystem.File(saved.uri);
    const body = await file.arrayBuffer();

    return {
      kind: 'photo',
      photo: {
        body,
        contentType: PHOTO_CONTENT_TYPE,
        width: saved.width,
        height: saved.height,
        bytes: body.byteLength,
        previewUri: asset.uri,
      },
    };
  } catch {
    // A picker can hand back a URI it cannot decode — an iCloud photo that never
    // downloaded, a HEIC the manipulator refuses, a file removed between pick and read.
    // The tap is the thing that matters and the photo is optional, always (§11.1), so
    // this is a "no photo", never an exception thrown at a screen.
    return { kind: 'unavailable' };
  } finally {
    // **Hand the decoded bitmaps back to the native heap.**
    //
    // `ImageRef extends SharedRef<'image'>`, and `SharedObject.release()`'s own docs name
    // "image bitmap" as the case manual release exists for: the JS object is a few bytes
    // and the thing it holds is not, so a garbage collector with no reason to run leaves
    // the pixels allocated. A 48 MP photograph is around 190 MB decoded, and during a
    // resize there are two of them — which is a native-heap OOM on Android, from a path
    // that cannot reproduce in Node and so cannot be caught by any suite here.
    //
    // A Set, and each larger bitmap is taken out of it as it is released at the peak
    // above, so nothing here is released twice — which throws.
    for (const bitmap of bitmaps) {
      try {
        bitmap.release();
      } catch {
        // Already released, or the native object is gone. Not worth failing a tap over.
      }
    }

    // The re-encoded copy has served its purpose the instant its bytes are in memory.
    // Leaving it in the cache directory means a photograph of a child sitting in a file
    // nothing will ever read again, until the OS decides to reclaim it — which is the
    // same instinct as §16.6 and ADR-0005, applied to the one copy this app makes itself.
    if (saved !== null) {
      try {
        new FileSystem.File(saved.uri).delete();
      } catch {
        // Best effort. A cache file that outlives us is not worth failing a tap over.
      }
    }
  }
};
