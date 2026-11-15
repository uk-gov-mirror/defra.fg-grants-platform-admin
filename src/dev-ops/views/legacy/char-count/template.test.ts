import { render } from '../../../test-utils.ts'

const params = {
  id: 'purge-note',
  name: 'note',
  value: '',
  count: '0 / 500',
  max: 500,
  message: null,
  messageId: 'purge-note-hint',
  helpId: 'purge-note-help',
  describedBy: 'purge-note-help',
  hint: "Don't include personal data.",
  placeholder: 'Why will this event never be processed?',
  testId: 'event-purge-note-field'
}

const rejected = {
  ...params,
  value: 'a',
  count: '1 / 500',
  message: 'Enter a note.',
  describedBy: 'purge-note-hint purge-note-help'
}

describe('char-count component', () => {
  test('is one textarea, named and described as the caller asked', () => {
    const $count = render('char-count', params)
    const field = $count('[data-testid="event-purge-note-field"]')

    expect(field.is('textarea')).toBe(true)
    expect(field.attr('id')).toBe('purge-note')
    expect(field.attr('name')).toBe('note')
    expect(field.attr('placeholder')).toBe(
      'Why will this event never be processed?'
    )
    expect(field.attr('aria-describedby')).toBe('purge-note-help')
    expect(field.text()).toBe('')
  })

  test('carries the limit on the element, for the script to read', () => {
    expect(render('char-count', params)('do-char-count').attr('data-max')).toBe(
      '500'
    )
  })

  test('counts from the server, so the number is right before any script runs', () => {
    expect(
      render(
        'char-count',
        rejected
      )('[data-testid="event-purge-note-field-count"]').text()
    ).toBe('1 / 500')
  })

  test('hides the visible count from a screen reader', () => {
    const $count = render('char-count', params)

    expect(
      $count('[data-testid="event-purge-note-field-count"]').attr('aria-hidden')
    ).toBe('true')

    const status = $count('[data-testid="event-purge-note-field-status"]')

    expect(status.attr('role')).toBe('status')
    expect(status.attr('class')).toBe('sr-only')
    expect(status.text()).toBe('')
  })

  test('says the hint beside the count', () => {
    expect(
      render(
        'char-count',
        params
      )('[data-testid="event-purge-note-field-hint"]').text()
    ).toBe("Don't include personal data.")
  })

  test('writes no error line and marks nothing invalid when there is no error', () => {
    const $count = render('char-count', params)

    expect(
      $count('[data-testid="event-purge-note-field-message"]')
    ).toHaveLength(0)
    expect(
      $count('[data-testid="event-purge-note-field"]').attr('aria-invalid')
    ).toBeUndefined()
  })

  test('marks the field invalid and writes the error under it', () => {
    const $count = render('char-count', rejected)
    const field = $count('[data-testid="event-purge-note-field"]')
    const message = $count('[data-testid="event-purge-note-field-message"]')

    expect(field.attr('aria-invalid')).toBe('true')
    expect(field.hasClass('validator')).toBe(true)
    expect(message.text()).toBe('Enter a note.')
    expect(message.attr('id')).toBe('purge-note-hint')
    expect(message.hasClass('text-error')).toBe(true)
    // Written only when there is one, so it must never be hidden.
    expect(message.hasClass('visible')).toBe(true)
    expect(field.attr('aria-describedby')).toBe(
      'purge-note-hint purge-note-help'
    )
  })

  test('keeps the value it was given inside the textarea', () => {
    expect(
      render('char-count', { ...params, value: 'typed text' })(
        '[data-testid="event-purge-note-field"]'
      ).text()
    ).toBe('typed text')
  })

  test('escapes hostile params rather than emitting them', () => {
    const $count = render('char-count', {
      ...rejected,
      value: '</textarea><script>alert(1)</script>',
      hint: '"><script>alert(1)</script>',
      message: '"><script>alert(1)</script>'
    })

    expect($count('script')).toHaveLength(0)
  })
})
