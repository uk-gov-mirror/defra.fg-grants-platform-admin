import type { CheerioAPI } from 'cheerio'

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
