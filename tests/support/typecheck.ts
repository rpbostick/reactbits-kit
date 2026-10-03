// Type-checks a component's built files in memory, as a project would compile
// them: strict, react-jsx, with React's and ogl's types from this repository's
// node_modules, and `.ts` imports allowed as Vite allows them. The files are
// never written.
import { join } from 'node:path'
import { ts, Project } from 'ts-morph'
import { ROOT } from './upstream.ts'

// `files` maps file name → text; its .ts and .tsx files are checked together.
export function typeErrors(component: string, files: Map<string, string>): string[] {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    compilerOptions: {
      strict: true,
      noEmit: true,
      allowImportingTsExtensions: true,
      skipLibCheck: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      jsx: ts.JsxEmit.ReactJSX,
      lib: ['lib.es2023.d.ts', 'lib.dom.d.ts'],
      types: [],
    },
  })
  // Under the repository root, so 'react' and 'ogl' resolve from its node_modules.
  const dir = join(ROOT, '.typecheck', component)
  project.createSourceFile(join(dir, 'css.d.ts'), "declare module '*.css';")
  const sources = [...files].filter(([file]) => /\.tsx?$/.test(file))
  if (sources.length === 0) throw new Error(`${component}: no .ts or .tsx file to type-check`)
  for (const [file, text] of sources) project.createSourceFile(join(dir, file), text)
  return project.getPreEmitDiagnostics().map((diagnostic) => {
    const message = ts.flattenDiagnosticMessageText(diagnostic.compilerObject.messageText, '\n')
    return `${diagnostic.getSourceFile()?.getBaseName() ?? '?'}:${diagnostic.getLineNumber() ?? '?'} ${message}`
  })
}
