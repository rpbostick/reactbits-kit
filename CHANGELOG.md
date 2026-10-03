# Changelog

## 0.3.0 (2026-10-02)

- Waves, profile `site`: 13-noise-module moves `Grad` and `Noise` into a new `Waves/noise.ts` whose `perlin2` takes a lattice period (default 256, the original wrap), with `NOISE_SCALE` and `noisePeriod`; 14-sample-getter adds a `sample` getter (where each point reads the noise, called before the points move) and a `patternPeriod` prop. `rbx add Waves --profile site` now writes `noise.ts` next to `Waves.tsx`, and `CHANGES.md` says which change moved it there.
- A transform can create a file (`creates`); `rbx add`, `rbx update` and `rbx check` treat it like the fetched ones.
- `rippleField`: about twice the pull (`PULL_PER_S` 12 towards all of the pointer's velocity) and the swirl (`SWIRL_ACCEL_RADII_PER_S2` 12), with room for the stretch (`MAX_DISPLACEMENT_SHARE` 0.8).
- `clothFollow`: a heavier sheet that follows further (`FOLLOW_SHARE` 0.3, `CAP_SHARE` 0.12, `MAX_SHIFT_PX` 250), glides 3 to 9 s after release (`GLIDE_FRICTION_PER_S`, `GLIDE_END_SPEED_PX_S`, `MAX_GLIDE_S`) and returns to rest over tens of seconds, the pull back fading in as the glide slows (`RELAX_SPEED_PX_S`).
- New module `sphereSpin`: the pattern as the inside of a ball a drag turns and a fling spins, for Waves' `sample` getter with `patternPeriod` at `SPIN.PERIOD_PX`.
- React adapter: a `spin` option; `ripple`, `cloth` and `spin` take `true` for the module's constants or an object changing some of them; the overscan covers the ripple's and the cloth's reach together; reduced motion also turns the ripple off.
- `scripts/compare-copies.ts` also compares the files a transform adds, top-level constants, class methods and parameters.

## 0.2.1 (2026-10-02)

- The package ships compiled JavaScript and `.d.ts` files in `dist/` instead of the TypeScript sources, so a git or tarball install runs: Node refuses to strip types under `node_modules` (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`). `bin/rbx.js` runs `dist/cli.js`.
- Import paths drop the `.ts`: `@rpbostick/reactbits-kit/modules/palette`, `@rpbostick/reactbits-kit/react/KitBackground`, and so on; `modules/pointerFeed.css` is unchanged. The `.ts` paths of 0.2.0 no longer resolve.
- A `prepare` script (`node scripts/build.js`) builds `dist/`, which is not committed; npm runs it for a git dependency (`npm install -D github:rpbostick/reactbits-kit#v0.2.1`) and for `npm pack`.

## 0.2.0 (2026-10-02)

- Transforms for seven more backgrounds, pinned to the same React Bits commit:
  - Threads: 01-params-getter, 02-dpr-cap.
  - Balatro: 01-params-getter, 02-colors-out-of-deps.
  - LiquidChrome: 01-params-getter, 02-color-out-of-deps.
  - Galaxy: 01-params-getter, 02-frame-props-out-of-deps, 03-transparent-light-mode.
  - Plasma: 01-params-getter, 02-frame-props-out-of-deps.
  - SoftAurora: 01-params-getter, 02-frame-props-out-of-deps.
  - RippleGrid: 01-params-getter, 02-dpr-cap.
- Profiles: each project applies one named set of changes, `site` (our website's) or `sheet` (the character sheet's). The sheet's set adds Waves 11-container-pointer-listeners and 12-mouseleave-ends-stroke in place of 08–10, and Iridescence 03-params-getter and 04-color-out-of-deps. `rbx add` and `rbx update` take `--profile`; `rbx list` shows which profiles apply each transform; `rbx check` also reports a component built with another set than its profile's.
- `reactbits-kit.json` is version 2, with a `profile`. A version 1 file reads as profile `site` and is written back as version 2 on the next `rbx add` or `rbx update`.
- `scripts/compare-copies.ts` takes `--profile`.
- React adapter (`@rpbostick/reactbits-kit/react/KitBackground.ts`): `<KitBackground>` and `useKitBackground` wire a component's getter props to the colour drive, the drag feed with momentum, the ripple field and the cloth follow; the logic is `react/wiring.ts`, which needs no React.

## 0.1.0 (2026-10-02)

First release.

- `rbx add`, `rbx update`, `rbx check` and `rbx list`: fetch React Bits components at a pinned commit (raw GitHub, or a local checkout with `--source`), apply our transforms, write `CHANGES.md` with React Bits' licence, record the commit in `reactbits-kit.json`, and report drift.
- Transforms, pinned to React Bits `4d6a46d3f401736695c495f1e72ed429e0ed1b93`:
  - Waves: 01-css-variable-fix, 02-line-color-getter, 03-intersection-observer, 04-pointer-position-fix, 05-motion-getter, 06-accumulated-clock, 07-paused-prop, 08-pointer-getter, 09-displacement-getter, 10-overscan.
  - Aurora: 01-params-getter, 02-accumulated-clock, 03-paused-prop.
  - Iridescence: 01-accumulated-clock, 02-paused-prop.
- Modules: `momentum`, `rippleField`, `clothFollow`, `pointerFeed` (with `pointerFeed.css`), `colorDrive` and `palette`.
