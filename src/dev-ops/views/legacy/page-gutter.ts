/**
 * The page's scrollbar gutter, kept as `--page-gutter` for the page to pad
 * itself by while an open drawer or dialog takes the gutter, which would
 * otherwise stand between it and the window's edge. Measured only while the
 * page still has the gutter.
 */
export const holdPageGutter = () => {
  const root = document.documentElement

  if (getComputedStyle(root).scrollbarGutter !== 'auto') {
    root.style.setProperty(
      '--page-gutter',
      `${window.innerWidth - root.getBoundingClientRect().width}px`
    )
  }
}
