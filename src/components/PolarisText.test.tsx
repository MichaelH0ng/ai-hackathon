import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PolarisText } from "./PolarisText";

const html = (text: string) => renderToStaticMarkup(<PolarisText text={text} />);

describe("PolarisText", () => {
  it("renders bold and italics", () => {
    expect(html("You have **$1,200** saved, an *index fund* idea.")).toContain("<strong>$1,200</strong>");
    expect(html("An *index fund* tracks a market.")).toContain("<em>index fund</em>");
    expect(html("A __big__ and _small_ word.")).toMatch(/<strong>big<\/strong>.*<em>small<\/em>/);
  });

  it("leaves snake_case and lone asterisks alone", () => {
    const out = html("Use net_cash_flow and 5 * 3 = 15.");
    expect(out).not.toContain("<em>");
    expect(out).toContain("net_cash_flow");
  });

  it("builds bullet and numbered lists, including • bullets", () => {
    expect(html("Options:\n- Roth IRA\n- 401(k)")).toContain("<ul><li>Roth IRA</li><li>401(k)</li></ul>");
    expect(html("• One\n• Two")).toContain("<ul><li>One</li><li>Two</li></ul>");
    expect(html("1. Save\n2. Invest")).toContain("<ol><li>Save</li><li>Invest</li></ol>");
  });

  it("splits paragraphs on blank lines and never injects HTML", () => {
    const out = html("First.\n\nSecond <b>x</b>");
    expect(out.match(/<p>/g)).toHaveLength(2);
    expect(out).toContain("&lt;b&gt;");
  });

  it("wraps each word for the fade-in when animating", () => {
    const out = renderToStaticMarkup(<PolarisText text="Hi **there** friend" animate />);
    expect(out.match(/class="polaris-word"/g)).toHaveLength(3);
  });
});
