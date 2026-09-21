import { useState } from 'react';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import * as api from './api';
import { ImportChoices, type ImportChoice } from './DevOpsLink';
import { RepoPicker } from './RepoPicker';
import { PAPER_TEXTURE, SHEET } from './board';
import type { DevOpsSettings, Todo } from './types';

type Props = {
  /** Existing repo names, offered as suggestions. */
  repos: string[];
  /** True on the post-it board: the form is rendered as a paper sheet instead of a plain card. */
  sheet?: boolean;
  /** The Azure DevOps connection, or null when none is configured — then the field is hidden. */
  devops: DevOpsSettings | null;
  onCreated: (todo: Todo) => void;
  onCancel: () => void;
  onError: (message: string) => void;
};

export function NewTodoForm({
  repos,
  sheet = false,
  devops,
  onCreated,
  onCancel,
  onError,
}: Props) {
  const [selectedRepos, setSelectedRepos] = useState<string[]>(repos[0] ? [repos[0]] : []);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [workItem, setWorkItem] = useState('');
  const [imports, setImports] = useState<ImportChoice>({ description: true, acceptance: true });
  const [busy, setBusy] = useState(false);

  /**
   * Two steps, in this order on purpose: the todo is created first and stands whatever happens
   * next. A mistyped work item number must not cost you the note you just wrote — the link is
   * attempted afterwards, and a failure is reported while the todo stays.
   */
  const submit = async () => {
    if (selectedRepos.length === 0 || !title.trim()) return;
    setBusy(true);
    try {
      const created = await api.createTodo({
        repos: selectedRepos,
        title: title.trim(),
        description,
      });
      setTitle('');
      setDescription('');

      const ref = workItem.trim();
      if (!ref) {
        onCreated(created);
        return;
      }

      try {
        const linked = await api.linkWorkItem(created.id, ref, imports);
        setWorkItem('');
        onCreated(linked);
      } catch (error) {
        onCreated(created);
        onError(`#${created.id} létrejött, de az összekötés nem sikerült: ${(error as Error).message}`);
      }
    } catch (error) {
      onError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Paper
      variant={sheet ? 'elevation' : 'outlined'}
      elevation={sheet ? 4 : 0}
      sx={(theme) => ({
        p: 2,
        ...(sheet && {
          backgroundColor: SHEET.light,
          backgroundImage: PAPER_TEXTURE,
          backgroundBlendMode: 'multiply',
          boxShadow: '0 16px 28px -16px rgba(0,0,0,0.65)',
          ...theme.applyStyles('dark', { backgroundColor: SHEET.dark }),
        }),
      })}
    >
      <Stack spacing={2}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <RepoPicker
            value={selectedRepos}
            options={repos}
            onChange={setSelectedRepos}
            helperText="Mappa rövid neve; több is megadható"
          />
          <TextField
            label="Cím"
            size="small"
            required
            fullWidth
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            helperText="Egy sorban; kérdés, ha döntés kell"
          />
        </Stack>
        <TextField
          label="Leírás (markdown, opcionális)"
          size="small"
          fullWidth
          multiline
          minRows={3}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
        {devops?.configured && (
          <Stack spacing={0.5}>
            <TextField
              label="Azure DevOps work item (opcionális)"
              size="small"
              fullWidth
              value={workItem}
              onChange={(event) => setWorkItem(event.target.value)}
              helperText="1234 vagy a work item URL-je. Az összekötés csak nálunk tárolódik."
            />
            {/* Only once there is a work item to import from. */}
            {workItem.trim() !== '' && (
              <ImportChoices value={imports} disabled={busy} onChange={setImports} />
            )}
          </Stack>
        )}
        <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
          <Button onClick={onCancel}>Mégse</Button>
          <Button
            variant="contained"
            disabled={busy || selectedRepos.length === 0 || !title.trim()}
            onClick={() => void submit()}
          >
            Hozzáadás
          </Button>
        </Stack>
      </Stack>
    </Paper>
  );
}
