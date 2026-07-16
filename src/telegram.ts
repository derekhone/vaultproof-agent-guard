// vaultproof-agent-guard/src/telegram.ts
// HOLD resolution via Telegram — pings you, waits for Approve/Deny, times out to DENY.
// Setup: message @BotFather → /newbot → get token. Message your bot once,
// then get your chat ID from https://api.telegram.org/bot<TOKEN>/getUpdates

const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const TG_CHAT_ID = process.env.TELEGRAM_CHAT_ID!;
const API = `https://api.telegram.org/bot${TG_TOKEN}`;

const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000; // 5 min, then fail-closed (DENY)
const POLL_INTERVAL_MS = 2000;

export async function askTelegram(message: string): Promise<boolean> {
  // 1. Send the HOLD alert with inline Approve/Deny buttons.
  const send = await fetch(`${API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: TG_CHAT_ID,
      text: `🛑 VaultProof HOLD\n\n${message}`,
      reply_markup: {
        inline_keyboard: [[
          { text: "✅ Approve", callback_data: "vp_approve" },
          { text: "❌ Deny", callback_data: "vp_deny" },
        ]],
      },
    }),
  });
  const sent = await send.json() as { result: { message_id: number } };
  const messageId: number = sent.result.message_id;

  // 2. Poll for the button press until timeout.
  const deadline = Date.now() + APPROVAL_TIMEOUT_MS;
  let offset = 0;

  while (Date.now() < deadline) {
    const res = await fetch(`${API}/getUpdates?offset=${offset}&timeout=1`);
    const { result: updates } = await res.json() as { result: any[] };

    for (const u of updates ?? []) {
      offset = u.update_id + 1;
      const cb = u.callback_query;
      if (!cb || cb.message?.message_id !== messageId) continue;
      if (String(cb.message.chat.id) !== TG_CHAT_ID) continue; // only the owner chat can approve

      const approved = cb.data === "vp_approve";

      // Acknowledge + edit message so the decision is recorded in-chat.
      await fetch(`${API}/answerCallbackQuery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callback_query_id: cb.id, text: approved ? "Approved" : "Denied" }),
      });
      await fetch(`${API}/editMessageText`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: TG_CHAT_ID,
          message_id: messageId,
          text: `${approved ? "✅ APPROVED" : "❌ DENIED"} by human\n\n${message}`,
        }),
      });
      return approved;
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  // 3. Timeout → fail-closed.
  await fetch(`${API}/editMessageText`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: TG_CHAT_ID,
      message_id: messageId,
      text: `⏱️ TIMED OUT → DENIED (fail-closed)\n\n${message}`,
    }),
  });
  return false;
}
