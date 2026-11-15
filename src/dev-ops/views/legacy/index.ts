import { ClientField } from './client-field/client-field.element.ts'
import { ConfirmField } from './confirm-field/confirm-field.element.ts'
import { ExpiryPicker } from './expiry-picker/expiry-picker.element.ts'
import { Modal } from './token-dialog/modal.element.ts'
import { TokenDrawer } from './token-drawer/token-drawer.element.ts'
import { TokenReveal } from './token-reveal/token-reveal.element.ts'
import { TokenToast } from './token-toast/token-toast.element.ts'

customElements.define('do-client-field', ClientField)
customElements.define('do-confirm-field', ConfirmField)
customElements.define('do-expiry-picker', ExpiryPicker)
customElements.define('do-modal', Modal)
customElements.define('do-token-drawer', TokenDrawer)
customElements.define('do-token-reveal', TokenReveal)
customElements.define('do-token-toast', TokenToast)
