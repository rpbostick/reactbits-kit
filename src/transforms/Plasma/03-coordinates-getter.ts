import { coordinatesTransform } from '../../ast/coordinates.ts'

// The reduced-motion frame is drawn with this frame's coordinates too.
export default coordinatesTransform('03-coordinates-getter', {
  component: 'Plasma',
  propsType: 'PlasmaProps',
  shader: 'buildFragment',
  coordinate: 'gl_FragCoord',
  loop: 'loop',
  alsoDrawing: ['renderStaticFrame'],
  props: 'destructured',
})
