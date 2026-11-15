import { environment } from '../../../view-options.ts'
import { load } from 'cheerio'

const words = (parts: unknown[]) =>
  load(
    environment.renderString(
      '{% from "words/macro.njk" import words %}[{{ words(parts) }}]',
      { parts }
    )
  )

describe('words component', () => {
  test('writes text as it is, and each code part in breaking mono', () => {
    const $ = words(['If ', { code: 'has_plan' }, ' = true'])

    expect($('body').text()).toBe('[If has_plan = true]')
    expect($('.font-mono').text()).toBe('has_plan')
    expect($('.font-mono wbr')).toHaveLength(1)
  })

  test('escapes markup in text and in code', () => {
    const $ = words(['<b>x</b>', { code: '<i>y</i>' }])

    expect($('b, i')).toHaveLength(0)
    expect($('body').text()).toBe('[<b>x</b><i>y</i>]')
  })

  test('writes an empty code part as an empty code', () => {
    const $ = words([{ code: '' }])

    expect($('.font-mono')).toHaveLength(1)
  })

  test('writes a strong part in bold and a link part as a link', () => {
    const $ = words([
      { strong: 'Draft:' },
      ' see ',
      { link: '3.20.0 ›', href: '/dev-ops/grants/x/3.20.0' }
    ])

    expect($('strong').text()).toBe('Draft:')
    expect($('a').attr('href')).toBe('/dev-ops/grants/x/3.20.0')
    expect($('a').attr('class')).toBe('link')
    expect($('body').text()).toBe('[Draft: see 3.20.0 ›]')
  })
})
