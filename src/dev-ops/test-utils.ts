import camelCase from 'lodash/camelCase.js'
import { load, type CheerioAPI, type CheerioOptions } from 'cheerio'

import { environment } from './view-options.ts'

export type RenderedComponent = CheerioAPI

/**
 * Renders a dev-ops component macro and hands back a cheerio document
 * ready to query. The sharper tool when only the markup contract is under
 * test — no DOM environment needed.
 *
 * Deliberately parallel to, not shared with, test/utils.ts: the two apps'
 * test kits evolve with their own design systems, exactly as their view
 * stacks do.
 *
 * @param name The component directory, which is also the macro name once
 *   camel cased, e.g. `json-viewer` renders `jsonViewer`. No prefix: the
 *   dev-ops environment resolves no foreign components, so macro names
 *   have nothing to collide with.
 * @param params The macro's params object.
 * @param block Markup for a component that is called with a body.
 * @param options Passed to cheerio, e.g. `{ xml: true }`.
 */
export const render = (
  name: string,
  params: object,
  block?: string,
  options?: CheerioOptions
): RenderedComponent => {
  const macro = {
    path: `${name}/macro.njk`,
    name: camelCase(name),
    params: JSON.stringify(params, null, 2)
  }

  const callComponent = block
    ? `{%- call ${macro.name}(${macro.params}) -%}${block}{%- endcall -%}`
    : `{{- ${macro.name}(${macro.params}) -}}`

  const html = environment.renderString(
    `{%- from "${macro.path}" import ${macro.name} -%}
    ${callComponent}
    `,
    {}
  )

  return load(html, options)
}

/**
 * Renders a dev-ops component macro into the live document, registering
 * the app's custom elements first so an enhanced component upgrades and
 * enhances exactly as it would on a page. A vanilla component mounts the same
 * way — it simply has no element waiting for it.
 *
 * Needs a DOM test environment: put `// @vitest-environment happy-dom` at the
 * top of the test file.
 *
 * @returns `document.body`, ready to query.
 */
export const mount = async (
  name: string,
  params: object,
  block?: string
): Promise<HTMLElement> => {
  if (typeof document === 'undefined') {
    throw new Error(
      'mount needs a DOM: add `// @vitest-environment happy-dom` to the test file'
    )
  }

  // Imported lazily because the element classes extend HTMLElement, which
  // only exists once a DOM environment is up — a top-level import would
  // crash every node-environment test that touches this module.
  await import('./views/legacy/index.ts')

  document.body.innerHTML = render(name, params, block)('body').html() ?? ''

  // Element enhancement is deferred a microtask past connection.
  await Promise.resolve()

  return document.body
}

/**
 * Whether a dialog is drawn open for a browser that runs no script: the
 * native `open` attribute shows it, and `data-open` tells the dialog element
 * to open it as a modal once the script does run. The convention for every
 * dialog a URL can ask for.
 */
export const isOpenWithoutScript = ($: CheerioAPI, id: string): boolean => {
  const dialog = $(`dialog#${id}`)

  return dialog.is('[open]') && dialog.parent('gpa-dialog').is('[data-open]')
}

/**
 * Where a dialog's × goes: the page without a script, and, with one, the
 * address the dialog puts back when it closes after the address opened it.
 */
export const closeHrefOf = ($: CheerioAPI, id: string): string | undefined =>
  $(`dialog#${id} a.gpa-dialog-close`).attr('href')

/** Whether a dialog's fields go back to what the server drew each time it's opened from the page. */
export const resetsOnOpen = ($: CheerioAPI, id: string): boolean =>
  $(`dialog#${id}`).parent('gpa-dialog').is('[data-reset-on-open]')

/** The style nonce a response's content security policy allows. */
export const styleNonceOf = (csp: unknown): string | undefined =>
  /style-src [^;]*'nonce-([^']+)'/.exec(String(csp))?.[1]

/**
 * Each table a DataTable drew, and whether its column widths are in a
 * <style> the response's policy allows, so every browser draws them on load.
 */
export const tableStyles = ($: CheerioAPI, csp: unknown) => {
  const nonce = styleNonceOf(csp)
  const styles = $('style')
    .toArray()
    .map((element) => ({
      nonce: $(element).attr('nonce'),
      text: $(element).text()
    }))

  return $('table[data-gpa-table]')
    .toArray()
    .map((table) => {
      const selector = `[data-gpa-table="${$(table).attr('data-gpa-table')}"]`
      const widths = `--gpa-cols:${$(table).attr('data-gpa-cols')};`
      const style = styles.find(({ text }) => text.startsWith(selector)) ?? {
        nonce: undefined,
        text: ''
      }

      return {
        label: $(table).attr('aria-label'),
        nonced: Boolean(nonce) && style.nonce === nonce,
        widths: style.text.includes(widths)
      }
    })
}

/** Every table on the page has its widths in a nonce'd <style>. */
export const expectTablesStyled = ($: CheerioAPI, csp: unknown) => {
  tableStyles($, csp).forEach((style) => {
    expect(style).toEqual({ label: style.label, nonced: true, widths: true })
  })
}
