import { describe, expect, it } from "vitest";
import { extractMentionIds, newMentionIds } from "./mention-logic";
import { describeEvent, digestBodyHtml, eventActorLabel, digestSubject, recipientsFor, strongestReason, type NotifyEvent } from "./notify-logic";

const ev = (o: Partial<NotifyEvent> & { kind: string }): NotifyEvent => ({ id: "e1", itemId: "i1", actorUserId: "alice", actorName: "Alice", payload: {}, ...o });
const ctx = { comments: new Map([["c1", "Looks good <b>ship</b>"]]), mentionedInComments: new Set<string>() };

describe("actor label", () => {
  it("names the user, else the app that filed it, else Someone", () => {
    expect(eventActorLabel({ actorName: "Alice", payload: { via: "Fixorata" } })).toBe("Alice");
    expect(eventActorLabel({ actorName: null, payload: { via: "Fixorata" } })).toBe("Fixorata");
    expect(eventActorLabel({ actorName: null, payload: {} })).toBe("Someone");
  });

  it("an app-filed assignment reads as the app assigning you", () => {
    const l = describeEvent(ev({ kind: "assignee_changed", actorUserId: null, actorName: null, payload: { before: null, after: { id: "bob", name: "Bob" }, via: "Fixorata" } }), "bob", ctx)!;
    expect(l.text).toContain("Fixorata");
    expect(l.text).not.toContain("Someone");
  });
});

describe("mentions", () => {
  const html = '<p>Hi <span data-type="mention" data-id="bob" data-label="Bob">@Bob</span> and <span data-label="Cy" data-id="cy" data-type="mention">@Cy</span> and <span data-id="x">no</span></p>';
  it("reads mention ids in any attribute order, ignoring other spans", () => {
    expect(extractMentionIds(html)).toEqual(["bob", "cy"]);
    expect(extractMentionIds("plain text @Bob")).toEqual([]);
  });
  it("finds only the newly added mentions on an edit", () => {
    expect(newMentionIds('<span data-type="mention" data-id="bob">@Bob</span>', html)).toEqual(["cy"]);
    expect(newMentionIds(null, html)).toEqual(["bob", "cy"]);
  });
});

describe("recipientsFor", () => {
  it("tells watchers, never the actor", () => {
    expect([...recipientsFor(ev({ kind: "comment_added" }), ["alice", "bob"]).entries()]).toEqual([["bob", "watching"]]);
  });
  it("tells a new assignee even if they don't watch", () => {
    const r = recipientsFor(ev({ kind: "assignee_changed", payload: { before: null, after: { id: "dan", name: "Dan" } } }), ["bob"]);
    expect(r.get("dan")).toBe("assigned");
    expect(r.get("bob")).toBe("watching");
  });
  it("tells the person replied to, even if they don't watch", () => {
    const r = recipientsFor(ev({ kind: "comment_added", payload: { commentId: "c1", replyToUserId: "eve" } }), ["bob"]);
    expect(r.get("eve")).toBe("mentioned");
    expect(describeEvent(ev({ kind: "comment_added", payload: { commentId: "c1", replyToUserId: "eve" } }), "eve", ctx)!.text).toBe("Alice replied to your comment");
    expect(describeEvent(ev({ kind: "comment_added", payload: { commentId: "c1", replyToUserId: "eve" } }), "bob", ctx)!.text).toBe("Alice commented");
  });

  it("mentions go only to the people mentioned", () => {
    expect([...recipientsFor(ev({ kind: "mentioned", payload: { userIds: ["bob", "alice"] } }), ["cy"]).entries()]).toEqual([["bob", "mentioned"]]);
  });
  it("sends field edits to the assignee only, and nothing for the client link", () => {
    expect([...recipientsFor(ev({ kind: "priority_changed" }), ["bob", "cy"], "dan").entries()]).toEqual([["dan", "assignee"]]);
    expect(recipientsFor(ev({ kind: "item_updated" }), ["bob"], null).size).toBe(0);
    expect(recipientsFor(ev({ kind: "item_updated" }), ["bob"], "alice").size).toBe(0); // editing your own item
    expect(recipientsFor(ev({ kind: "requester_changed" }), ["bob"], "dan").size).toBe(0);
  });
});

describe("describeEvent", () => {
  it("speaks to the assignee directly", () => {
    const l = describeEvent(ev({ kind: "assignee_changed", payload: { after: { id: "bob", name: "Bob" } } }), "bob", ctx)!;
    expect(l.personal).toBe(true);
    expect(l.html).toContain("to <b>you</b>");
  });
  it("escapes people's names and comment text", () => {
    const l = describeEvent(ev({ kind: "comment_added", actorName: "<img src=x>", payload: { commentId: "c1" } }), "bob", ctx)!;
    expect(l.html).toContain("&lt;img src=x&gt;");
    expect(l.html).toContain("Looks good &lt;b&gt;ship&lt;/b&gt;");
    expect(l.html).not.toContain("<img");
  });
  it("skips a comment line when the same comment already mentioned them", () => {
    expect(describeEvent(ev({ kind: "comment_added", payload: { commentId: "c1" } }), "bob", { ...ctx, mentionedInComments: new Set(["c1"]) })).toBeNull();
  });
  it("describes field edits", () => {
    const l = describeEvent(ev({ kind: "item_updated", payload: { fields: { title: { before: "a", after: "<New>" }, description: { changed: true }, dueOn: { before: null, after: "2026-11-20" } } } }), "dan", ctx)!;
    expect(l.html).toBe("<b>Alice</b> updated the title to “&lt;New&gt;”, the description, the due date to 2026-11-20.");
    expect(describeEvent(ev({ kind: "priority_changed", payload: { before: "medium", after: "urgent" } }), "dan", ctx)!.text).toBe("Alice set priority to Urgent");
    expect(describeEvent(ev({ kind: "parent_changed", payload: { after: { id: "e", name: "FIXO-2 Payments" } } }), "dan", ctx)!.text).toBe("Alice set the epic to FIXO-2 Payments");
  });

  it("shows status moves with the resolution", () => {
    expect(describeEvent(ev({ kind: "status_changed", payload: { before: "in_review", after: "done", resolution: "fixed" } }), "bob", ctx)!.text).toBe("Alice moved it to Done (Fixed)");
  });
});

describe("digest", () => {
  const item = { key: "FIXO-12", title: "Refund rounding", productName: "Fixorata" };
  const personal = { html: "x", text: "Alice assigned this issue to you", personal: true };
  const plain = { html: "y", text: "Alice commented", personal: false };
  it("leads with a personal event, otherwise counts updates", () => {
    expect(digestSubject(item, [personal])).toBe("[FIXO-12] Alice assigned this issue to you: Refund rounding");
    expect(digestSubject(item, [plain])).toBe("[FIXO-12] Refund rounding — Alice commented");
    expect(digestSubject(item, [personal, plain])).toBe("[FIXO-12] Refund rounding (2 updates)");
  });
  it("picks the strongest reason and escapes the title in the body", () => {
    expect(strongestReason(["watching", "mentioned"])).toBe("mentioned");
    const html = digestBodyHtml({ item: { ...item, title: "<script>" }, lines: [plain], reason: "watching", url: "u", button: "" });
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("watching this issue");
  });
});
