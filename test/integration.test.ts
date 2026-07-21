import * as path from "path";
import { describe, expect, it } from "vitest";
import { loadDeprecations } from "../src/data";
import { scanRepo } from "../src/scanner";
import { REPO_ROOT } from "./helpers";

const fixture = (name: string) => path.join(REPO_ROOT, "fixtures", name);

describe("integration: fixture repos", () => {
  it("clean repo (current aliases + prose + comments) → 0 findings", () => {
    const result = scanRepo(fixture("clean"), loadDeprecations());
    expect(result.scannedFiles).toBeGreaterThan(0); // it really did walk files
    expect(result.findings).toHaveLength(0);
  });

  it("dirty repo → known findings at known lines", () => {
    const result = scanRepo(fixture("dirty"), loadDeprecations());

    const byId = Object.fromEntries(
      result.findings.map((f) => [f.deprecation.id, f])
    );
    expect(Object.keys(byId).sort()).toEqual([
      "docusign-legacy-phone-auth",
      "hubspot-lead-status-property-readonly",
      "openai-2027-01-20-shutdown",
      "openai-assistants-api",
      "openai-legacy-retired-models",
    ]);

    const assistants = byId["openai-assistants-api"].patternMatches;
    expect(assistants).toEqual([
      { file: "src/agents.ts", line: 6, text: "beta.assistants" },
    ]);

    const retired = byId["openai-legacy-retired-models"].patternMatches;
    expect(retired).toEqual([
      { file: "src/agents.ts", line: 9, text: '"text-davinci-003"' },
    ]);

    // Legacy DocuSign recipient auth: flags the deprecated phoneAuthentication
    // object and the "Phone Auth $" idCheckConfigurationName value — but never
    // the identityVerification (IDV) replacement, which lives in fixtures/clean.
    const docusign = byId["docusign-legacy-phone-auth"].patternMatches;
    expect(docusign).toEqual([
      { file: "src/esign.ts", line: 9, text: "phoneAuthentication:" },
      { file: "src/esign.ts", line: 8, text: 'idCheckConfigurationName: "Phone Auth' },
    ]);

    // HubSpot Customer Agent Lead Status: flags the write of the soon-to-be
    // read-only contact property — but never a mere read (see fixtures/clean).
    const hubspot = byId["hubspot-lead-status-property-readonly"].patternMatches;
    expect(hubspot).toEqual([
      { file: "src/hubspot.ts", line: 7, text: "hs_customer_agent_lead_status:" },
    ]);

    // Legacy realtime model retiring Jan 20, 2027 — flags the bare quoted model
    // id, but never the gpt-realtime-2.1 replacement (see fixtures/clean).
    const realtime = byId["openai-2027-01-20-shutdown"].patternMatches;
    expect(realtime).toEqual([
      { file: "src/realtime.ts", line: 6, text: '"gpt-realtime"' },
    ]);
  });
});
