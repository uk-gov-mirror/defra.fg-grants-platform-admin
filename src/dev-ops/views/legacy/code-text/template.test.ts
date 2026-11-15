import { environment } from '../../../view-options.ts'
import { load } from 'cheerio'

const codeText = (value: string, extra?: string) =>
  load(
    environment.renderString(
      `{% from "code-text/macro.njk" import codeText %}[{{ codeText(value, extra) }}]`,
      { value, extra }
    )
  )

describe('code-text component', () => {
  test('writes the code in mono, with a break after each colon, underscore and slash', () => {
    const $ = codeText('PRE_AWARD:REVIEW')
    const span = $('span')

    expect(span.attr('class')).toBe('font-mono [overflow-wrap:anywhere]')
    expect(span.text()).toBe('PRE_AWARD:REVIEW')
    expect(span.find('wbr')).toHaveLength(2)
    expect(span.html()).toBe('PRE_<wbr>AWARD:<wbr>REVIEW')
  })

  test('adds the classes it is given, and no space around itself', () => {
    const $ = codeText('A_B', 'text-xs')

    expect($('span').attr('class')).toBe(
      'font-mono [overflow-wrap:anywhere] text-xs'
    )
    expect($('body').text()).toBe('[A_B]')
  })

  test('escapes markup in a code', () => {
    const $ = codeText('<b>x</b>')

    expect($('span b')).toHaveLength(0)
    expect($('span').text()).toBe('<b>x</b>')
  })
})
