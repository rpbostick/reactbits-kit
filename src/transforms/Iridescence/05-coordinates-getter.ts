import { coordinatesTransform } from '../../ast/coordinates.ts'

export default coordinatesTransform('05-coordinates-getter', {
  component: 'Iridescence',
  propsType: 'IridescenceProps',
  shader: 'fragmentShader',
  coordinate: 'vUv',
  loop: 'update',
  props: 'destructured',
})
