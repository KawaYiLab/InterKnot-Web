/**
 * 站点信息（联系方式 / 友情链接 / 版权）单一数据源。
 * AppFooter（个人页）与 AppSidebar（主页侧栏）共用，避免两处维护。
 */
export interface SiteLink {
  label: string;
  href: string;
}

export interface SiteLinkGroup {
  heading: string;
  links: SiteLink[];
}

export const siteLinkGroups: SiteLinkGroup[] = [
  {
    heading: "联系我们",
    links: [
      { label: "QQ", href: "https://qm.qq.com/q/6Nr24XIzBK" },
      { label: "Discord", href: "https://discord.gg/6TQpUwGvFG" },
      { label: "GitHub", href: "https://github.com/KawaYiLab/InterKnot-Web" },
    ],
  },
  {
    heading: "友情链接",
    links: [{ label: "提瓦特服务器", href: "https://mc.tiwat.cn" }],
  },
];

export const SITE_BRAND = "InterKnot";
export const SITE_TAGLINE = "新艾利都最大的匿名委托中枢。";

export const siteCopyright = (year: number = new Date().getFullYear()): string =>
  `© ${year} ${SITE_TAGLINE}`;
