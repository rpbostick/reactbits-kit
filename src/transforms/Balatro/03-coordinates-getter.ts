import { coordinatesTransform } from '../../ast/coordinates.ts'

export default coordinatesTransform('03-coordinates-getter', {
  component: 'Balatro',
  propsType: 'BalatroProps',
  shader: 'fragmentShader',
  coordinate: 'vUv',
  loop: 'update',
  props: 'destructured',
})
