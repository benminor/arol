import { Client } from "@hubspot/api-client";

// Reads the (soon to be read-only) lead status — reading remains supported.
export async function getLeadStatus(client: Client, contactId: string) {
  const contact = await client.crm.contacts.basicApi.getById(contactId, [
    "hs_customer_agent_lead_status",
  ]);
  return contact.properties.hs_customer_agent_lead_status;
}
