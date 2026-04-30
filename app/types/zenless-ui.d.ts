declare module "zenless-ui" {
  import type { App, Component } from "vue";

  export type ZenlessSize = "extra" | "large" | "small" | "mini";
  export type ZenlessColor =
    | "default" | "primary" | "success" | "danger" | "warning" | "info"
    | "ether" | "fire" | "electric" | "ice" | "physical";

  export interface ZenlessLocaleData {
    modal: { cancel: string; confirm: string };
    pagination: { prev: string; next: string };
    select: { empty: string };
    table: { empty: string };
  }

  export interface ZenlessLocale {
    name: string;
    data: ZenlessLocaleData;
  }

  export interface ZenlessInstallOptions {
    isBold?: boolean;
    isItalic?: boolean;
    locale?: ZenlessLocale;
  }

  export interface ZenlessContext {
    isBold: boolean;
    isItalic: boolean;
    locale: ZenlessLocale;
  }

  export interface MessageOptions {
    message: string;
    type?: "success" | "warning" | "error";
    duration?: number;
  }

  export interface MessageFn {
    (payload: string | MessageOptions): void;
    success(message: string | MessageOptions): void;
    warning(message: string | MessageOptions): void;
    error(message: string | MessageOptions): void;
  }

  export function useZenless(): ZenlessContext;
  export function useMessage(): MessageFn;

  export const locale: {
    de: ZenlessLocale;
    en: ZenlessLocale;
    es: ZenlessLocale;
    fr: ZenlessLocale;
    id: ZenlessLocale;
    it: ZenlessLocale;
    ja: ZenlessLocale;
    ko: ZenlessLocale;
    ru: ZenlessLocale;
    zhCn: ZenlessLocale;
  };

  export const ZScrollbar: Component;
  export const ZButton: Component;
  export const ZIcon: Component;
  export const ZLink: Component;
  export const ZCollapse: Component;
  export const ZCollapseItem: Component;
  export const ZMenu: Component;
  export const ZMenuItem: Component;
  export const ZSubMenu: Component;
  export const ZBacktop: Component;
  export const ZTag: Component;
  export const ZBadge: Component;
  export const ZTabs: Component;
  export const ZTabPanel: Component;
  export const ZTooltip: Component;
  export const ZRadio: Component;
  export const ZRadioGroup: Component;
  export const ZRadioButton: Component;
  export const ZCheckbox: Component;
  export const ZCheckboxGroup: Component;
  export const ZCheckboxButton: Component;
  export const ZSlider: Component;
  export const ZSwitch: Component;
  export const ZInput: Component;
  export const ZTextarea: Component;
  export const ZSelect: Component;
  export const ZOption: Component;
  export const ZDropdown: Component;
  export const ZDropdownItem: Component;
  export const ZPagination: Component;
  export const ZCard: Component;
  export const ZModal: Component;
  export const ZDrawer: Component;
  export const ZMessage: Component;
  export const ZProgress: Component;
  export const ZTable: Component;
  export const ZTableColumn: Component;
  export const ZForm: Component;
  export const ZFormItem: Component;
  export const ZPattern: Component;

  const ZenlessUI: {
    install(app: App, options?: ZenlessInstallOptions): void;
  };
  export default ZenlessUI;
}

declare module "zenless-ui/index.css" {}
