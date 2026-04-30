const mailpitUrl = `http://${process.env.MAIL_HOST ?? 'mailpit'}:8025`;

export async function getMailpitMessages(): Promise<any[]> {
  const res = await fetch(`${mailpitUrl}/api/v1/messages`);
  const data = await res.json() as { messages: any[] };
  return data.messages ?? [];
}

export async function getMailpitMessage(id: string): Promise<any> {
  const res = await fetch(`${mailpitUrl}/api/v1/message/${id}`);
  return res.json();
}

export async function clearMailpitMessages(): Promise<void> {
  await fetch(`${mailpitUrl}/api/v1/messages`, { method: 'DELETE' });
}
