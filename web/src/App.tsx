import { useCallback, useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Container from '@mui/material/Container';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import LinearProgress from '@mui/material/LinearProgress';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Select from '@mui/material/Select';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import RefreshIcon from '@mui/icons-material/Refresh';
import * as api from './api';
import { NewTodoForm } from './NewTodoForm';
import { TodoRow } from './TodoRow';
import type { RepoSummary, StatusFilter, Todo, TodoListItem } from './types';

const STATUS_FILTER_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'active', label: 'Aktívak (nyitott + folyamatban)' },
  { value: 'open', label: 'Csak nyitott' },
  { value: 'in_progress', label: 'Csak folyamatban' },
  { value: 'closed', label: 'Csak lezárt' },
  { value: 'all', label: 'Mind (lezártakkal)' },
];

export function App() {
  const [todos, setTodos] = useState<TodoListItem[]>([]);
  const [repos, setRepos] = useState<RepoSummary[]>([]);
  const [repoFilter, setRepoFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [loadedTodos, loadedRepos] = await Promise.all([
        api.fetchTodos({ repo: repoFilter, status: statusFilter }),
        api.fetchRepos(),
      ]);
      setTodos(loadedTodos);
      setRepos(loadedRepos);
      setError(null);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setLoading(false);
    }
  }, [repoFilter, statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Keep an edited row in place even if it no longer matches the filter — it vanishes on Refresh. */
  const handleChange = (updated: Todo) => {
    setTodos((current) =>
      current.map((todo) => (todo.id === updated.id ? { ...todo, ...updated } : todo)),
    );
  };

  const handleDelete = (id: number) => {
    setTodos((current) => current.filter((todo) => todo.id !== id));
  };

  const handleCommentCountChange = (id: number, delta: number) => {
    setTodos((current) =>
      current.map((todo) =>
        todo.id === id ? { ...todo, comment_count: Math.max(0, todo.comment_count + delta) } : todo,
      ),
    );
  };

  const handleCreated = (created: Todo) => {
    setShowForm(false);
    setTodos((current) => [{ ...created, comment_count: 0 }, ...current]);
    setRepos((current) =>
      current.some((entry) => entry.repo === created.repo)
        ? current
        : [...current, { repo: created.repo, active_count: 1 }].sort((a, b) =>
            a.repo.localeCompare(b.repo, 'hu'),
          ),
    );
  };

  const activeCount = todos.filter((todo) => todo.status !== 'closed').length;

  return (
    <Container maxWidth="lg" sx={{ py: 3 }}>
      <Stack spacing={2}>
        <Stack direction="row" spacing={2} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <Box sx={{ flexGrow: 1 }}>
            <Typography variant="h5" component="h1">
              Todo MCP
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Emberi döntést igénylő feladatok a coding agent munkájából
            </Typography>
          </Box>
          <Button startIcon={<RefreshIcon />} onClick={() => void load()} disabled={loading}>
            Frissítés
          </Button>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setShowForm((current) => !current)}
          >
            Új todo
          </Button>
        </Stack>

        {loading && <LinearProgress />}

        {error && (
          <Alert severity="error" onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {showForm && (
          <NewTodoForm
            repos={repos.map((entry) => entry.repo)}
            onCreated={handleCreated}
            onCancel={() => setShowForm(false)}
            onError={setError}
          />
        )}

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: 'center' }}>
          <FormControl size="small" sx={{ minWidth: 220 }}>
            <InputLabel id="repo-filter-label">Repo</InputLabel>
            <Select
              labelId="repo-filter-label"
              label="Repo"
              value={repoFilter}
              onChange={(event) => setRepoFilter(event.target.value)}
            >
              <MenuItem value="">Mind</MenuItem>
              {repos.map((entry) => (
                <MenuItem key={entry.repo} value={entry.repo}>
                  {entry.repo} ({entry.active_count})
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl size="small" sx={{ minWidth: 260 }}>
            <InputLabel id="status-filter-label">Státusz</InputLabel>
            <Select
              labelId="status-filter-label"
              label="Státusz"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
            >
              {STATUS_FILTER_OPTIONS.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <Typography variant="body2" color="text.secondary">
            {todos.length} találat{statusFilter === 'all' ? ` · ${activeCount} aktív` : ''}
          </Typography>
        </Stack>

        {todos.length === 0 && !loading ? (
          <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
            <Typography color="text.secondary">
              Nincs megjeleníthető todo. Az agent az <code>add_todo</code> toollal tud ide írni.
            </Typography>
          </Paper>
        ) : (
          <Box>
            {todos.map((todo) => (
              <TodoRow
                key={todo.id}
                todo={todo}
                onChange={handleChange}
                onDelete={handleDelete}
                onCommentCountChange={handleCommentCountChange}
                onError={setError}
              />
            ))}
          </Box>
        )}
      </Stack>
    </Container>
  );
}
