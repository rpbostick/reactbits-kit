import { coordinatesTransform } from '../../ast/coordinates.ts'

export default coordinatesTransform('03-coordinates-getter', {
  component: 'Threads',
  propsType: 'ThreadsProps',
  shader: 'fragmentShader',
  coordinate: 'gl_FragCoord',
  loop: 'update',
  props: 'destructured',
})
