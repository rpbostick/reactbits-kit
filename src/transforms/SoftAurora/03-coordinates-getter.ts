import { coordinatesTransform } from '../../ast/coordinates.ts'

export default coordinatesTransform('03-coordinates-getter', {
  component: 'SoftAurora',
  propsType: 'SoftAuroraProps',
  shader: 'fragmentShader',
  coordinate: 'gl_FragCoord',
  loop: 'update',
  props: 'destructured',
})
