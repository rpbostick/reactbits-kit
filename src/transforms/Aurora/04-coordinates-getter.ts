import { coordinatesTransform } from '../../ast/coordinates.ts'

export default coordinatesTransform('04-coordinates-getter', {
  component: 'Aurora',
  propsType: 'AuroraProps',
  shader: 'FRAG',
  coordinate: 'gl_FragCoord',
  loop: 'update',
  props: 'propsRef',
})
