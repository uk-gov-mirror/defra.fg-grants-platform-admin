// @vitest-environment happy-dom

import { TabStrip } from './tab-strip.element.ts'

const strip = async (scrollWidth: number) => {
  if (!customElements.get('do-tab-strip')) {
    customElements.define('do-tab-strip', TabStrip)
  }

  document.body.innerHTML =
    '<do-tab-strip><a>Overview</a><a aria-current="page">Raw</a></do-tab-strip>'

  const element = document.querySelector<TabStrip>('do-tab-strip')!
  const current = element.querySelector<HTMLElement>('[aria-current]')!

  Object.defineProperty(element, 'scrollWidth', { value: scrollWidth })
  Object.defineProperty(element, 'clientWidth', { value: 300 })
  Object.defineProperty(current, 'offsetLeft', { value: 500 })
  Object.defineProperty(current, 'offsetWidth', { value: 60 })

  element.connectedCallback()
  await Promise.resolve()

  return element
}

describe('do-tab-strip', () => {
  test('centres the open tab in a row that scrolls', async () => {
    expect((await strip(800)).scrollLeft).toBe(380)
  })

  test('leaves a row that fits alone', async () => {
    expect((await strip(300)).scrollLeft).toBe(0)
  })
})
