import { useState } from 'react';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import * as api from './api';
import { RepoPicker } from './RepoPicker';
import { PAPER_TEXTURE, SHEET } from './board';
import type { Todo } from './types';

type Props = {
  /** Existing repo names, offered as suggestions. */
  repos: string[];
  /** True on the post-it board: the form is rendered as a paper sheet instead of a plain card. */
  sheet?: boolean;
  onCreated: (todo: Todo) => void;
  onCancel: () => void;
  onError: (message: string) => void;
};

export function NewTodoForm({ repos, sheet = false, onCreated, onCancel, onError }: Props) {
  const [selectedRepos, setSelectedRepos] = useState<string[]>(repos[0] ? [repos[0]] : []);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

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
      onCreated(created);
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
