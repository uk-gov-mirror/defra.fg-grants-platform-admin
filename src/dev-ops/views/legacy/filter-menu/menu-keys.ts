const steps: Record<string, (index: number, last: number) => number> = {
  ArrowDown: (index, last) => Math.min(index + 1, last),
  ArrowUp: (index) => Math.max(index - 1, 0),
  Home: () => 0,
  End: (_index, last) => last
}

const land = (item: HTMLElement | undefined) => {
  item?.focus()
  item?.scrollIntoView({ block: 'nearest' })
}

const moveFocus = (
  all: HTMLElement[],
  step: (index: number, last: number) => number
) => {
  const index = all.indexOf(document.activeElement as HTMLElement)
  const next = all.at(step(index, all.length - 1))

  next?.focus()
  next?.scrollIntoView({ block: 'nearest' })
}

/**
 * A menu's items take the arrow keys, Home and End, and opening it puts the
 * focus on the ticked item, scrolled into view in a menu taller than its box.
 * The items leave the tab order only here, so without script they can still
 * be tabbed to: Tab closes the menu and moves on.
 */
export const keepMenuKeys = (
  panel: HTMLElement,
  items: () => HTMLElement[],
  ticked: () => HTMLElement | undefined
): void => {
  for (const item of items()) {
    item.tabIndex = -1
  }

  panel.addEventListener('toggle', (event) => {
    if ((event as ToggleEvent).newState === 'open') {
      land(ticked() ?? items().at(0))
    }
  })

  panel.addEventListener('keydown', (event) => {
    if (event.key === 'Tab') {
      panel.hidePopover()

      return
    }

    const step = steps[event.key]

    if (step) {
      event.preventDefault()
      moveFocus(items(), step)
    }
  })
}
