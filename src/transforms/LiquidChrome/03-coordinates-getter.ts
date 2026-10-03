import { coordinatesTransform } from '../../ast/coordinates.ts'

export default coordinatesTransform('03-coordinates-getter', {
  component: 'LiquidChrome',
  propsType: 'LiquidChromeProps',
  shader: 'fragmentShader',
  coordinate: 'vUv',
  loop: 'update',
  props: 'destructured',
})
