import { useState } from 'react';
import Autocomplete from '@mui/material/Autocomplete';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import * as api from './api';
import type { Todo } from './types';

type Props = {
  repos: string[];
  onCreated: (todo: Todo) => void;
  onCancel: () => void;
  onError: (message: string) => void;
};

export function NewTodoForm({ repos, onCreated, onCancel, onError }: Props) {
  const [repo, setRepo] = useState(repos[0] ?? '');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!repo.trim() || !title.trim()) return;
    setBusy(true);
    try {
      const created = await api.createTodo({
        repo: repo.trim(),
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
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={2}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <Autocomplete
            freeSolo
            options={repos}
            value={repo}
            onChange={(_event, value) => setRepo(value ?? '')}
            onInputChange={(_event, value) => setRepo(value)}
            sx={{ minWidth: 220 }}
            renderInput={(params) => (
              <TextField {...params} label="Repo" size="small" required helperText="Mappa rövid neve" />
            )}
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
            disabled={busy || !repo.trim() || !title.trim()}
            onClick={() => void submit()}
          >
            Hozzáadás
          </Button>
        </Stack>
      </Stack>
    </Paper>
  );
}
