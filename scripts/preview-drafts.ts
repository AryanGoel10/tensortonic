/**
 * M2 quality check. Runs the real research + drafting pipeline on the first N eligible rows
 * of a tab and writes a Markdown review table. Does NOT write to the sheet or the database.
 *
 *   npx tsx scripts/preview-drafts.ts "Voice AI" 10
 *
 * Needs GOOGLE_SERVICE_ACCOUNT_JSON, FIRECRAWL_API_KEY, ANTHROPIC_API_KEY (and optional CLAUDE_MODEL) in .env.local
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();
import { writeFileSync } from "node:fs";
import { readTab } from "@/lib/sheets/client";
import { buildResearchPack } from "@/lib/research/firecrawl";
import { generateDraft, model } from "@/lib/ai/generate";
import { DEFAULT_SETTINGS } from "@/lib/settings-defaults";
import { eligible, resolveCampaign } from "@/lib/eligibility";

const SHEET = process.env.PREVIEW_SHEET_ID || "1NApt8DQNuzOTgyZ9U6IVJPokJh0GgD-ed45dwvxRAE0";
const tab = process.argv[2] || "Voice AI";
const n = Number(process.argv[3] || 10);

const cell = (s: string) => (s || "").replace(/\|/g, "\\|").replace(/\n+/g, "<br>");

async function main() {
  const { prospects, map } = await readTab(SHEET, tab);
  if (!map.canDraft) throw new Error(map.warnings.join(" "));
  const rows = prospects.filter((p) => eligible(p, "Auto", DEFAULT_SETTINGS.excludedCompanies)).slice(0, n);
  console.log(`${tab}: drafting ${rows.length} rows with ${model()}`);

  const table: string[] = [
    `# Draft preview: ${tab} (${new Date().toISOString().slice(0, 16)} UTC, ${model()})`,
    "",
    "| # | Person | Hook | Challenge idea | Person X | Checks |",
    "|---|---|---|---|---|---|",
  ];
  const details: string[] = [];
  let credits = 0;

  for (const [i, p] of rows.entries()) {
    process.stdout.write(`  ${i + 1}. ${p.firstName} ${p.lastName} (${p.company}) … `);
    try {
      const pack = await buildResearchPack(p, (m) => console.warn(`\n     warn: ${m}`));
      credits += pack.creditsUsed;
      const campaign = resolveCampaign(p, "Auto");
      const { draft, validation, attempts } = await generateDraft(p, pack, campaign, DEFAULT_SETTINGS);
      const x = pack.personX ? `${pack.personX.url} (${pack.personX.confidence})` : "none found";
      const checks = [...validation.hard.map((h) => `**FAIL** ${h}`), ...validation.soft].join("<br>") || "all pass";
      table.push(`| ${i + 1} | ${cell(`${p.firstName} ${p.lastName}, ${p.title}, ${p.company}`)} | ${cell(draft.hook)}<br><sub>${draft.hook_source_url}</sub> | ${cell(draft.challenge_idea)} | ${cell(x)} | ${cell(checks)} |`);
      details.push(
        `## ${i + 1}. ${p.firstName} ${p.lastName} (${p.company})`,
        `Campaign: ${campaign} · Confidence: ${draft.confidence} · Claude calls: ${attempts} · Firecrawl credits: ${pack.creditsUsed} · LinkedIn already contacted: ${p.linkedinStatus || "None"}`,
        "",
        `**Research summary:** ${draft.research_summary}`,
        "",
        `**Subject:** ${draft.email_subject}`,
        "",
        "```",
        draft.email_body.replace("{{SENDER_SIGNATURE}}", DEFAULT_SETTINGS.signature),
        "```",
        `**LinkedIn (${[...draft.linkedin_note].length}/280):** ${draft.linkedin_note}`,
        "",
        `**X DM (${[...draft.x_dm].length}/280):** ${draft.x_dm}`,
        "",
        `Sources: ${pack.urls.join(", ")}`,
        "",
      );
      console.log(validation.ok ? "ok" : `needs review (${validation.hard.join(", ")})`);
    } catch (err) {
      console.log(`failed: ${(err as Error).message}`);
      table.push(`| ${i + 1} | ${cell(`${p.firstName} ${p.lastName}, ${p.company}`)} | failed: ${cell((err as Error).message)} | | | |`);
    }
  }

  const out = `preview-${tab.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.md`;
  writeFileSync(out, [...table, "", `Firecrawl credits used: ${credits}`, "", "---", "", ...details].join("\n"));
  console.log(`\nWrote ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
