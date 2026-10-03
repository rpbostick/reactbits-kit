# reactbits-kit

Our customizations of [React Bits](https://reactbits.dev) components ([repository](https://github.com/DavidHDev/react-bits)), applied to upstream code that each project fetches for itself, and the modules of our own those customized components work with.

It covers ten backgrounds: **Waves** (14 changes), **Aurora** (3), **Iridescence** (4), **Threads** (2), **Balatro** (2), **LiquidChrome** (2), **Galaxy** (3), **Plasma** (2), **SoftAurora** (2) and **RippleGrid** (2). `rbx list` shows them all, with the profiles that apply each change.

## Profiles

Each project that uses the kit applies one named set of changes, its **profile**, recorded in its `reactbits-kit.json`:

- **`site`** (the default): our website's. Waves 01–10 and 13–14 (the noise moved to its own `noise.ts` with a lattice period, and a `sample` getter with `patternPeriod`), Aurora 01–03, Iridescence 01–02.
- **`sheet`**: the character sheet's. Waves 01–07 and 11–12 (its `mousemove` listener on the container, which hears the drags the page hands it as mouse events, and a `mouseleave` that ends the stroke) instead of the site's pointer, displacement and overscan getters; Aurora 01–03; Iridescence 01–04 (with a colour getter).

The other seven have one set, which both profiles apply: a `params` getter for their colour props, called once per frame, and either those props out of the effect's dependencies (so a colour change does not rebuild the WebGL context) or a device pixel ratio capped at 1.5; Galaxy also always blends when transparent, so its light mode can change without a rebuild.

## The licence boundary

React Bits is licensed "MIT + Commons Clause": its components may be used as part of an application, website or product, but not sold or redistributed on their own, in a bundle, or as a ported version. So **this repository contains no React Bits code**, not even as diff context:

- Our changes are **code transformations** (codemods). Each one says what to change in terms of the code's structure (a function named `updateMouse`, the props interface, the `requestAnimationFrame` loop) and the code it adds. It is applied to the upstream file the project downloads at a pinned commit.
- The upstream files only ever exist in the project that fetched them, next to a `CHANGES.md` that lists our changes and carries React Bits' licence text.
- `tests/licenceBoundary.test.ts` fails if any line of an upstream component file shows up in this repository.

Everything here (the transforms, the CLI and the modules) is ours and MIT-licensed; see `LICENSE`.

## Install

Node 22.18 or later. Until the package is published as `@rpbostick/reactbits-kit`, install it from GitHub at a release tag:

```sh
npm install -D github:rpbostick/reactbits-kit#v0.3.0
npx rbx list
```

The package ships compiled JavaScript and `.d.ts` files in `dist/`, so `rbx` and the imports run with plain `node` (Node does not strip TypeScript types under `node_modules`). `dist/` is not committed: npm runs the `prepare` script (`node scripts/build.js`: `tsc -p tsconfig.build.json`, then the `.css` files copied over) when it installs a git dependency or packs a tarball. `tests/package.test.ts` packs the kit, installs the tarball into a temporary project and runs `rbx list` and the imports there with type stripping off.

Import paths have no extension: `@rpbostick/reactbits-kit/modules/<name>`, `@rpbostick/reactbits-kit/react/<name>`, `@rpbostick/reactbits-kit/modules/pointerFeed.css`, and the package root for the CLI's `main`.

## `rbx`

```sh
rbx add <Component> --to <dir> [--profile <site|sheet>] [--commit <sha>] [--source <react-bits checkout>]
rbx update --to <dir> [--profile <site|sheet>] [--commit <sha>] [--source <react-bits checkout>]
rbx check --to <dir> [--source <react-bits checkout>]
rbx list
```

- **`rbx add Waves --to src/reactbits`** downloads `Waves.tsx` and `Waves.css` from React Bits' `src/ts-default/Backgrounds/Waves/` at the pinned commit (raw GitHub URLs), applies the profile's transforms, and writes them with a `CHANGES.md` to `src/reactbits/Waves/`, along with any file a transform adds (the site profile's `noise.ts`, moved out of `Waves.tsx`). The first `add` creates `src/reactbits/reactbits-kit.json`, which records the commit and the profile (`--profile`, else `site`); later ones use them, and refuse a different one. `--commit` picks another commit (a full SHA when downloading).
- **`rbx update --to src/reactbits [--profile <name>] [--commit <sha>]`** fetches every component in the manifest again (at the new commit and with the new profile, if given) and re-applies the transforms. If any change no longer applies, it names the component and the change, writes nothing and exits 1.
- **`rbx check --to src/reactbits`** rebuilds every component in memory and exits 1 if a file in the project differs from it or is missing, or if a component was built with other transforms than its profile now has. It fits in CI.
- **`rbx list`** prints the components and their transforms, each with the profiles that apply it.

`--source <dir>` reads from a local git clone of React Bits instead of GitHub; the tests use it so they need no network.

`reactbits-kit.json` looks like this, and rbx refuses any other shape:

```json
{
  "version": 2,
  "commit": "4d6a46d3f401736695c495f1e72ed429e0ed1b93",
  "profile": "site",
  "components": {
    "Waves": { "transforms": ["01-css-variable-fix", "02-line-color-getter", "…"] }
  }
}
```

A version 1 file (reactbits-kit 0.1.0, before profiles) reads as profile `site`, and the next `rbx add` or `rbx update` writes it as version 2.

## Our modules

`src/modules/` holds TypeScript of our own, without React Bits code. The customized components expose per-frame getters (`lineColor`, `motion`, `pointer`, `sample` and `displacement` on Waves, `params` on the other nine) and, on Waves, Aurora and Iridescence, a `paused` prop; these modules are what we drive them with.

| Module | What it does |
| --- | --- |
| `momentum.ts` | Release velocity of a flung pointer and its coast: exponential decay, soft bounces off the edges, a fade at the end. |
| `rippleField.ts` | A spring mesh over the Waves grid: a dragged pointer pulls and swirls nearby points, and the disturbance spreads as a ripple and settles. |
| `clothFollow.ts` | The whole field following a held drag a little, like a sheet on water, then gliding on after release and drifting back to rest. |
| `sphereSpin.ts` | The pattern as the inside of a ball: a drag turns it, a fling spins it on for 3 to 9 s. Waves reads it through `sample`, with `patternPeriod` set to `SPIN.PERIOD_PX` so a full turn closes without a seam. |
| `pointerFeed.ts` (+ `pointerFeed.css`) | A drag-only pointer: drags start on bare background, never on `button`, `a`, form fields or anything marked `data-solid`; grab and grabbing cursors; a fling coasts with `momentum`. |
| `colorDrive.ts` | A position on the 72-stop colour loop that drifts on its own and steps on wheel ticks. |
| `palette.ts` | The 72-stop loop itself: 12 hue families × 6 shades in OKLCH, in serpentine order, and `colorAt` to interpolate between stops. |

They are plain classes and functions that take the time as an argument, so a test can drive them; `tests/modules/` covers each. A site can wire them by hand (below) or through the React adapter (next section). By hand, import them from the package:

```tsx
import Waves from './reactbits/Waves/Waves';
import { attachPointerFeed, PointerFeed } from '@rpbostick/reactbits-kit/modules/pointerFeed';
import '@rpbostick/reactbits-kit/modules/pointerFeed.css';
import { RIPPLE, RippleField, rippleRadius, type GridPoint } from '@rpbostick/reactbits-kit/modules/rippleField';
import { ClothFollow, FOLLOW } from '@rpbostick/reactbits-kit/modules/clothFollow';
import { ColorDrive } from '@rpbostick/reactbits-kit/modules/colorDrive';
import { colorAt, stopsByTheme } from '@rpbostick/reactbits-kit/modules/palette';

const feed = new PointerFeed();
const ripple = new RippleField();
const cloth = new ClothFollow();
const drive = new ColorDrive();
// How far the ripple and the cloth together move a point: Waves draws that
// much grid beyond each edge.
const REACH = RIPPLE.MAX_RADIUS_PX * RIPPLE.MAX_DISPLACEMENT_SHARE + FOLLOW.MAX_SHIFT_PX;

function Hero() {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => attachPointerFeed(ref.current!, feed).detach, []);

  const displacement = useCallback((lines: readonly (readonly GridPoint[])[], time: number) => {
    const { width, height } = ref.current!.getBoundingClientRect();
    const pointer = feed.at(performance.now(), { left: 0, top: 0, right: width, bottom: height });
    const stir = ripple.step(lines, { pointer, stroke: feed.stroke, now: time, radius: rippleRadius(width, height) });
    cloth.step({ pointer: feed.current, stroke: feed.stroke, now: time, width, height });
    return cloth.displace(lines, stir);
  }, []);

  return (
    <header ref={ref}>
      <Waves
        lineColor={() => colorAt(stopsByTheme.light, drive.advance(performance.now()))}
        pointer={() => null}
        displacement={displacement}
        overscanX={REACH}
        overscanY={REACH}
      />
    </header>
  );
}
```

## The React adapter

`src/react/` (ours, MIT) connects a transformed component's getter props to the modules, so a background takes a few lines. It needs React, which the site has; the kit does not install it.

```tsx
import { KitBackground } from '@rpbostick/reactbits-kit/react/KitBackground';
import '@rpbostick/reactbits-kit/modules/pointerFeed.css';
import Waves from './reactbits/Waves/Waves';
import Balatro from './reactbits/Balatro/Balatro';

// The site's Waves (profile site): the line colour drifts along the loop and
// steps with the wheel; a drag on bare background ripples the lines, pulls
// the field like cloth and turns the pattern like the inside of a ball,
// coasting and spinning on after a fling.
<KitBackground
  component={Waves}
  props={{ xGap: 12, yGap: 36 }}
  colorProp="lineColor"
  colors={({ color }) => ({ lineColor: color })}
  pointer="none"
  ripple
  cloth
  spin
  wheel
/>

// Any of the other nine: `colors` returns its params, and pointer="events"
// hands the drag to it as the mouse events it listens for (as it does to the
// sheet's Waves, which takes colorProp="lineColor").
<KitBackground
  component={Balatro}
  colors={({ color }) => ({ color1: color })}
  theme="dark"
  pointer="events"
/>
```

| Option | What it wires |
| --- | --- |
| `colors(frame)` | The colour getter: `frame` is the colour drive's position on the 72-stop loop, `colorAt` of it (`rgb(…)`) and the `theme` (`light` unless given). What it returns is the component's `params` each frame, or with `colorProp="lineColor"` the Waves line colour. |
| `pointer` | `'drag'`: Waves' `pointer` getter follows a drag on bare background (pointerFeed). `'none'`: Waves' own cursor response is off, so only a displacement stirs it. `'events'`: the drag reaches the component as `mouseenter`, `mousemove` and `mouseleave` on its container, as the sheet's Waves and the other nine expect. |
| `momentum` | Whether a flung drag coasts on (default on). |
| `ripple`, `cloth` | Waves' `displacement` getter from `RippleField` and `ClothFollow`, and the overscan their reach needs. |
| `spin` | Waves' `sample` getter from `SphereSpin`, turned by the drag and spun on by a fling, and `patternPeriod` at its `PERIOD_PX`. |
| `wheel` | Wheel ticks over the background step the colour drive. |
| `touchDrags`, `reducedMotion` | A finger's drag stirs the background instead of scrolling; reduced motion turns off the drift, the coast, the ripple, the cloth and the spin. |
| `paused`, `props`, `className`, `style` | Passed on; `props` are the component's own settings. |

`ripple`, `cloth` and `spin` take `true` for the module's own constants (`RIPPLE`, `FOLLOW`, `SPIN`, the site's), or an object changing some of them, e.g. `spin={{ CURVATURE: 0 }}`; a name the module does not have throws.

`pointer`, `ripple`, `cloth`, `spin`, `colorProp` and whether `colors` is given decide which modules exist, so they cannot change on a mounted background (it throws; give it a new `key`). They compare by value, so an inline object on every render is fine. The getters are created once and read the latest options, so a new `colors` function on every render does not re-run the component's effects.

`useKitBackground(options)` is the hook under it: it returns the `ref` to put on the element the background fills and the getter `props` to spread on the component. The logic is `src/react/wiring.ts` (`BackgroundWiring`), which needs no React; `tests/react/wiring.test.ts` drives it with a stub component that calls the getters once per frame as the components do.

## Adding a transform

1. Describe the change in words first: it becomes the transform's `description` and the line in each project's `CHANGES.md`.
2. Add `src/transforms/<Component>/NN-name.ts`, numbered after the last one, exporting a `TsxTransform` (or a `CssTransform` for the `.css`) with `id`, `file`, `summary`, `description` and `apply`, and add it to the component's `index.ts`: to `transforms` in order, and to each profile in `profiles` that applies it. A new component also gets an `index.ts` with its `ComponentSpec` (upstream directory, files, transforms, profiles), registered in `src/transforms/index.ts`.
3. In `apply`, find what you change with the lookups in `src/ast/find.ts` (`functionBody`, `effectDeclaring`, `frameRequest`, `callStatement`, …), which match structure rather than text and throw a `ShapeError` saying what they looked for, and change it with `src/ast/edit.ts` and `src/ast/component.ts` (`addMember`, `addDestructuredProp`, `addSyncedRef`, `insertStatements`, …). A `params` getter is `src/ast/params.ts` (`addParamsProp`, `addFrameRef`, `writeFrameParams`, `removeDependencies`). Write only the code you add; take any upstream code you need to move from the parsed file, never from a string in the transform. A change that moves code into a new file lists it in `creates` and makes it in `apply` with `file.getProject().createSourceFile('/<name>', …)` (as Waves 13-noise-module does with `noise.ts`). Edits that insert raw text (`addMember`, `addDestructuredProp`, `insertItemAfter`, `addCommentBefore`) leave earlier node handles stale, so do them last or look nodes up again afterwards.
4. Add the change's expectation to `EXPECTED` in `tests/transforms.test.ts`: what the output has once the change is applied (a prop, a call in a given function). The test applies the changes before it in the first profile that has it, checks that the expectation does not already hold, that it holds after, and that the result type-checks. A new prop also goes into `REFERENCE_PROPS` for each profile.
5. Run `bash scripts/fetch-upstream.sh` once, then `node --test tests/transforms.test.ts`.

To check the transforms against copies a project customized by hand, run `node scripts/compare-copies.ts <dir with Component folders> --profile <site|sheet> --source .upstream`; it compares every file rbx builds (props and other interfaces, top-level constants, and each function's and class method's parameters and calls; a `.css` as text), and exits 1 on any difference.

## Development

```sh
npm ci              # also builds dist/ (prepare)
npm test            # builds dist/, fetches React Bits into .upstream/ (git-ignored), then node --test
npm run typecheck   # tsc -p .
```

`scripts/fetch-upstream.sh` clones React Bits into `.upstream/` and checks out the pinned commit (`PINNED_COMMIT` in `src/upstream.ts`), with only the top-level files and `src/ts-default` in the working tree (the rest of React Bits has test files of its own that `node --test` would pick up). Tests that need it skip with a message when it is absent.

The transforms use [ts-morph](https://ts-morph.com) (MIT) rather than jscodeshift: it parses `.tsx` with the TypeScript compiler itself, edits in place without reprinting the rest of the file, and the same library type-checks the output in the tests. `.css` changes use [PostCSS](https://postcss.org) (MIT).

## Licence

MIT, see `LICENSE`. React Bits itself is © David Haz under MIT + Commons Clause; rbx copies its licence into each `CHANGES.md` it writes.
