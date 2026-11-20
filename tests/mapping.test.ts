import { describe, expect, it } from "vitest";
import { mapHeaders, parseRows, rowKey, locate, colLetter, extractSpreadsheetId, alreadyOnLinkedin } from "@/lib/sheets/mapping";

// Real headers from TensorTonic Sponsor Targeting (Nov 2026)
const VOICE = ["Outreach Status", "Owner", "Linkedin", "First Name", "Last Name", "Title", "Company Name", "To", "Departments", "Person Linkedin Url", "Website", "Company Linkedin Url", "Twitter Url", "Why it is voice AI"];
const DEV = ["Outreach Status", "Owner", "Linkedin", "Name", "Title", "Company Name", "Email", "Person Linkedin Url", "Website", "Company Linkedin Url", "Twitter Url", "Why it is dev tooling"];

describe("header mapping", () => {
  it("maps the Voice AI tab (To as email, Why it is… as reason)", () => {
    const m = mapHeaders(VOICE);
    expect(m.fields.email).toBe(7);
    expect(m.fields.company).toBe(6);
    expect(m.fields.categoryReason).toBe(13);
    expect(m.fields.twitter).toBe(12);
    expect(m.fields.linkedinStatus).toBe(2);
    expect(m.canDraft).toBe(true);
    expect(m.missingAi).toHaveLength(19);
  });

  it("maps the Dev Tooling tab (single Name column, Email)", () => {
    const m = mapHeaders(DEV);
    expect(m.fields.name).toBe(3);
    expect(m.fields.email).toBe(6);
    expect(m.fields.firstName).toBeUndefined();
    expect(m.canDraft).toBe(true);
  });

  it("is case-insensitive and blocks drafting when email/company are missing", () => {
    const m = mapHeaders(["outreach status", "COMPANY", "first name"]);
    expect(m.fields.company).toBe(1);
    expect(m.canDraft).toBe(false);
    expect(m.warnings.join(" ")).toMatch(/Email/);
  });

  it("splits Name into first and last", () => {
    const m = mapHeaders(DEV);
    const rows = parseRows([DEV, ["Message Done", "Shivam", "None", "Harry Du", "Founding Engineer", "AgentMail (YC S25)", "harry@agentmail.cc", "", "https://agentmail.to", "", "", "Developers call its API"]], m);
    expect(rows[0].firstName).toBe("Harry");
    expect(rows[0].lastName).toBe("Du");
    expect(rows[0].key).toBe("harry@agentmail.cc|agentmail (yc s25)");
    expect(rows[0].sheetRow).toBe(2);
  });

  it("treats Twitter Url as the company handle, skips blank rows", () => {
    const m = mapHeaders(VOICE);
    const rows = parseRows([VOICE, [], ["", "", "None", "Daniel", "Rasmussen", "Co-Founder", "Applied Brain Research", "Daniel.Rasmussen@ABR.com", "", "", "", "", "https://twitter.com/abr_inc", "SDK"]], m);
    expect(rows).toHaveLength(1);
    expect(rows[0].companyTwitter).toBe("https://twitter.com/abr_inc");
    expect(rows[0].sheetRow).toBe(3);
    expect(rows[0].key).toBe("daniel.rasmussen@abr.com|applied brain research");
  });

  it("reads AI columns once they exist", () => {
    const headers = [...VOICE, "AI Draft Status", "AI Email Body"];
    const m = mapHeaders(headers);
    expect(m.missingAi).toHaveLength(17);
    const rows = parseRows([headers, ["", "", "", "A", "B", "", "Co", "a@co.com", "", "", "", "", "", "", "Drafted", "Hi A,"]], m);
    expect(rows[0].ai["AI Draft Status"]).toBe("Drafted");
  });
});

describe("row identity", () => {
  it("refuses missing and duplicate keys", () => {
    const k = rowKey("A@x.com ", "Acme");
    const ps = [{ key: k }, { key: "b|c" }, { key: "b|c" }] as never[];
    expect(locate(ps, k).prospect).not.toBeNull();
    expect(locate(ps, "b|c")).toMatchObject({ prospect: null, matches: 2 });
    expect(locate(ps, "nope")).toMatchObject({ prospect: null, matches: 0 });
  });
  it("column letters", () => {
    expect(colLetter(0)).toBe("A");
    expect(colLetter(25)).toBe("Z");
    expect(colLetter(26)).toBe("AA");
    expect(colLetter(32)).toBe("AG");
  });
  it("sheet id from url", () => {
    expect(extractSpreadsheetId("https://docs.google.com/spreadsheets/d/1NApt8DQNuzOTgyZ9U6IVJPokJh0GgD-ed45dwvxRAE0/edit#gid=0")).toBe("1NApt8DQNuzOTgyZ9U6IVJPokJh0GgD-ed45dwvxRAE0");
    expect(extractSpreadsheetId("hello")).toBeNull();
  });
  it("LinkedIn column: None means not contacted", () => {
    expect(alreadyOnLinkedin({ linkedinStatus: "None" })).toBe(false);
    expect(alreadyOnLinkedin({ linkedinStatus: "" })).toBe(false);
    expect(alreadyOnLinkedin({ linkedinStatus: "Pratham" })).toBe(true);
  });
});
