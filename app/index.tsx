/**
 * The landing page — what a stranger sees, and the only screen written for a desktop.
 *
 * The app is deployed at a public address so it can be linked from a CV, and sign-up is
 * invite-only (`20260801000037`): a stranger who tries to make an Account is refused, by
 * design. So `/` has to do the whole job of explaining the product to somebody who cannot
 * use it, and hand them the one door that is open — the demo.
 *
 * ## It is a page, not a screen
 *
 * Everything else in this app renders inside `<PhoneShell>`, a 402pt column, because §3's
 * geometry is derived against that width and a 5×5 board on a 1440px window is a dinner
 * plate. This route opts out (`FULL_WIDTH_ROUTES` in `app/_layout.tsx`) because it is read
 * once, on whatever the reader is holding, and 402pt of a wide window is a pamphlet slid
 * under a door.
 *
 * That licence is about **width and nothing else**. Every colour, size, radius and rule is
 * §1's, unchanged: no new hex, no new type token, Shippori for display and never on a
 * control (§1.1), and the accent colours appear only where they already mean something —
 * on the growth ladder, which is the one thing on this page allowed to be green.
 *
 * ## Why the real Board is here
 *
 * The hero renders `<Board>` — the actual component, at the actual 402pt, with real counts
 * — rather than a picture of one. Three reasons, in order of how much they matter: it is
 * the product and §0.1 says so; a screenshot goes stale the first time a token changes and
 * nobody notices; and it means the page still shows the thing it is about on a visit where
 * the demo is down and the walkthrough has not been recorded.
 *
 * ## Where signed-in Members go
 *
 * Not away. `/` used to be the sign-in screen and used to redirect to `/home`, and that
 * redirect moved to `/signin` with the screen — because the rule it encoded was "never show
 * a sign-in form to somebody already signed in", which is a fact about that screen and not
 * about this address. This one is a public URL that gets pasted places, and bouncing the
 * owner off it whenever they happen to have a session would make it unlinkable by the one
 * person most likely to link it. The page changes its first button to "Open my board"
 * instead, which is the same destination and is somebody's decision rather than a
 * redirect's.
 */

import { Redirect, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Linking, Platform, ScrollView, Text, View } from 'react-native';
import type { TextStyle, ViewStyle } from 'react-native';
import { Board, type BoardTile } from '../components/Board';
import { Button } from '../components/Button';
import { COLUMN, FRAME_FROM } from '../components/PhoneShell';
import { useSession } from '../lib/session';
import { styles } from '../theme/fonts';
import { color, radius, size, space, stroke } from '../theme/tokens';

/** Where the source is. The page exists to be read by somebody who will then read this. */
const REPOSITORY = 'https://github.com/DerekHertz/family-bingo';

/**
 * The screen recording, and the poster behind it.
 *
 * Self-hosted, and that is a CSP decision rather than a taste one: `public/_headers` sets
 * `script-src 'self'` with no third-party host anywhere in it, so a YouTube or Vimeo embed
 * would be an `<iframe>` loading a script the policy refuses. Widening the policy to admit a
 * player is the opposite trade from the one that file makes, and it is not close: the whole
 * argument for keeping the session token in `sessionStorage` (`lib/supabase.ts`) rests on
 * this origin having no third-party script on it.
 *
 * **Neither file is in the repository yet**, and the page has to be fine with that — see
 * `<Walkthrough>`.
 */
const VIDEO = '/demo.mp4';
const POSTER = '/demo-poster.png';

/**
 * The page's own measure, and the widest it ever gets.
 *
 * Wider than a phone and much narrower than a monitor: prose past about 75 characters is
 * measurably harder to read, and this page is mostly prose. `FRAME_FROM` is borrowed from
 * `<PhoneShell>` on purpose rather than re-picked — it is already the width at which this
 * product decides there is room for two things side by side, and having two different
 * answers to that question on one page is how a layout starts drifting.
 */
const MEASURE = 1080;

/**
 * A Board worth looking at, laid out to show the whole of §2's ladder at once.
 *
 * Row 0 completes end to end, so the pip strip below the grid has a segment lit and the
 * page shows what a Line looks like. Everything else is spread across the five stages —
 * `dormant`, `seeded`, `sprouting`, `budding`, `complete` — because a grid of empty squares
 * and a grid of full ones both fail to say what the product does.
 *
 * These are the same shapes the demo Family is seeded with (`scripts/seed-demo-family.mjs`)
 * but they are not the same rows and are not meant to be: this is a picture, and it must
 * render identically whether or not any database is reachable.
 */
const SHOWCASE: BoardTile[] = ([
  ['Swim a mile', 4, 4],
  ['Ten knots', 10, 10],
  ['Cook something new', 6, 6],
  ['Ring Gran', 12, 12],
  ['Fix the shed door', 1, 1],
  ['Read ten books', 10, 10],
  ['Run thirty times', 30, 9],
  ['Practise the piano', 100, 90],
  ['Plant the border', 5, 5],
  ['Write a short story', 12, 0],
  ['Walk the dog', 200, 200],
  ['Learn to solder', 25, 3],
  ['Sunday dinner, all of us', 1, 1],
  ['Clear the loft', 25, 22],
  ['Ride to the coast', 1, 0],
  ['Swim every week', 40, 40],
  ['Sourdough starter', 12, 0],
  ['Twelve parks', 12, 1],
  ['Draw something', 12, 6],
  ['Five hundred words', 500, 430],
  ['Yoga twelve times', 12, 12],
  ['Every peak on the map', 12, 11],
  ['Build the bookshelf', 3, 1],
  ['Sixty cold swims', 60, 25],
  ['Cycle to work', 100, 0],
] as [string, number, number][]).map(([text, target, count], position) => ({
  id: `showcase-${position}`,
  position,
  goal: { text, target, unit: null },
  count,
}));

/** Row 0 and column 0 are both complete above, and §13.1's constant order puts them here. */
const SHOWCASE_LINES = [0, 5];

export default function Landing() {
  const session = useSession();
  const router = useRouter();

  /**
   * Native never sees this page.
   *
   * §0's platform is "Expo (iOS + Android)", and a marketing page inside an installed app is
   * a screen asking somebody who already downloaded it whether they would like to. A
   * redirect rather than a second layout: `/signin` is where `/` went before, and on a
   * handset that is still exactly where it should go.
   */
  if (Platform.OS !== 'web') return <Redirect href="/signin" />;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: color.paper }}
      contentContainerStyle={{ alignItems: 'center', paddingBottom: space.xxl * 2 }}
    >
      <Hero
        signedIn={session != null}
        onDemo={() => router.push('/demo')}
        onSignIn={() => router.push(session != null ? '/home' : '/signin')}
      />
      <Walkthrough />
      <TheYear />
      <TheFamily />
      <UnderIt />
      <Footer onDemo={() => router.push('/demo')} />
    </ScrollView>
  );
}

/**
 * One section's width and rhythm, so no section invents its own.
 *
 * `space.xxl` between sections and `space.xl` inside them is the spacing this design already
 * uses to say "different thing" versus "same thing"; nothing here is a new number.
 *
 * **Every section is the same box, and only the text inside it is narrowed.** The obvious
 * version — a narrow `maxWidth` on the prose sections and a wide one on the grids — centres
 * two different widths inside the same page, so the left edge of a paragraph sits a hundred
 *-odd pixels inside the left edge of the cards above it. One outer measure, one inner cap.
 */
function Section({
  children,
  style,
  wide = false,
}: {
  children: ReactNode;
  style?: ViewStyle;
  /** Prose is capped at a readable measure; the two grids get the whole width. */
  wide?: boolean;
}) {
  return (
    <View
      style={{
        width: '100%',
        maxWidth: MEASURE,
        paddingHorizontal: space.xl,
        marginTop: space.xxl,
        ...style,
      }}
    >
      {/* Around 75 characters at `body`'s 16pt, which is where a line stops being
          comfortable to come back to. */}
      <View style={{ width: '100%', maxWidth: wide ? undefined : 720 }}>{children}</View>
    </View>
  );
}

/** A section head. Shippori, and therefore never anywhere a finger lands (§1.1). */
function Head({ children }: { children: ReactNode }) {
  return (
    <Text accessibilityRole="header" style={{ ...styles.title, color: color.ink }}>
      {children}
    </Text>
  );
}

function Body({ children, style }: { children: ReactNode; style?: TextStyle }) {
  return (
    <Text style={{ ...styles.body, color: color.ink2, marginTop: space.md, ...style }}>
      {children}
    </Text>
  );
}

function Hero({
  signedIn,
  onDemo,
  onSignIn,
}: {
  signedIn: boolean;
  onDemo: () => void;
  onSignIn: () => void;
}) {
  // Two columns when there is room for the phone column beside the prose, one when there is
  // not. The board never shrinks — §3 forbids it — so below the breakpoint it simply goes
  // underneath, at the same 402pt it has everywhere else in the product.
  const [width, setWidth] = useState(0);
  const side = width >= FRAME_FROM;

  return (
    <View
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      style={{
        width: '100%',
        maxWidth: MEASURE,
        paddingHorizontal: space.xl,
        paddingTop: space.xxl,
        flexDirection: side ? 'row' : 'column',
        alignItems: side ? 'center' : 'stretch',
        gap: space.xxl,
      }}
    >
      <View style={{ flex: side ? 1 : undefined, maxWidth: 560 }}>
        <Text style={{ ...styles.meta, color: color.ink2 }}>An annual goal-setting game</Text>
        <Text
          accessibilityRole="header"
          style={{ ...styles.display, ...size.wordmark, color: color.ink, marginTop: space.md }}
        >
          Family Bingo
        </Text>

        {/* CONTEXT.md's own sentence, because it is the one that has survived every rewrite
            of everything else. */}
        <Text style={{ ...styles.heading, color: color.ink, marginTop: space.lg }}>
          Each person fills a 5×5 board with personal goals for the year and works to
          complete them — while their family watches, cheers, and gets notified as squares
          fall.
        </Text>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: size.stack, marginTop: space.xl }}>
          {/* `filled` is `ink`, not `moss`, and `<Button>`'s own header says why: moss is
              growth's colour and nothing has grown yet. The same reasoning that keeps it off
              the sign-in screen keeps it off this one.

              `router.push` rather than `<Link asChild>`: `<Button>` does not forward an
              `href` to its `Pressable`, so the cloned link would fall back to its `onPress`
              anyway — and a wrapper that looks like it produces an anchor and does not is
              worse than the call it is hiding. */}
          <Button
            label="See a demo"
            variant="filled"
            onPress={onDemo}
            accessibilityHint="Opens a family's finished year, which you can read but not change"
            style={{ minWidth: 180 }}
          />
          {/* The one thing this page changes for somebody who is already signed in. A Member
              who lands here has a board, and the button should take them to it rather than
              offering to sign them in again. */}
          <Button
            label={signedIn ? 'Open my board' : 'Sign in'}
            variant="outlined"
            onPress={onSignIn}
            style={{ minWidth: 180 }}
          />
        </View>

        {/* Said in the first screenful rather than in a footer nobody reaches. Somebody who
            cannot sign up should find that out before they try, not after. */}
        <Text style={{ ...styles.label, color: color.ink2, marginTop: space.lg }}>
          Sign-up is invite-only · this is the web build · it is not on any app store
        </Text>
      </View>

      {/* `maxWidth` and not a fixed `width`: 402 is §3's reference viewport, and below it
          the browser window *is* a phone — the same point at which `<PhoneShell>` stops
          drawing a frame and lets the app have the screen. */}
      <View style={{ width: '100%', maxWidth: COLUMN, alignSelf: 'center' }}>
        <Board tiles={SHOWCASE} centreMode="shared" completedLines={SHOWCASE_LINES} />
        <Text
          style={{
            ...styles.label,
            color: color.ink2,
            marginTop: space.md,
            paddingHorizontal: space.lg,
          }}
        >
          Twenty-five goals you wrote yourself. A square grows as you log, and flowers when
          it is done.
        </Text>
      </View>
    </View>
  );
}

/**
 * The screen recording, when there is one.
 *
 * **`public/demo.mp4` is not in the repository**, and until somebody records it every
 * request for it comes back as the SPA fallback — `public/_redirects` rewrites every
 * unmatched path to `index.html` with a **200**, so the file does not 404, it answers with a
 * page. Handing that to a `<video>` produces a decode failure in the console and, on some
 * browsers, a black frame with a broken control strip: the exact "looks like nobody tried"
 * outcome this page cannot afford.
 *
 * So the file is asked about first, with a HEAD, and the answer that matters is the
 * **content type** rather than the status — the status is 200 either way. If it is not a
 * video, this section renders nothing at all. Not a placeholder, not an apology, not a grey
 * rectangle saying a video is coming: the page is written to stand up without it, and an
 * empty frame promising something is worse than a page that never mentioned it.
 *
 * The HEAD is same-origin, which `connect-src 'self'` permits.
 */
function Walkthrough() {
  const [present, setPresent] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(VIDEO, { method: 'HEAD' })
      .then((response) => {
        const type = response.headers.get('content-type') ?? '';
        if (!cancelled) setPresent(response.ok && type.toLowerCase().startsWith('video/'));
      })
      // A failed probe is an absent video. There is no third state worth rendering.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (!present) return null;

  return (
    <Section wide>
      <Head>A minute of it</Head>
      <View
        style={{
          marginTop: space.lg,
          borderRadius: radius.card,
          borderWidth: stroke.hairline,
          borderColor: color.hairline,
          backgroundColor: color.paperSunk,
          overflow: 'hidden',
        }}
      >
        {/* A DOM element inside a React Native tree, which works because the renderer on web
            *is* react-dom — react-native-web is a set of components, not a second renderer.
            There is no `<Video>` in this product and there should not be one: this is the
            only moving picture in it.

            `muted` and `playsInline` so a browser will let it start at all if anyone ever
            autoplays it; `controls` because nothing on this page should move without being
            asked; `preload="metadata"` so a visitor who never presses play downloads a few
            kilobytes rather than the whole file. */}
        <video
          src={VIDEO}
          poster={POSTER}
          controls
          muted
          playsInline
          loop
          preload="metadata"
          style={{ width: '100%', display: 'block' }}
        />
      </View>
    </Section>
  );
}

function TheYear() {
  return (
    <Section>
      <Head>One year, and it starts once</Head>
      <Body>
        Everyone writes twenty-four goals in December. The board seals on 1 January and the
        positions are dealt then, so nobody can put the easy one in a corner. After the
        seal, changing a goal costs one of three Swaps for the whole year — and the family
        sees every one.
      </Body>
      <Body>
        Progress is only ever counted from the log. There is no cached number to drift, no
        way to backdate, and nothing to reset. At the end of December the year freezes and
        becomes family history: the boards stay, and nothing on them can change again.
      </Body>
    </Section>
  );
}

function TheFamily() {
  return (
    <Section>
      <Head>What makes it not a habit tracker</Head>
      <Body>
        The family is a real participant. It votes on what the middle square is, sees every
        increment in a shared feed, gets notified when a tile falls, and sees every swap.
        The social layer is the product.
      </Body>
      <Body>
        There is no streak, no leaderboard, no daily reminder and no way to be behind.
        Boards are self-authored, so ranking them would only measure who set the easiest
        goals — which is also why the end-of-year awards sit on unrelated axes and everyone
        gets at least one.
      </Body>
      <Body>
        Children take part without an account of their own: a parent plays on their behalf,
        and the feed still names the child. Their name and face never leave the family.
      </Body>
    </Section>
  );
}

/**
 * The part written for an engineer.
 *
 * Four claims, each one checkable in the repository within about a minute, which is the
 * bar: a landing page saying "well tested" is noise, and a landing page saying "every RLS
 * policy has a negative test asserting zero rows" is an invitation to go and look.
 */
function UnderIt() {
  const cards = [
    {
      head: 'The database is the boundary',
      body:
        'Nothing crosses a family boundary. Every table carries a family id and an RLS policy keyed to the caller’s own membership, so the database refuses rather than the app remembering to ask. The service role is the one identity the boundary does not exist for, and what it may touch is enumerated by hand.',
    },
    {
      head: '900 pgTAP assertions',
      body:
        'Every policy has a negative test asserting that a different family’s account gets zero rows rather than an error. Thirty files, run against a real Postgres in CI whenever the schema or a query moves.',
    },
    {
      head: 'A domain layer with no I/O',
      body:
        'The growth ladder, the twelve lines, the swap budget and the awards are pure functions shared by the server, the client and a test suite that runs in milliseconds. A test enforces that the layer imports nothing but itself.',
    },
    {
      head: 'A design system with reasons in it',
      body:
        'One palette, one type scale, and an argument beside every token. There is no red in the product, including for errors — a destructive confirmation is dark clay text inside a hairline border, and nothing scolds anybody.',
    },
  ];

  return (
    <Section wide>
      <Head>What is under it</Head>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.lg, marginTop: space.lg }}>
        {cards.map((card) => (
          <View
            key={card.head}
            style={{
              // Two across on a wide window, one on a narrow one, with no media query and no
              // percentage: a floor on the width is what makes the row wrap on its own.
              // No `maxWidth` — a cap here leaves a single-column card short of the right
              // edge everything above it reaches, which reads as a mistake rather than as a
              // measure.
              flexGrow: 1,
              flexBasis: 380,
              padding: space.lg,
              borderRadius: radius.card,
              borderWidth: stroke.hairline,
              borderColor: color.hairline,
              backgroundColor: color.paperRaised,
            }}
          >
            <Text style={{ ...styles.cardHead, color: color.ink }}>{card.head}</Text>
            <Text style={{ ...styles.body, color: color.ink2, marginTop: space.sm }}>
              {card.body}
            </Text>
          </View>
        ))}
      </View>
    </Section>
  );
}

function Footer({ onDemo }: { onDemo: () => void }) {
  return (
    <Section>
      <Head>Where it actually is</Head>
      <Body>
        Every slice of the product is built and the whole thing runs, but sign-up is
        invite-only: a stranger who tries to make an account is turned away on purpose. The
        demo is the way in, and it is a family’s finished year — you can read all of it and
        change none of it, because a frozen year is read-only at the database and not in the
        interface.
      </Body>
      <Body>
        This is the web build. There is no App Store listing and no TestFlight; Apple sign-in
        needs a paid developer programme, so Google is the only door here.
      </Body>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: size.stack, marginTop: space.xl }}>
        <Button
          label="Read the code on GitHub"
          variant="outlined"
          onPress={() => void Linking.openURL(REPOSITORY)}
          accessibilityHint="Opens GitHub in a new tab"
          style={{ minWidth: 220 }}
        />
        <Button label="See a demo" variant="filled" onPress={onDemo} style={{ minWidth: 180 }} />
      </View>

      <Text style={{ ...styles.meta, color: color.ink3, marginTop: space.xxl }}>
        Expo · Supabase · TypeScript
      </Text>
    </Section>
  );
}
