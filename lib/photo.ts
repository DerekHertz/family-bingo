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

import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
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
   */
  readonly previewUri: string;
}

/**
 * Four answers, and three of them are not failures.
 *
 * §0.3 — nothing scolds. Cancelling the picker is a Member changing their mind and says
 * nothing at all; declining the permission is an answer, and gets one plain sentence
 * pointing at Settings. Only `unavailable` is a genuine "that didn't work".
 */
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
 * Pick one photo, downscale it, and hand back the bytes.
 *
 * The order matters and is not the obvious one: **the manipulator runs before anything
 * touches the network**, so a 12-megapixel photograph never exists as an upload body at
 * full size. §16.4 says "downscale to max 2048px long edge **before upload**" and it means
 * before the request is built, not before it is sent.
 */
export const pickPhoto = async (): Promise<PickOutcome> => {
  if (!(await permitted())) return { kind: 'denied' };

  const picked = await ImagePicker.launchImageLibraryAsync({
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

  if (picked.canceled) return { kind: 'cancelled' };
  const asset = picked.assets[0];
  if (asset === undefined) return { kind: 'cancelled' };

  let saved: { uri: string; width: number; height: number } | null = null;
  try {
    // **The rendered image's own dimensions, not the picker's.** `ImagePickerAsset`
    // documents `width` as "can be `0` if the system did not provide the width", and
    // `resizeToFit` answers `null` to a zero rather than resizing to a fraction of
    // nothing — so trusting the asset would quietly skip §16.4's bound for exactly the
    // photographs whose metadata the system could not read. Rendering first costs one
    // decode, which `saveAsync` was going to do anyway, and the resize below then works
    // on the already-decoded native image rather than re-reading the file.
    const decoded = await ImageManipulator.manipulate(asset.uri).renderAsync();
    const resize = resizeToFit(decoded.width, decoded.height);

    const rendered =
      resize === null
        ? decoded
        : await ImageManipulator.manipulate(decoded).resize(resize).renderAsync();

    // Always re-encoded, even when nothing was resized: this is the step that drops EXIF.
    saved = await rendered.saveAsync({
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
