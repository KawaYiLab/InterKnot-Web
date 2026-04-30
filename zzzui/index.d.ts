import type { App, Component } from 'vue'

// ---- Size & Color constants ----

export type ZenlessSize = 'extra' | 'large' | 'small' | 'mini'
export type ZenlessColor =
  | 'default' | 'primary' | 'success' | 'danger' | 'warning' | 'info'
  | 'ether' | 'fire' | 'electric' | 'ice' | 'physical'

// ---- Locale ----

export interface ZenlessLocaleData {
  modal: { cancel: string; confirm: string }
  pagination: { prev: string; next: string }
  select: { empty: string }
  table: { empty: string }
}

export interface ZenlessLocale {
  name: string
  data: ZenlessLocaleData
}

// ---- Install options ----

export interface ZenlessInstallOptions {
  isBold?: boolean
  isItalic?: boolean
  locale?: ZenlessLocale
}

// ---- Context ----

export interface ZenlessContext {
  isBold: boolean
  isItalic: boolean
  locale: ZenlessLocale
}

// ---- Message ----

export interface MessageOptions {
  message: string
  type?: 'success' | 'warning' | 'error'
  duration?: number
}

export interface MessageFn {
  (payload: string | MessageOptions): void
  success(message: string | MessageOptions): void
  warning(message: string | MessageOptions): void
  error(message: string | MessageOptions): void
}

// ---- Composables ----

export declare function useZenless(): ZenlessContext
export declare function useMessage(): MessageFn

// ---- Locale exports ----

export declare const locale: {
  de: ZenlessLocale
  en: ZenlessLocale
  es: ZenlessLocale
  fr: ZenlessLocale
  id: ZenlessLocale
  it: ZenlessLocale
  ja: ZenlessLocale
  ko: ZenlessLocale
  ru: ZenlessLocale
  zhCn: ZenlessLocale
}

// ---- Component exports ----

export declare const ZScrollbar: Component
export declare const ZButton: Component
export declare const ZIcon: Component
export declare const ZLink: Component
export declare const ZCollapse: Component
export declare const ZCollapseItem: Component
export declare const ZMenu: Component
export declare const ZMenuItem: Component
export declare const ZSubMenu: Component
export declare const ZBacktop: Component
export declare const ZTag: Component
export declare const ZBadge: Component
export declare const ZTabs: Component
export declare const ZTabPanel: Component
export declare const ZTooltip: Component
export declare const ZRadio: Component
export declare const ZRadioGroup: Component
export declare const ZRadioButton: Component
export declare const ZCheckbox: Component
export declare const ZCheckboxGroup: Component
export declare const ZCheckboxButton: Component
export declare const ZSlider: Component
export declare const ZSwitch: Component
export declare const ZInput: Component
export declare const ZTextarea: Component
export declare const ZSelect: Component
export declare const ZOption: Component
export declare const ZDropdown: Component
export declare const ZDropdownItem: Component
export declare const ZPagination: Component
export declare const ZCard: Component
export declare const ZModal: Component
export declare const ZDrawer: Component
export declare const ZMessage: Component
export declare const ZProgress: Component
export declare const ZTable: Component
export declare const ZTableColumn: Component
export declare const ZForm: Component
export declare const ZFormItem: Component
export declare const ZPattern: Component

// ---- Default export (plugin) ----

declare const ZenlessUI: {
  install(app: App, options?: ZenlessInstallOptions): void
}

export default ZenlessUI
