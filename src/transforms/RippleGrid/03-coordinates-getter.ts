import { coordinatesTransform } from '../../ast/coordinates.ts'

// The grid moves; its vignette, worked out from vUv later in main(), stays
// on the screen.
export default coordinatesTransform('03-coordinates-getter', {
  component: 'RippleGrid',
  propsType: 'Props',
  shader: 'frag',
  coordinate: 'vUv',
  loop: 'render',
  props: 'destructured',
})
