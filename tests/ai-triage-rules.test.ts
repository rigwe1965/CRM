import { describe, expect, it } from "vitest";
import { asksToStop } from "@/lib/ai/triage/rules";

describe("asksToStop (a rule, not the model)", () => {
  it.each(["STOP", "stop", "Stop.", "  unsubscribe ", "UNSUBSCRIBE!", "opt out", "Cancel", "please stop messaging me", "Stop sending me messages", "remove me from this list", "Take me off your list please", "do not contact me again", "Don't message me", "leave me alone", "no more messages"])("catches %j", (t) => {
    expect(asksToStop(t)).toBe(true);
  });

  it.each(["", "   ", "Hi, I want to order 3 bundles", "Please don't stop the delivery, I need it Friday", "I can't stop by today", "Thanks, the stop at the station was fine", "bus stop near my house", "Can you cancel my order and send a new one with a closure?"])("leaves %j alone", (t) => {
    expect(asksToStop(t)).toBe(false);
  });

  it("does not scan a long message: a stop word in a paragraph is rarely a request", () => {
    expect(asksToStop(`${"I would like to talk about my order. ".repeat(10)} stop messaging me`)).toBe(false);
  });
});
