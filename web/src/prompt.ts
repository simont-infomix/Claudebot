/**
 * The bridge between the two halves of the tool: the wall is where you decide, the agent is where
 * it gets done, and the only thing that has to travel between them is the item number. This turns
 * a note into a ready-to-paste instruction so you never have to retype it.
 */

/** Hungarian on purpose: this is text *you* paste into a chat, not a tool description. */
export function ticketPrompt(todo: { id: number; title: string }): string {
  return (
    `#${todo.id} – ${todo.title}\n\n` +
    `Olvasd ki a részleteket a todo-mcp get_ticket(${todo.id}) toolljával ` +
    `(leírás és a hozzá írt megjegyzéseim), és valósítsd meg. ` +
    `Ha kész vagy, az update_ticket toollal jegyezd fel, mi lett belőle.`
  );
}

/**
 * `navigator.clipboard` needs a secure context — loopback counts as one, so this works in the
 * installed app too. Anything else (a denied permission, an odd browser) surfaces as an error
 * rather than silently doing nothing.
 */
export async function copyTicketPrompt(
  todo: { id: number; title: string },
  onNotice: (message: string) => void,
  onError: (message: string) => void,
): Promise<void> {
  try {
    await navigator.clipboard.writeText(ticketPrompt(todo));
    onNotice(`#${todo.id} promptja a vágólapon`);
  } catch {
    onError('A vágólap nem érhető el.');
  }
}
