import { Client } from "@hubspot/api-client";

const hubspotClient = new Client({ accessToken: process.env.HUBSPOT_TOKEN });

export async function markLeadEngaged(contactId: string) {
  return hubspotClient.crm.contacts.basicApi.update(contactId, {
    properties: { hs_customer_agent_lead_status: "engaged" },
  });
}
