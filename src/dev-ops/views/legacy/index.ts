import { Back } from './back/back.element.ts'
import { ClientField } from './client-field/client-field.element.ts'
import { ConfirmField } from './confirm-field/confirm-field.element.ts'
import { ExpiryPicker } from './expiry-picker/expiry-picker.element.ts'
import { ChoiceMenu } from './filter-menu/choice-menu.element.ts'
import { FilterMenu } from './filter-menu/filter-menu.element.ts'
import { JsonViewer } from './json-viewer/json-viewer.element.ts'
import { StateGraph } from './state-graph/state-graph.element.ts'
import { TabStrip } from './tab-strip/tab-strip.element.ts'
import { Modal } from './token-dialog/modal.element.ts'
import { TokenDrawer } from './token-drawer/token-drawer.element.ts'
import { TokenReveal } from './token-reveal/token-reveal.element.ts'
import { TokenToast } from './token-toast/token-toast.element.ts'

customElements.define('do-back', Back)
customElements.define('do-choice-menu', ChoiceMenu)
customElements.define('do-client-field', ClientField)
customElements.define('do-confirm-field', ConfirmField)
customElements.define('do-expiry-picker', ExpiryPicker)
customElements.define('do-filter-menu', FilterMenu)
customElements.define('do-json-viewer', JsonViewer)
customElements.define('do-modal', Modal)
customElements.define('do-state-graph', StateGraph)
customElements.define('do-tab-strip', TabStrip)
customElements.define('do-token-drawer', TokenDrawer)
customElements.define('do-token-reveal', TokenReveal)
customElements.define('do-token-toast', TokenToast)
