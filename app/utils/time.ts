export function formatTime(dateStr?: string): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "刚刚";
  if (mins < 60) return `${mins}分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}天前`;
  const md = `${d.getMonth() + 1}月${d.getDate()}日`;
  // 今年只显示「月日」，跨年才带上年份；用更符合中文习惯的「年月日」
  return d.getFullYear() === now.getFullYear() ? md : `${d.getFullYear()}年${md}`;
}

/** 完整时间戳（消息时间 hover 详情）：今年 M月D日 HH:mm:ss，跨年 YYYY年M月D日 HH:mm:ss；无效输入返回空串 */
export function formatFullTime(dateStr?: string): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  const md = `${d.getMonth() + 1}月${d.getDate()}日`;
  const date = d.getFullYear() === new Date().getFullYear() ? md : `${d.getFullYear()}年${md}`;
  return `${date} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
