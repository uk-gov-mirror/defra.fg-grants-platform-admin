import type { CheerioAPI } from 'cheerio'

import { render } from '../../../test-utils.ts'
import { toGrantQuestions } from '../../../view-models/grant-questions.ts'

const testId = 'grant-questions'

const flatten = (text: string) => text.replaceAll(/\s+/g, ' ').trim()

const part = ($: CheerioAPI, name: string) =>
  $(`[data-testid="${testId}-${name}"]`)

const questionsOf = (...phases: unknown[]) =>
  render('grant-questions', {
    questions: toGrantQuestions({ phases }),
    testId
  })

describe('grant-questions component', () => {
  test('heads a phase with no questions like any other, under its name and code', () => {
    const $ = questionsOf(
      { code: 'PRE_AWARD', questions: { type: 'object', properties: {} } },
      { code: 'POST_AGREEMENT_MONITORING', name: 'Post Agreement Monitoring' }
    )
    const none = part($, 'phase').last()
    const heading = none.find('h2')

    expect(flatten(heading.text())).toBe(
      'Post Agreement Monitoring POST_AGREEMENT_MONITORING Not checked on submission'
    )
    expect(none.attr('aria-labelledby')).toBe(heading.attr('id'))
    expect(flatten(part($, 'none').text())).toBe('No questions in this phase.')
  })
})
