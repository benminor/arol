// Legacy DocuSign recipient auth — deliberately deprecated usage (fixture).
export function buildSigner(email: string, name: string, phone: string) {
  return {
    email,
    name,
    recipientId: "1",
    requireIdLookup: "true",
    idCheckConfigurationName: "Phone Auth $",
    phoneAuthentication: {
      recipMayProvideNumber: "false",
      senderProvidedNumbers: [phone],
    },
  };
}
