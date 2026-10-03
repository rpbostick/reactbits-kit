import { coordinatesTransform } from '../../ast/coordinates.ts'

export default coordinatesTransform('04-coordinates-getter', {
  component: 'Galaxy',
  propsType: 'GalaxyProps',
  shader: 'fragmentShader',
  coordinate: 'vUv',
  loop: 'update',
  props: 'destructured',
})
