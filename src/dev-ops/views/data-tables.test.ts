import fs from 'node:fs'
import path from 'node:path'

const viewsPath = import.meta.dirname

const templates = fs
  .readdirSync(viewsPath, { recursive: true, encoding: 'utf8' })
  .filter((file) => file.endsWith('.njk'))
  .map((file) => ({
    file,
    source: fs.readFileSync(path.join(viewsPath, file), 'utf8')
  }))

/** The params object of the `gpa.DataTable({ … })` call at `start`, braces matched. */
const paramsAt = (source: string, start: number) => {
  let depth = 0

  for (let at = start; at < source.length; at++) {
    depth += Number(source[at] === '{') - Number(source[at] === '}')
    if (depth === 0) {
      return source.slice(start, at + 1)
    }
  }

  return source.slice(start)
}

const count = (text: string, pattern: RegExp) =>
  [...text.matchAll(pattern)].length

const insideMacro = (source: string, index: number) => {
  const before = source.slice(0, index)

  return count(before, /{%-?\s*macro\b/g) > count(before, /{%-?\s*endmacro\b/g)
}

const tableCalls = templates.flatMap(({ file, source }) =>
  [...source.matchAll(/gpa\.DataTable\(/g)].map(({ index }) => ({
    file,
    params: paramsAt(source, index + 'gpa.DataTable('.length),
    inMacro: insideMacro(source, index)
  }))
)

const macroFilesWithTables = [
  ...new Set(
    tableCalls.filter(({ inMacro }) => inMacro).map(({ file }) => file)
  )
]

const importsOf = (file: string) =>
  templates.flatMap(({ file: importer, source }) =>
    [
      ...source.matchAll(
        new RegExp(String.raw`{%-?\s*(?:from|import)\s+"${file}"[^%]*%}`, 'g')
      )
    ].map(([statement]) => ({ importer, statement }))
  )

describe('every DataTable in the Dev Ops views', () => {
  test('there are tables to check', () => {
    expect(tableCalls.length).toBeGreaterThan(15)
  })

  test.each(tableCalls)('$file passes the page’s style nonce', ({ params }) => {
    expect(params).toMatch(/\bstyleNonce:\s*styleNonce\b/)
  })

  test.each(macroFilesWithTables)(
    '%s is imported with the page’s context, so its tables see the nonce',
    (file) => {
      const imports = importsOf(file)

      expect(imports.length).toBeGreaterThan(0)
      imports.forEach(({ statement }) => {
        expect(statement).toMatch(/\bwith context\b/)
      })
    }
  )
})
