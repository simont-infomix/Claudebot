/**
 * The thin layer between the two surfaces and the two sides of a status change.
 *
 * `TodoStore` stays SQL-only and `devops.ts` stays HTTP-only; this is the one place that knows a
 * local status change should also be mirrored to a linked work item. Both the JSON API and the MCP
 * tools go through it, so the two can never drift on which transitions push and which do not.
 */

import {
  DevOpsError,
  browseUrl,
  getWorkItem,
  isConfigured,
  listProjects,
  listStates,
  listWorkItemTypes,
  parseWorkItemRef,
  setWorkItemState,
  type DevOpsConfig,
} from './devops.js';
import type { DevOpsLink, Status, Todo, TodoStore } from './repo.js';

const KEY_ORG = 'devops.org';
const KEY_PAT = 'devops.pat';
const KEY_STATE_IN_PROGRESS = 'devops.state_in_progress';
const KEY_STATE_CLOSED = 'devops.state_closed';

/**
 * What the settings endpoint hands back. The PAT is never in it — only whether one is stored, so
 * the panel can show "beállítva" without the secret leaving the database.
 */
export type DevOpsSettingsView = {
  org: string;
  stateInProgress: string;
  stateClosed: string;
  hasPat: boolean;
  /** True when a push could actually be attempted: org + PAT + at least one state name. */
  configured: boolean;
};

export type SettingsInput = {
  org: string;
  /** `undefined` keeps the stored token, `''` clears it. */
  pat?: string;
  stateInProgress: string;
  stateClosed: string;
};

/** Which of the work item's long fields to copy into the todo's description when linking. */
export type ImportFields = { description?: boolean; acceptance?: boolean };

/** Hungarian headings: this lands in the description the human reads, not in a log. */
const IMPORT_HEADINGS = { description: '## Leírás', acceptance: '## Elfogadási kritérium' };

/**
 * The chosen fields as one markdown block, or an empty string when nothing was asked for or the
 * work item had nothing in those fields. Headed, because the text is about to sit underneath
 * whatever the human already wrote and has to be recognisable as imported.
 */
function importedSections(
  item: { description: string; acceptanceCriteria: string },
  imports: ImportFields,
): string {
  const sections: string[] = [];
  if (imports.description && item.description.trim() !== '') {
    sections.push(`${IMPORT_HEADINGS.description}\n\n${item.description.trim()}`);
  }
  if (imports.acceptance && item.acceptanceCriteria.trim() !== '') {
    sections.push(`${IMPORT_HEADINGS.acceptance}\n\n${item.acceptanceCriteria.trim()}`);
  }
  return sections.join('\n\n');
}

/** Either the thing asked for, or an HTTP status and a message the UI can show as-is. */
export type Result<T> = { ok: true; value: T } | { ok: false; status: number; error: string };

function fail(status: number, error: string): Result<never> {
  return { ok: false, status, error };
}

/**
 * Which DevOps state a local status maps to, or null for "do not touch DevOps".
 *
 * `open` deliberately has no counterpart: re-opening an item here is our own housekeeping, and a
 * brand new todo must not move a work item somebody else is looking at. Only `in_progress` and
 * `closed` are mirrored — in both directions, so closing and then re-starting an item walks the
 * work item back to the in-progress state.
 */
function targetState(status: Status, config: DevOpsConfig): string | null {
  if (status === 'in_progress') return config.stateInProgress.trim() || null;
  if (status === 'closed') return config.stateClosed.trim() || null;
  return null;
}

export class TodoService {
  constructor(readonly store: TodoStore) {}

  /** The stored connection, or null when nothing has been configured yet. */
  config(): DevOpsConfig | null {
    const settings = this.store.readSettings();
    const org = settings[KEY_ORG] ?? '';
    const pat = settings[KEY_PAT] ?? '';
    if (org.trim() === '' && pat === '') return null;
    return {
      org,
      pat,
      stateInProgress: settings[KEY_STATE_IN_PROGRESS] ?? '',
      stateClosed: settings[KEY_STATE_CLOSED] ?? '',
    };
  }

  /** The same thing without the secret — this is what leaves the process. */
  settingsView(): DevOpsSettingsView {
    const config = this.config();
    return {
      org: config?.org ?? '',
      stateInProgress: config?.stateInProgress ?? '',
      stateClosed: config?.stateClosed ?? '',
      hasPat: (config?.pat ?? '') !== '',
      configured:
        isConfigured(config) &&
        (config.stateInProgress.trim() !== '' || config.stateClosed.trim() !== ''),
    };
  }

  saveSettings(input: SettingsInput): DevOpsSettingsView {
    this.store.writeSetting(KEY_ORG, input.org.trim());
    this.store.writeSetting(KEY_STATE_IN_PROGRESS, input.stateInProgress.trim());
    this.store.writeSetting(KEY_STATE_CLOSED, input.stateClosed.trim());
    // Absent means "leave the token alone"; an explicit empty string is how you remove it.
    if (input.pat !== undefined) {
      if (input.pat === '') this.store.deleteSetting(KEY_PAT);
      else this.store.writeSetting(KEY_PAT, input.pat);
    }
    return this.settingsView();
  }

  /** A usable config, or the reason there is none — every DevOps call starts here. */
  private requireConfig(): Result<DevOpsConfig> {
    const config = this.config();
    if (!isConfigured(config)) {
      return fail(400, 'Nincs beállítva az Azure DevOps kapcsolat.');
    }
    return { ok: true, value: config };
  }

  /**
   * Write the patch locally, then mirror a status change to DevOps if there is a linked work item.
   *
   * `wait: true` (the web UI) surfaces the push failure to the caller as well as storing it;
   * `wait: false` (an agent over MCP) starts the push and returns immediately — an agent must
   * never end up waiting on a network call, so the failure only lands on the item.
   */
  async updateTodo(
    id: number,
    patch: Parameters<TodoStore['updateTodo']>[1],
    options: { wait: boolean },
  ): Promise<{ todo: Todo | undefined; pushError: string | null }> {
    const updated = this.store.updateTodo(id, patch);
    if (!updated || patch.status === undefined) return { todo: updated, pushError: null };

    if (!options.wait) {
      this.pushDetached(id);
      return { todo: updated, pushError: null };
    }

    const pushError = await this.push(id);
    // Re-read: the push wrote its own outcome onto the link, which is part of the todo.
    return { todo: this.store.getTodo(id) ?? updated, pushError };
  }

  /**
   * Mirror a todo's current status onto its work item. Returns the failure message, or null when
   * it worked — or when there was simply nothing to do (no link, no config, `open` status).
   *
   * The write is a blind overwrite: this wall is the source of truth, so a work item somebody
   * moved by hand in the meantime is moved back.
   */
  async push(id: number): Promise<string | null> {
    const todo = this.store.getTodo(id);
    if (!todo?.devops) return null;

    const config = this.config();
    if (!isConfigured(config)) return null;

    const state = targetState(todo.status, config);
    if (state === null) return null;

    try {
      const item = await setWorkItemState(config, todo.devops.work_item_id, state);
      this.store.recordDevOpsPush(id, {
        // What DevOps reports after the write, which is the truth even if a rule rewrote it.
        state: item.state,
        work_item_type: item.type,
        work_item_title: item.title,
        project: item.project,
      });
      return null;
    } catch (error) {
      const message =
        error instanceof DevOpsError
          ? error.message
          : 'Ismeretlen hiba az Azure DevOps hívása közben.';
      this.store.recordDevOpsFailure(id, message);
      return message;
    }
  }

  /** Fire and forget: `push` already records its own outcome, so nothing is lost by not waiting. */
  pushDetached(id: number): void {
    void this.push(id).catch((error: unknown) => {
      console.error('[devops] push failed unexpectedly:', error);
    });
  }

  /** The manual retry behind the "újra" button — same push, started by hand. */
  async retryPush(id: number): Promise<Result<Todo>> {
    const todo = this.store.getTodo(id);
    if (!todo) return fail(404, 'Not found');
    if (!todo.devops) return fail(400, 'Ehhez a todóhoz nincs DevOps jegy kötve.');

    const config = this.requireConfig();
    if (!config.ok) return config;

    if (targetState(todo.status, config.value) === null) {
      return fail(400, 'Nyitott állapotban nincs mit kiírni az Azure DevOps-ba.');
    }

    const error = await this.push(id);
    if (error) return fail(502, error);
    return { ok: true, value: this.store.getTodo(id)! };
  }

  /**
   * Attach a work item to a todo. The reference may be a number or any work item URL; the item is
   * read back to prove it exists and to fill in its project, type and title. Nothing is pushed —
   * linking is a record, and the DevOps side stays untouched until the next status change.
   *
   * `imports` can pull the work item's description and acceptance criteria into the todo's own
   * description. It always **appends**, never replaces: whatever the human already wrote is the
   * part that cannot be recovered, so it stays.
   */
  async linkWorkItem(
    todoId: number,
    ref: string,
    imports: ImportFields = {},
  ): Promise<Result<Todo>> {
    if (!this.store.getTodo(todoId)) return fail(404, 'Not found');

    const workItemId = parseWorkItemRef(ref);
    if (workItemId === null) {
      return fail(400, 'Nem ismerhető fel work item azonosító. Adj meg egy számot vagy egy URL-t.');
    }

    const config = this.requireConfig();
    if (!config.ok) return config;

    // One work item belongs to one todo: without this the first close would resolve it while the
    // other todo pointing at it is still open.
    const taken = this.store.findDevOpsLinkByWorkItem(workItemId);
    if (taken && taken.todo_id !== todoId) {
      return fail(409, `A(z) #${workItemId} work item már a #${taken.todo_id} todóhoz van kötve.`);
    }

    let item;
    try {
      item = await getWorkItem(config.value, workItemId);
    } catch (error) {
      if (error instanceof DevOpsError) return fail(502, error.message);
      throw error;
    }

    const link = this.store.setDevOpsLink(todoId, {
      work_item_id: item.id,
      project: item.project,
      work_item_type: item.type,
      work_item_title: item.title,
      remote_state: item.state,
    });
    if (!link) return fail(404, 'Not found');

    const appended = importedSections(item, imports);
    if (appended !== '') {
      const current = this.store.getTodo(todoId)?.description ?? '';
      // Unlike the link itself, this is content, so it counts as activity and bumps the item.
      this.store.updateTodo(todoId, {
        description: current.trim() === '' ? appended : `${current.trimEnd()}\n\n${appended}`,
      });
    }

    return { ok: true, value: this.store.getTodo(todoId)! };
  }

  /** Forget the link. Nothing is sent to DevOps: the connection only ever existed on our side. */
  unlinkWorkItem(todoId: number): boolean {
    return this.store.deleteDevOpsLink(todoId);
  }

  /** Where the work item lives in a browser, for the link on the note. */
  browseUrl(link: DevOpsLink): string | null {
    const config = this.config();
    if (!isConfigured(config)) return null;
    return browseUrl(config.org, link.project, link.work_item_id);
  }

  /** The settings panel's lookups: projects, then that project's types, then that type's states. */
  async projects(): Promise<Result<string[]>> {
    return this.lookup((config) => listProjects(config));
  }

  async workItemTypes(project: string): Promise<Result<string[]>> {
    return this.lookup((config) => listWorkItemTypes(config, project));
  }

  async states(project: string, type: string): Promise<Result<string[]>> {
    return this.lookup((config) => listStates(config, project, type));
  }

  private async lookup(
    run: (config: DevOpsConfig) => Promise<string[]>,
  ): Promise<Result<string[]>> {
    const config = this.requireConfig();
    if (!config.ok) return config;
    try {
      return { ok: true, value: await run(config.value) };
    } catch (error) {
      if (error instanceof DevOpsError) return fail(502, error.message);
      throw error;
    }
  }
}
