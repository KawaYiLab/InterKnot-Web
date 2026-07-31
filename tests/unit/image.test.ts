import { describe, expect, it } from "vitest";
import { toCanonicalUrl, toMediaUrl, toNoResizeWebpUrl, toThumbUrl } from "~/utils/image";

const ESA_THUMB = "https://im.tiwat.cn/uploads/a.png?image_process=resize,w_360/format,webp/quality,q_80";
const ESA_WEBP = "https://im.tiwat.cn/uploads/a.png?image_process=format,webp/quality,q_80";
const R2_THUMB = "https://im.tiwat.cn/cdn-cgi/image/width=360,format=webp,quality=80/uploads/a.png";
const R2_WEBP = "https://im.tiwat.cn/cdn-cgi/image/format=webp,quality=80/uploads/a.png";

describe("image url helpers", () => {
  it("toThumbUrl falls back to ESA image_process for canonical urls", () => {
    expect(toThumbUrl("https://im.tiwat.cn/uploads/a.png")).toBe(ESA_THUMB);
  });

  it("toThumbUrl migrates legacy host and strips -small.webp", () => {
    expect(toThumbUrl("https://image.tiwat.cn/uploads/a.png-small.webp")).toBe(ESA_THUMB);
  });

  it("toThumbUrl preserves ESA image_process and replaces width", () => {
    const once = ESA_THUMB;
    expect(toThumbUrl(once)).toBe(once);
    expect(toThumbUrl(once, 800)).toBe(
      "https://im.tiwat.cn/uploads/a.png?image_process=resize,w_800/format,webp/quality,q_80",
    );
  });

  it("toThumbUrl preserves R2 cdn-cgi and replaces width", () => {
    expect(toThumbUrl(R2_THUMB)).toBe(R2_THUMB);
    expect(toThumbUrl(R2_THUMB, 800)).toBe(
      "https://im.tiwat.cn/cdn-cgi/image/width=800,format=webp,quality=80/uploads/a.png",
    );
  });

  it("toThumbUrl preserves blob and data URLs", () => {
    expect(toThumbUrl("blob:abc")).toBe("blob:abc");
    expect(toThumbUrl("data:image/png;base64,abc")).toBe("data:image/png;base64,abc");
  });

  it("toThumbUrl prefixes relative paths", () => {
    expect(toThumbUrl("/uploads/a.png")).toBe(ESA_THUMB);
  });

  it("toCanonicalUrl returns full original without ESA image transformation", () => {
    expect(
      toCanonicalUrl(
        "https://image.tiwat.cn/uploads/a.png?x=1&image_process=resize,w_360/format,webp/quality,q_80",
      ),
    ).toBe("https://im.tiwat.cn/uploads/a.png?x=1");
  });

  it("toCanonicalUrl strips R2 image transformation prefix", () => {
    expect(
      toCanonicalUrl(`${R2_THUMB}?x=1`),
    ).toBe("https://im.tiwat.cn/uploads/a.png?x=1");
  });

  it("toCanonicalUrl strips legacy -small.webp and prefixes relative paths", () => {
    expect(toCanonicalUrl("/uploads/a.png-small.webp")).toBe("https://im.tiwat.cn/uploads/a.png");
  });

  it("toCanonicalUrl keeps blob and data URLs", () => {
    expect(toCanonicalUrl("blob:abc")).toBe("blob:abc");
    expect(toCanonicalUrl("data:image/png;base64,abc")).toBe("data:image/png;base64,abc");
  });

  it("toMediaUrl preserves legacy image_process and migrates host", () => {
    expect(
      toMediaUrl(
        "https://image.tiwat.cn/uploads/a.png?x=1&image_process=resize,w_360/format,webp/quality,q_80",
      ),
    ).toBe(
      "https://im.tiwat.cn/uploads/a.png?x=1&image_process=resize,w_360/format,webp/quality,q_80",
    );
  });

  it("toMediaUrl preserves R2 image transformation prefix", () => {
    expect(toMediaUrl(`${R2_THUMB}?x=1`)).toBe(
      `${R2_THUMB}?x=1`,
    );
  });

  it("toMediaUrl prefixes relative paths", () => {
    expect(toMediaUrl("/uploads/a.png")).toBe("https://im.tiwat.cn/uploads/a.png");
  });

  it("toNoResizeWebpUrl falls back to ESA image_process without resize", () => {
    expect(toNoResizeWebpUrl("https://im.tiwat.cn/uploads/a.png")).toBe(ESA_WEBP);
  });

  it("toNoResizeWebpUrl removes width from ESA thumb", () => {
    expect(toNoResizeWebpUrl(ESA_THUMB)).toBe(ESA_WEBP);
  });

  it("toNoResizeWebpUrl removes width from R2 thumb", () => {
    expect(toNoResizeWebpUrl(R2_THUMB)).toBe(R2_WEBP);
  });

  it("toNoResizeWebpUrl migrates legacy host and preserves query", () => {
    expect(toNoResizeWebpUrl("https://image.tiwat.cn/uploads/a.png-small.webp?x=1")).toBe(
      "https://im.tiwat.cn/uploads/a.png?x=1&image_process=format,webp/quality,q_80",
    );
  });

  it("toNoResizeWebpUrl preserves blob and data URLs", () => {
    expect(toNoResizeWebpUrl("blob:abc")).toBe("blob:abc");
    expect(toNoResizeWebpUrl("data:image/png;base64,abc")).toBe("data:image/png;base64,abc");
  });
});
