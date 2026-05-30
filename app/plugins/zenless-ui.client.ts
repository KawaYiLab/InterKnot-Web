import ZenlessUI from "zenless-ui";
import "zenless-ui/index.css";

export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.use(ZenlessUI, {
    isBold: true,
  });
});
