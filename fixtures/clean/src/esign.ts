// Modern DocuSign recipient auth via Identity Verification (IDV) — must NOT flag.
// Phone authentication is mentioned here in prose only; the code below uses the
// identityVerification workflow, which is the supported replacement.
export function buildSigner(email: string, name: string, workflowId: string) {
  return {
    email,
    name,
    recipientId: "1",
    identityVerification: {
      workflowId,
      inputOptions: [
        {
          name: "phone_number_list",
          valueType: "PhoneNumberList",
          phoneNumberList: [{ countryCode: "1", number: "5551234567" }],
        },
      ],
    },
  };
}
