import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";

export default defineNuxtPlugin((nuxtApp) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // 5 分钟内视为新鲜，期间同一 queryKey 的 fetchQuery 直接返回缓存
        staleTime: 5 * 60 * 1000,
        // 10 分钟未使用才回收
        gcTime: 10 * 60 * 1000,
        // 窗口/Tab 重新获得焦点时自动重拉过期的 useQuery（命令式 fetchQuery 不受此影响，
        // 命令式部分由 cache-revalidation.client.ts 通过 visibilitychange 兜底）
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
      },
    },
  });

  nuxtApp.vueApp.use(VueQueryPlugin, {
    queryClient,
  });

  // 暴露给非 setup 上下文（例如 pinia action、composable）通过 useNuxtApp().$queryClient 使用
  return {
    provide: {
      queryClient,
    },
  };
});

declare module "#app" {
  interface NuxtApp {
    $queryClient: QueryClient;
  }
}

declare module "vue" {
  interface ComponentCustomProperties {
    $queryClient: QueryClient;
  }
}
