<template>
  <footer class="app-footer">
    <div class="app-footer__inner">
      <div class="app-footer__brand">
        <span class="app-footer__logo">InterKnot</span>
        <span class="app-footer__copy">&copy; {{ year }} 新艾利都最大的匿名委托中枢。</span>
      </div>

      <div class="app-footer__links">
        <div class="app-footer__group">
          <h4 class="app-footer__heading">联系我们</h4>
          <ul class="app-footer__list">
            <li>
              <a
                href="https://qm.qq.com/q/6Nr24XIzBK"
                target="_blank"
                rel="noopener noreferrer"
              >
                QQ
              </a>
            </li>
            <li>
              <a
                href="http://discord.gg/6TQpUwGvFG"
                target="_blank"
                rel="noopener noreferrer"
              >
                Discord
              </a>
            </li>
            <li>
              <a
                href="https://github.com/KawaYiLab/InterKnot-Web"
                target="_blank"
                rel="noopener noreferrer"
              >
                GitHub
              </a>
            </li>
          </ul>
        </div>

        <div class="app-footer__group">
          <h4 class="app-footer__heading">友情链接</h4>
          <ul class="app-footer__list">
            <li>
              <a
                href="https://mc.tiwat.cn"
                target="_blank"
                rel="noopener noreferrer"
              >
                提瓦特服务器
              </a>
            </li>
          </ul>
        </div>
      </div>
    </div>
  </footer>
</template>

<script setup lang="ts">
const year = new Date().getFullYear();
</script>

<style scoped>
.app-footer {
  width: 100%;
  background: #0d0d0d;
  border-top: 1px solid #1e1e1e;
  color: #999;
  font-size: 14px;
  line-height: 1.6;
}

.app-footer__inner {
  width: min(1200px, calc(100% - 40px));
  margin: 0 auto;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 40px;
  padding: 48px 0 32px;
}

.app-footer__brand {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.app-footer__logo {
  font-size: 20px;
  font-weight: 800;
  color: #fff;
  letter-spacing: 0.5px;
}

.app-footer__copy {
  font-size: 12px;
  color: #666;
}

.app-footer__links {
  display: flex;
  gap: 64px;
}

.app-footer__group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.app-footer__heading {
  margin: 0;
  font-size: 13px;
  font-weight: 700;
  color: #ccc;
  text-transform: uppercase;
  letter-spacing: 1px;
}

.app-footer__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.app-footer__list a {
  color: #888;
  text-decoration: none;
  transition: color 0.2s;
  font-size: 13px;
}

.app-footer__list a:hover {
  color: #fff;
}

@media (max-width: 640px) {
  .app-footer__inner {
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 24px;
    padding: 28px 0 calc(24px + env(safe-area-inset-bottom, 0px));
  }

  .app-footer__brand {
    align-items: center;
    gap: 6px;
  }

  .app-footer__links {
    width: 100%;
    justify-content: center;
    gap: 56px;
    flex-wrap: wrap;
  }

  .app-footer__group {
    align-items: center;
  }

  .app-footer__list {
    align-items: center;
  }
}
</style>
