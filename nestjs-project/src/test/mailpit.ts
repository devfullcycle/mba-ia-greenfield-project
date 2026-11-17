const mailpitUrl = `http://${process.env.MAIL_HOST ?? 'mailpit'}:8025`;

// Subset of the Mailpit REST API (v1) response shapes used by the tests.
export interface MailpitAddress {
  Name: string;
  Address: string;
}

export interface MailpitMessageSummary {
  ID: string;
  From: MailpitAddress;
  To: MailpitAddress[];
  Subject: string;
}

export interface MailpitMessage extends MailpitMessageSummary {
  HTML: string;
  Text: string;
}

interface MailpitMessagesResponse {
  messages: MailpitMessageSummary[] | null;
}

export async function getMailpitMessages(): Promise<MailpitMessageSummary[]> {
  const res = await fetch(`${mailpitUrl}/api/v1/messages`);
  const data = (await res.json()) as MailpitMessagesResponse;
  return data.messages ?? [];
}

export async function getMailpitMessage(id: string): Promise<MailpitMessage> {
  const res = await fetch(`${mailpitUrl}/api/v1/message/${id}`);
  return (await res.json()) as MailpitMessage;
}

export async function clearMailpitMessages(): Promise<void> {
  await fetch(`${mailpitUrl}/api/v1/messages`, { method: 'DELETE' });
}
