import { LitElement, html } from 'lit'

/*
 * The panel's controls as elements. Each one wraps the factory the pages already use, so there is
 * one implementation of the behaviour and one stylesheet, and a page can now write <sel-select>
 * instead of building the control with document.createElement.
 *
 * No shadow root: the Selena tokens live in theme.css, and a shadow boundary would strand them.
 */

const CONTROL_TIP = (element) => element.getAttribute('data-tip') || ''

class SelSelect extends LitElement {
  static properties = {
    options: { type: Array },
    value: { type: String },
    placeholder: { type: String },
    search: { type: String },
    disabled: { type: Boolean },
  }

  createRenderRoot() { return this }

  connectedCallback() {
    super.connectedCallback()
    this.renderControl()
  }

  updated(changed) {
    if (!this.control) return
    if (changed.has('options') || changed.has('value')) {
      this.control.setOptions(this.options || [], this.value || '')
    }
    if (changed.has('disabled')) this.control.setDisabled(this.disabled)
  }

  renderControl() {
    if (this.control) return
    this.control = window.SelenaUI.select(this.options || [], {
      value: this.value || '',
      placeholder: this.placeholder || 'nothing to pick',
      search: this.search || 'Filter',
      tip: CONTROL_TIP(this),
      disabled: this.disabled,
      onChange: (value) => {
        this.value = String(value)
        this.dispatchEvent(new CustomEvent('change', { detail: { value: this.value }, bubbles: true }))
      },
    })
    this.appendChild(this.control.node)
    // A page usually sets options and value before the element is in the document, so the control
    // gets the current properties once it exists instead of waiting for the next update.
    this.control.setOptions(this.options || [], this.value || '')
    this.control.setDisabled(this.disabled)
  }

  render() { return html`` }
}

class SelToggle extends LitElement {
  static properties = {
    label: { type: String },
    checked: { type: Boolean },
  }

  createRenderRoot() { return this }

  connectedCallback() {
    super.connectedCallback()
    this.renderControl()
  }

  renderControl() {
    if (this.control) return
    this.control = window.SelenaUI.toggle({
      label: this.label || '',
      checked: this.checked,
      tip: CONTROL_TIP(this),
      onChange: (checked) => {
        this.checked = checked
        this.dispatchEvent(new CustomEvent('change', { detail: { checked }, bubbles: true }))
      },
    })
    this.appendChild(this.control.node)
  }

  render() { return html`` }
}

class SelSlider extends LitElement {
  static properties = {
    min: { type: Number },
    max: { type: Number },
    value: { type: Number },
    format: { attribute: false },
  }

  createRenderRoot() { return this }

  connectedCallback() {
    super.connectedCallback()
    this.renderControl()
  }

  renderControl() {
    if (this.control) return
    this.control = window.SelenaUI.slider({
      min: this.min || 0,
      max: this.max || 100,
      value: this.value || 0,
      format: this.format,
      tip: CONTROL_TIP(this),
      onChange: (value) => {
        this.value = value
        this.dispatchEvent(new CustomEvent('change', { detail: { value }, bubbles: true }))
      },
    })
    this.appendChild(this.control.node)
  }

  render() { return html`` }
}

customElements.define('sel-select', SelSelect)
customElements.define('sel-toggle', SelToggle)
customElements.define('sel-slider', SelSlider)