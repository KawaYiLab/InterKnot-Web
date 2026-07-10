import { describe, expect, it } from "vitest";
import { toCanonicalUrl, toMediaUrl, toThumbUrl } from "~/utils/image";

describe("image url helpers", () => {
  it("toThumbUrl appends image_process for new host", () => {
    expect(toThumbUrl("https://im.tiwat.cn/uploads/a.png")).toBe(
      "https://im.tiwat.cn/uploads/a.png?image_process=resize,w_360/format,webp/quality,q_80",
    );
  });

  it("toThumbUrl migrates legacy host and strips -small.webp", () => {
    expect(toThumbUrl("https://image.tiwat.cn/uploads/a.png-small.webp")).toBe(
      "https://im.tiwat.cn/uploads/a.png?image_process=resize,w_360/format,webp/quality,q_80",
    );
  });

  it("toThumbUrl is idempotent", () => {
    const once =
      "https://im.tiwat.cn/uploads/a.png?image_process=resize,w_360/format,webp/quality,q_80";
    expect(toThumbUrl(once)).toBe(once);
  });

  it("toThumbUrl preserves blob and data URLs", () => {
    expect(toThumbUrl("blob:abc")).toBe("blob:abc");
    expect(toThumbUrl("data:image/png;base64,abc")).toBe("data:image/png;base64,abc");
  });

  it("toThumbUrl prefixes relative paths", () => {
    expect(toThumbUrl("/uploads/a.png")).toBe(
      "https://im.tiwat.cn/uploads/a.png?image_process=resize,w_360/format,webp/quality,q_80",
    );
  });

  it("toCanonicalUrl returns full original without image_process", () => {
    expect(
      toCanonicalUrl(
        "https://image.tiwat.cn/uploads/a.png?x=1&image_process=resize,w_360/format,webp/quality,q_80",
      ),
    ).toBe("https://im.tiwat.cn/uploads/a.png?x=1");
  });

  it("toCanonicalUrl strips legacy -small.webp and prefixes relative paths", () => {
    expect(toCanonicalUrl("/uploads/a.png-small.webp")).toBe("https://im.tiwat.cn/uploads/a.png");
  });

  it("toCanonicalUrl keeps blob and data URLs", () => {
    expect(toCanonicalUrl("blob:abc")).toBe("blob:abc");
    expect(toCanonicalUrl("data:image/png;base64,abc")).toBe("data:image/png;base64,abc");
  });

  it("toMediaUrl preserves image_process and migrates host", () => {
    expect(
      toMediaUrl(
        "https://image.tiwat.cn/uploads/a.png?x=1&image_process=resize,w_360/format,webp/quality,q_80",
      ),
    ).toBe(
      "https://im.tiwat.cn/uploads/a.png?x=1&image_process=resize,w_360/format,webp/quality,q_80",
    );
  });

  it("toMediaUrl prefixes relative paths", () => {
    expect(toMediaUrl("/uploads/a.png")).toBe("https://im.tiwat.cn/uploads/a.png");
  });
});
