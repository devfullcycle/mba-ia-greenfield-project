interface MailpitAddress {
  Name: string;
  Address: string;
}

export interface MailpitMessage {
  ID: string;
  From: MailpitAddress;
  To: MailpitAddress[];
  Subject: string;
}

export interface MailpitMessageDetail {
  HTML: string;
  Text: string;
}

const mailpitUrl = `http://${process.env.MAIL_HOST ?? 'mailpit'}:8025`;

export async function getMailpitMessages(): Promise<MailpitMessage[]> {
  const res = await fetch(`${mailpitUrl}/api/v1/messages`);
  const data = (await res.json()) as { messages: MailpitMessage[] };
  return data.messages ?? [];
}

export async function getMailpitMessage(
  id: string,
): Promise<MailpitMessageDetail> {
  const res = await fetch(`${mailpitUrl}/api/v1/message/${id}`);
  return res.json() as Promise<MailpitMessageDetail>;
}

export async function clearMailpitMessages(): Promise<void> {
  await fetch(`${mailpitUrl}/api/v1/messages`, { method: 'DELETE' });
}
