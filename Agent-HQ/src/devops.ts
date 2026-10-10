/**
 * The only place that talks to Azure DevOps. It knows HTTP and nothing about our data model —
 * `service.ts` is what decides *when* a call happens and what to do with the result.
 *
 * Everything here is cloud Azure DevOps Services (`dev.azure.com/{org}`). A work item id is unique
 * within the organization, so the project name never has to be configured: the read hands it back
 * in `System.TeamProject`, and we keep it only to build a clickable link.
 */

/** What the settings panel stores. A config is only usable once the org and the PAT are both set. */
export type DevOpsConfig = {
  org: string;
  pat: string;
  /** The state name our `in_progress` maps to, e.g. "Folyamatban". */
  stateInProgress: string;
  /** The state name our `closed` maps to, e.g. "Megoldva". */
  stateClosed: string;
};

/** The slice of a work item we care about. The two long fields arrive as HTML and leave as text. */
export type WorkItem = {
  id: number;
  type: string;
  title: string;
  state: string;
  project: string;
  /** `System.Description`, converted to markdown. Empty when the field is absent or blank. */
  description: string;
  /** `Microsoft.VSTS.Common.AcceptanceCriteria`, likewise. Not every work item type has it. */
  acceptanceCriteria: string;
};

/**
 * A failed call, already phrased for the human — this text is stored on the link and rendered in
 * the UI, so it is Hungarian like the rest of the user-facing strings. The PAT never reaches it.
 */
export class DevOpsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DevOpsError';
  }
}

const API_VERSION = '7.1';

/** Short on purpose: the local status change has already happened, nothing waits on the answer. */
const TIMEOUT_MS = 10_000;

/** The two long fields, which are rich text (HTML) on the DevOps side. */
const FIELD_DESCRIPTION = 'System.Description';
const FIELD_ACCEPTANCE = 'Microsoft.VSTS.Common.AcceptanceCriteria';

/** True when there is enough here to attempt a call at all. */
export function isConfigured(config: DevOpsConfig | null): config is DevOpsConfig {
  return config !== null && config.org.trim() !== '' && config.pat !== '';
}

function orgUrl(config: DevOpsConfig): string {
  return `https://dev.azure.com/${encodeURIComponent(config.org.trim())}`;
}

/** Where the human should land when they click the work item number on a note. */
export function browseUrl(org: string, project: string, workItemId: number): string {
  const base = `https://dev.azure.com/${encodeURIComponent(org.trim())}`;
  const scope = project ? `/${encodeURIComponent(project)}` : '';
  return `${base}${scope}/_workitems/edit/${workItemId}`;
}

/**
 * What the human pasted into the link field: a bare number, `#1234`, or any work item URL. Only
 * the id is taken from a URL — the project comes back authoritatively from the work item itself.
 */
export function parseWorkItemRef(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;

  const bare = /^#?(\d+)$/.exec(trimmed);
  if (bare) return Number(bare[1]);

  const fromPath = /_workitems\/edit\/(\d+)/i.exec(trimmed);
  if (fromPath) return Number(fromPath[1]);

  // Older links and some deep links carry the id in the query string instead.
  const fromQuery = /[?&]workitem=(\d+)/i.exec(trimmed);
  if (fromQuery) return Number(fromQuery[1]);

  return null;
}

/** PAT auth is HTTP Basic with an empty username. Built per call; never logged. */
function authHeader(config: DevOpsConfig): string {
  return `Basic ${Buffer.from(`:${config.pat}`).toString('base64')}`;
}

type RequestOptions = { method?: string; body?: unknown; contentType?: string };

async function call<T>(config: DevOpsConfig, url: string, options: RequestOptions = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? 'GET',
      headers: {
        Authorization: authHeader(config),
        Accept: 'application/json',
        ...(options.body === undefined
          ? {}
          : { 'Content-Type': options.contentType ?? 'application/json' }),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    const name = (error as Error)?.name;
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new DevOpsError('Az Azure DevOps nem válaszolt időben.');
    }
    throw new DevOpsError('Az Azure DevOps nem érhető el.');
  }

  if (!response.ok) throw new DevOpsError(await describeFailure(response));

  /*
   * A 200 is not proof of success here. Azure DevOps answers an unusable token by serving the
   * sign-in page — HTML, status 200 — instead of a 401, so anything that is not JSON is treated as
   * an authentication failure rather than allowed to blow up the JSON parser.
   */
  if (!(response.headers.get('content-type') ?? '').includes('json')) {
    throw new DevOpsError(
      'Az Azure DevOps bejelentkezési oldallal válaszolt – valószínűleg érvénytelen ' +
        'az organization neve vagy a hozzáférési token.',
    );
  }

  try {
    return (await response.json()) as T;
  } catch {
    throw new DevOpsError('Az Azure DevOps válasza értelmezhetetlen volt.');
  }
}

/**
 * Azure DevOps answers a bad PAT with a sign-in page rather than a JSON error, so the status code
 * is what we lead with; the API's own `message` is appended when there is one.
 */
async function describeFailure(response: Response): Promise<string> {
  const detail = await response
    .json()
    .then((body) => (body as { message?: string }).message?.trim())
    .catch(() => undefined);

  if (response.status === 401 || response.status === 203) {
    return 'Az Azure DevOps elutasította a hozzáférési tokent (401).';
  }
  if (response.status === 403) return 'A token nem jogosult erre a műveletre (403).';
  if (response.status === 404) return detail ?? 'Nincs ilyen elem az Azure DevOps-ban (404).';

  return detail ?? `Azure DevOps hiba: ${response.status} ${response.statusText}`;
}

type RawWorkItem = {
  id: number;
  fields?: Record<string, unknown>;
};

function toWorkItem(raw: RawWorkItem): WorkItem {
  const fields = raw.fields ?? {};
  return {
    id: raw.id,
    type: String(fields['System.WorkItemType'] ?? ''),
    title: String(fields['System.Title'] ?? ''),
    state: String(fields['System.State'] ?? ''),
    project: String(fields['System.TeamProject'] ?? ''),
    description: htmlToMarkdown(String(fields[FIELD_DESCRIPTION] ?? '')),
    acceptanceCriteria: htmlToMarkdown(String(fields[FIELD_ACCEPTANCE] ?? '')),
  };
}

/**
 * Read one work item by id. No project in the path: the id alone identifies it org-wide.
 *
 * Deliberately no `fields=` filter. Asking for a field a work item type does not define is a 400
 * from this API, and acceptance criteria is exactly such a field — an Agile Task has none. Taking
 * the whole field bag costs a larger response and never fails.
 */
export async function getWorkItem(config: DevOpsConfig, id: number): Promise<WorkItem> {
  const raw = await call<RawWorkItem>(
    config,
    `${orgUrl(config)}/_apis/wit/workitems/${id}?api-version=${API_VERSION}`,
  );
  return toWorkItem(raw);
}

const ENTITIES: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

/**
 * Turn the rich text of a work item field into something our markdown description can hold.
 *
 * Hand-rolled on purpose: this is a loopback tool with no image or font downloads and a short
 * dependency list, and a full HTML-to-markdown converter would be a large one for two fields. It
 * covers what the DevOps editor actually produces — paragraphs, line breaks, lists, emphasis and
 * links — and drops the rest of the markup rather than leaving tags in the text.
 */
export function htmlToMarkdown(html: string): string {
  if (html.trim() === '') return '';

  let text = html;

  // Links first: the inner text still has to survive the tag stripping below.
  text = text.replace(/<a\b[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');

  text = text
    .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**')
    .replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, '*$2*')
    .replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, '`$1`');

  // Numbered lists before anything else touches their items, so the order survives as order.
  text = text.replace(/<ol\b[^>]*>([\s\S]*?)<\/ol>/gi, (_match, inner: string) => {
    let n = 0;
    return `\n${inner.replace(/<li\b[^>]*>/gi, () => `\n${++n}. `)}\n\n`;
  });

  text = text
    .replace(/<br\s*\/?>/gi, '\n')
    // Tight list items: `<li>` opens the line, so its close must not add a blank one.
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/li>/gi, '')
    // Table cells would otherwise run into each other as one word.
    .replace(/<\/t[dh]>/gi, ' | ')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|ul|ol|blockquote)>/gi, '\n\n')
    .replace(/<(p|div|h[1-6]|ul|ol|blockquote)\b[^>]*>/gi, '\n');

  // Whatever markup is left carries no meaning we can keep.
  text = text.replace(/<[^>]+>/g, '');

  text = text
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (match, name: string) => ENTITIES[name.toLowerCase()] ?? match);

  return text
    // The separator left by the last cell of a row has nothing after it.
    .replace(/\s*\|\s*(\n|$)/g, '$1')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Move the work item to `state`. A blind overwrite by design — this wall is the source of truth,
 * so no revision check guards it. The answer carries the fresh fields, which is how the cached
 * title and type stay current without a separate read.
 */
export async function setWorkItemState(
  config: DevOpsConfig,
  id: number,
  state: string,
): Promise<WorkItem> {
  const raw = await call<RawWorkItem>(
    config,
    `${orgUrl(config)}/_apis/wit/workitems/${id}?api-version=${API_VERSION}`,
    {
      method: 'PATCH',
      contentType: 'application/json-patch+json',
      body: [{ op: 'add', path: '/fields/System.State', value: state }],
    },
  );
  return toWorkItem(raw);
}

type NamedList = { value?: { name?: string }[] };

function names(list: NamedList): string[] {
  return (list.value ?? []).map((entry) => entry.name ?? '').filter((name) => name !== '');
}

/**
 * The three lookups behind the settings panel. The valid state names are defined per work item
 * type inside a project, so the panel makes you pick a project and a type as a *reference* — the
 * pair is never stored, only the two state names it helped you choose.
 */
export async function listProjects(config: DevOpsConfig): Promise<string[]> {
  return names(
    await call<NamedList>(config, `${orgUrl(config)}/_apis/projects?api-version=${API_VERSION}`),
  );
}

export async function listWorkItemTypes(config: DevOpsConfig, project: string): Promise<string[]> {
  return names(
    await call<NamedList>(
      config,
      `${orgUrl(config)}/${encodeURIComponent(project)}/_apis/wit/workitemtypes?api-version=${API_VERSION}`,
    ),
  );
}

export async function listStates(
  config: DevOpsConfig,
  project: string,
  type: string,
): Promise<string[]> {
  return names(
    await call<NamedList>(
      config,
      `${orgUrl(config)}/${encodeURIComponent(project)}/_apis/wit/workitemtypes/` +
        `${encodeURIComponent(type)}/states?api-version=${API_VERSION}`,
    ),
  );
}
