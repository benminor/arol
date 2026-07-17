import { Client } from "@hubspot/api-client";

// Writes the Customer Agent Lead Status property — rejected once it's read-only.
export async function markLeadStatus(client: Client, contactId: string, status: string) {
  return client.crm.contacts.basicApi.update(contactId, {
    properties: {
      hs_customer_agent_lead_status: status,
    },
  });
}
