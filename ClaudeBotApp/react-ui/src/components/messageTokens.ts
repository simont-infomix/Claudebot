/** Egy chat-üzenet szövegének darabjai. A `link` a megnyitható hivatkozás, a `code` a backtickes
 *  jelölés, ami nem bizonyult útvonalnak (tool- és paraméternevek). */
export type MessageToken =
  | { kind: 'text'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'link'; label: string; target: string; isPath: boolean };

/**
 * Egyetlen minta, alternációval — a sorrend számít, mert az első illeszkedő ág nyer. A markdown
 * link azért áll elöl, hogy a benne lévő URL ne szakadjon ki külön tokenné.
 *
 * Csupasz (backtick nélküli) relatív útvonalnál szándékosan megköveteljük a mappa-elválasztót:
 * enélkül minden „Node.js”, „stb.ez” és verziószám fájlnévnek látszana. A botok a fájlneveket
 * jellemzően backtickbe teszik, azt pedig a `code` ág fogja el — így a `README.md` is link lesz,
 * ha a bot tényleg fájlként hivatkozott rá.
 */
const TOKEN_PATTERN = new RegExp(
  [
    String.raw`\[(?<mdText>[^\]\n]+)\]\((?<mdHref>[^)\s]+)\)`,
    String.raw`(?<url>https?:\/\/[^\s<>"'\`\]]+)`,
    String.raw`\`(?<code>[^\`\n]+)\``,
    String.raw`(?<abs>[A-Za-z]:[\\/][^\s"'<>|?*]+)`,
    String.raw`(?<rel>[\w.\-]+(?:[/\\][\w.\-]+)+\.[A-Za-z]\w{1,4})`,
  ].join('|'),
  'g',
);

/** Útvonalnak látszik-e: kiterjesztéssel záruló név, vagy meghajtóbetűs abszolút út. A kiterjesztés
 *  első karaktere kötelezően betű — így a „3.5” és az „1.0.0” nem minősül fájlnak. */
const PATH_LIKE = /^(?:[A-Za-z]:[\\/])?[\w.\-]+(?:[/\\][\w.\-]+)*\.[A-Za-z]\w{0,9}$/;

/** A mondatvégi írásjel nem a cím része. A zárójelet szándékosan nem vágjuk le: az lehet valódi
 *  URL-rész, és a mintánk amúgy sem engedi a nyitó zárójelet. */
function splitTrailingPunctuation(value: string): [string, string] {
  const match = value.match(/[.,;:!?]+$/);
  if (!match) return [value, ''];
  return [value.slice(0, -match[0].length), match[0]];
}

export function tokenizeMessage(text: string): MessageToken[] {
  const tokens: MessageToken[] = [];
  let lastIndex = 0;

  function pushText(value: string) {
    if (!value) return;
    const previous = tokens[tokens.length - 1];
    if (previous?.kind === 'text') {
      previous.text += value;
    } else {
      tokens.push({ kind: 'text', text: value });
    }
  }

  for (const match of text.matchAll(TOKEN_PATTERN)) {
    const groups = match.groups ?? {};
    const start = match.index ?? 0;

    pushText(text.slice(lastIndex, start));
    lastIndex = start + match[0].length;

    if (groups.mdText && groups.mdHref) {
      tokens.push({
        kind: 'link',
        label: groups.mdText,
        target: groups.mdHref,
        isPath: !/^https?:\/\//i.test(groups.mdHref),
      });
    } else if (groups.url) {
      const [url, trailing] = splitTrailingPunctuation(groups.url);
      tokens.push({ kind: 'link', label: url, target: url, isPath: false });
      pushText(trailing);
    } else if (groups.code) {
      if (PATH_LIKE.test(groups.code)) {
        tokens.push({ kind: 'link', label: groups.code, target: groups.code, isPath: true });
      } else {
        tokens.push({ kind: 'code', text: groups.code });
      }
    } else if (groups.abs || groups.rel) {
      const [path, trailing] = splitTrailingPunctuation((groups.abs ?? groups.rel)!);
      tokens.push({ kind: 'link', label: path, target: path, isPath: true });
      pushText(trailing);
    }
  }

  pushText(text.slice(lastIndex));
  return tokens;
}
