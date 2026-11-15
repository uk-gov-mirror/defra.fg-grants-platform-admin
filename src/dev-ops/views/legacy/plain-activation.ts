const hasModifier = (event: MouseEvent): boolean =>
  event.metaKey || event.ctrlKey || event.shiftKey || event.altKey

/** A left click with nothing held: anything else means "open it somewhere else". */
export const isPlainActivation = (event: MouseEvent): boolean =>
  !event.defaultPrevented && event.button === 0 && !hasModifier(event)
