/**
 * useBenefitsModal —— 「创作权益」说明弹窗的单例状态。
 * 仿 useLoginDialog：模块级 ref，任意组件共享 open/close。
 * 弹窗实体在 app.vue 中以 <LazyBenefitsModal> 挂载。
 */
const benefitsModalVisible = ref(false);

export function useBenefitsModal() {
  const open = () => {
    benefitsModalVisible.value = true;
  };

  const close = () => {
    benefitsModalVisible.value = false;
  };

  return {
    visible: benefitsModalVisible,
    open,
    close,
  };
}
