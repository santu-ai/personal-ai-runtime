import { describe, expect, it } from "vitest";
import { actorLabel } from "./actorLabels";

describe("actorLabel", () => {
  it("writes the same Chinese names the timeline badge and provenance sentence share", () => {
    expect(actorLabel("user")).toBe("你");
    expect(actorLabel(" scheduler ")).toBe("定时");
    expect(actorLabel("system")).toBe("系统");
    expect(actorLabel("api")).toBe("本机");
    expect(actorLabel("brain")).toBe("AI");
    expect(actorLabel("extractor")).toBe("AI");
    expect(actorLabel("local_llm")).toBe("AI");
    expect(actorLabel("agent:planner")).toBe("AI");
    expect(actorLabel("agent:")).toBe("AI");
  });

  it("keeps an unknown actor and drops a blank one", () => {
    expect(actorLabel("custom_bot")).toBe("custom_bot");
    expect(actorLabel("  ")).toBe("");
    expect(actorLabel(null)).toBe("");
    expect(actorLabel(undefined)).toBe("");
  });
});
