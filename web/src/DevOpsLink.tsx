import { useState, type MouseEvent } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import FormControlLabel from '@mui/material/FormControlLabel';
import MuiLink from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import LinkOffIcon from '@mui/icons-material/LinkOff';
import RefreshIcon from '@mui/icons-material/Refresh';
import SyncProblemIcon from '@mui/icons-material/SyncProblem';
import * as api from './api';
import { INK_SOFT } from './board';
import { formatAbsolute } from './format';
import type { DevOpsLink, DevOpsSettings, Todo, TodoListItem } from './types';

export type ImportChoice = { description: boolean; acceptance: boolean };

/**
 * The two long fields of a work item, offered when linking. Both default to on: if you are
 * pointing a note at a DevOps ticket, its text is almost always what you wanted here. The import
 * only ever appends to the description, so saying yes cannot lose anything you wrote.
 */
export function ImportChoices({
  value,
  disabled,
  onChange,
}: {
  value: ImportChoice;
  disabled: boolean;
  onChange: (value: ImportChoice) => void;
}) {
  return (
    <Stack direction="row" spacing={2} useFlexGap sx={{ flexWrap: 'wrap' }}>
      <FormControlLabel
        control={
          <Checkbox
            size="small"
            checked={value.description}
            disabled={disabled}
            onChange={(event) => onChange({ ...value, description: event.target.checked })}
          />
        }
        label={<Typography variant="body2">Leírás átemelése</Typography>}
      />
      <FormControlLabel
        control={
          <Checkbox
            size="small"
            checked={value.acceptance}
            disabled={disabled}
            onChange={(event) => onChange({ ...value, acceptance: event.target.checked })}
          />
        }
        label={<Typography variant="body2">Elfogadási kritérium átemelése</Typography>}
      />
    </Stack>
  );
}

/**
 * A status change reaches Azure DevOps through the same request that changed it here, and a failed
 * push never fails that request — the local list must not depend on a remote system. The failure
 * rides back on the todo's own link instead, which is what this reads.
 *
 * Only call it right after a status change: at any other time the error on the link may be an old
 * one that nothing has retried yet.
 */
export function pushFailure(todo: Todo): string | null {
  return todo.devops?.error ? `Azure DevOps: ${todo.devops.error}` : null;
}

/** A link with an unresolved push failure is the one thing the wall has to shout about. */
function outOfSync(link: DevOpsLink): boolean {
  return link.error !== null;
}

function tooltipText(link: DevOpsLink): string {
  const head = `${link.work_item_type || 'Work item'} #${link.work_item_id}`;
  const title = link.work_item_title ? ` – ${link.work_item_title}` : '';
  const state = link.remote_state ? `\nÁllapot: ${link.remote_state}` : '';
  const problem = link.error ? `\nSikertelen kiírás: ${link.error}` : '';
  return `${head}${title}${state}${problem}`;
}

/** Opening DevOps must not also open the note it sits on. */
function swallow(event: MouseEvent): void {
  event.stopPropagation();
}

/**
 * The badge on a post-it. Inky and tiny to fit the paper, unlike the row's chip — but it carries
 * the same two facts: which work item, and whether the last push got there.
 */
export function WorkItemNoteBadge({ link, org }: { link: DevOpsLink; org: string }) {
  const broken = outOfSync(link);
  return (
    <Tooltip title={<span style={{ whiteSpace: 'pre-line' }}>{tooltipText(link)}</span>}>
      <Box
        component="a"
        href={api.workItemHref(org, link)}
        target="_blank"
        rel="noreferrer"
        onClick={swallow}
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 0.25,
          px: 0.5,
          fontSize: '0.68rem',
          fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
          color: broken ? '#a3311f' : INK_SOFT,
          textDecoration: 'none',
          border: '1px solid',
          borderColor: broken ? 'rgba(163,49,31,0.55)' : 'rgba(51,48,31,0.35)',
          borderRadius: 0.5,
          '&:hover': { textDecoration: 'underline' },
        }}
      >
        {broken && <SyncProblemIcon sx={{ fontSize: 12 }} />}
        {link.work_item_id}
      </Box>
    </Tooltip>
  );
}

/** The same thing on a list row, where there is room for a proper chip. */
export function WorkItemChip({ link, org }: { link: DevOpsLink; org: string }) {
  const broken = outOfSync(link);
  return (
    <Tooltip title={<span style={{ whiteSpace: 'pre-line' }}>{tooltipText(link)}</span>}>
      <Chip
        size="small"
        variant="outlined"
        clickable
        component="a"
        href={api.workItemHref(org, link)}
        target="_blank"
        rel="noreferrer"
        onClick={swallow}
        color={broken ? 'error' : 'default'}
        icon={broken ? <SyncProblemIcon /> : undefined}
        label={`DevOps #${link.work_item_id}`}
      />
    </Tooltip>
  );
}

type SectionProps = {
  todo: TodoListItem;
  settings: DevOpsSettings;
  busy: boolean;
  onChange: (todo: Todo) => void;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
};

/**
 * The full link controls, in the opened note. Linking reads the work item back to prove it exists
 * and to pick up its type, title and project — but it never pushes: the DevOps side stays where it
 * is until the next status change here.
 */
export function DevOpsSection({
  todo,
  settings,
  busy,
  onChange,
  onNotice,
  onError,
}: SectionProps) {
  const [ref, setRef] = useState('');
  const [imports, setImports] = useState({ description: true, acceptance: true });
  const [working, setWorking] = useState(false);
  const link = todo.devops;
  const disabled = busy || working;

  async function run(action: () => Promise<void>) {
    setWorking(true);
    try {
      await action();
    } catch (error) {
      onError((error as Error).message);
    } finally {
      setWorking(false);
    }
  }

  const attach = () =>
    void run(async () => {
      const linked = await api.linkWorkItem(todo.id, ref, imports);
      onChange(linked);
      setRef('');
      onNotice(`#${todo.id} összekötve a(z) ${linked.devops?.work_item_id} work itemmel`);
    });

  const detach = () =>
    void run(async () => {
      await api.unlinkWorkItem(todo.id);
      onChange({ ...todo, devops: null });
      onNotice('A DevOps kapcsolat megszűnt (a work item változatlan).');
    });

  const retry = () =>
    void run(async () => {
      onChange(await api.pushWorkItem(todo.id));
      onNotice('Az állapot kiírva az Azure DevOps-ba.');
    });

  if (!link) {
    return (
      <Stack spacing={0.5}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ alignItems: 'flex-start' }}>
          <TextField
            size="small"
            fullWidth
            label="Azure DevOps work item"
            placeholder="1234 vagy a work item URL-je"
            value={ref}
            onChange={(event) => setRef(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && ref.trim()) attach();
            }}
            helperText="Az összekötés csak nálunk tárolódik, és nem ír a DevOps-ba."
          />
          <Button
            variant="outlined"
            disabled={disabled || ref.trim() === ''}
            onClick={attach}
            sx={{ mt: { sm: 0.25 } }}
          >
            Összekötés
          </Button>
        </Stack>
        {/* Only once there is something to import into: an empty field has nothing to offer. */}
        {ref.trim() !== '' && (
          <ImportChoices value={imports} disabled={disabled} onChange={setImports} />
        )}
      </Stack>
    );
  }

  return (
    <Stack spacing={1}>
      <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <Typography variant="body2" color="text.secondary">
          Azure DevOps:
        </Typography>
        <MuiLink href={api.workItemHref(settings.org, link)} target="_blank" rel="noreferrer">
          {link.work_item_type || 'Work item'} #{link.work_item_id}
        </MuiLink>
        {link.work_item_title && (
          <Typography variant="body2" sx={{ minWidth: 0 }}>
            {link.work_item_title}
          </Typography>
        )}
        {link.remote_state && <Chip size="small" variant="outlined" label={link.remote_state} />}
      </Stack>

      <Typography variant="caption" color="text.secondary">
        {link.pushed_at
          ? `Utolsó sikeres kiírás: ${link.pushed_state} · ${formatAbsolute(link.pushed_at)}`
          : 'Még nem írtunk állapotot a DevOps-ba.'}
      </Typography>

      {link.error && (
        <Alert
          severity="warning"
          action={
            <Button size="small" startIcon={<RefreshIcon />} disabled={disabled} onClick={retry}>
              Újra
            </Button>
          }
        >
          {link.error}
          {link.error_at ? ` (${formatAbsolute(link.error_at)})` : ''}
        </Alert>
      )}

      <Stack direction="row" spacing={1}>
        {!link.error && (
          <Button size="small" startIcon={<RefreshIcon />} disabled={disabled} onClick={retry}>
            Állapot kiírása
          </Button>
        )}
        <Button
          size="small"
          color="error"
          startIcon={<LinkOffIcon />}
          disabled={disabled}
          onClick={detach}
        >
          Leválasztás
        </Button>
      </Stack>
    </Stack>
  );
}
