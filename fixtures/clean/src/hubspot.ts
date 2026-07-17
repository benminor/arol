import { Client } from "@hubspot/api-client";

const hubspotClient = new Client({ accessToken: process.env.HUBSPOT_TOKEN });

export async function readLeadStatus(contactId: string) {
  const contact = await hubspotClient.crm.contacts.basicApi.getById(contactId, [
    "hs_customer_agent_lead_status",
  ]);
  return contact.properties.hs_customer_agent_lead_status;
}
