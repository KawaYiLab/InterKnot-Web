<script setup lang="ts">
import type { ExternalVideo } from "~/types/entities";

interface Props {
  video: ExternalVideo;
}

defineProps<Props>();
</script>

<template>
  <div v-if="video.embedUrl" class="ik-bilibili-player">
    <iframe
      :src="video.embedUrl"
      class="ik-bilibili-player__iframe"
      title="Bilibili video player"
      frameborder="0"
      allowfullscreen
      scrolling="no"
      referrerpolicy="no-referrer"
      sandbox="allow-same-origin allow-scripts allow-popups"
    ></iframe>
  </div>
</template>

<style scoped>
.ik-bilibili-player {
  position: relative;
  width: 100%;
  padding-top: 56.25%; /* 16:9 */
  border-radius: 8px;
  overflow: hidden;
  background: #000;
}

.ik-bilibili-player__iframe {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: none;
}
</style>
