import Blankie from 'blankie'
import type { ServerRegisterPluginObject } from '@hapi/hapi'

const contentSecurityPolicy = {
  plugin: Blankie,
  options: {
    defaultSrc: ['self'],
    fontSrc: ['self', 'data:'],
    connectSrc: ['self', 'wss', 'data:'],
    mediaSrc: ['self'],
    styleSrc: ['self'],
    scriptSrc: [
      'self',
      // The GOV.UK frontend script inlined by its Nunjucks macros
      // https://frontend.design-system.service.gov.uk/import-javascript/#if-our-inline-javascript-snippet-is-blocked-by-a-content-security-policy
      "'sha256-GUQ5ad8JK5KmEWmROf3LZd9ge94daqNvd8xy9YS1iDw='"
    ],
    imgSrc: ['self', 'data:'],
    frameSrc: ['self', 'data:'],
    objectSrc: ['none'],
    frameAncestors: ['none'],
    formAction: ['self'],
    manifestSrc: ['self'],
    // A nonce per response for the <style> a DataTable writes its column
    // widths in. Scripts are all files from 'self', so they need none.
    generateNonces: 'style'
  }
} satisfies ServerRegisterPluginObject<Record<string, unknown>>

export { contentSecurityPolicy }
