import { useCallback, useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Container from '@mui/material/Container';
import FormControl from '@mui/material/FormControl';
import GlobalStyles from '@mui/material/GlobalStyles';
import InputLabel from '@mui/material/InputLabel';
import LinearProgress from '@mui/material/LinearProgress';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Select from '@mui/material/Select';
import Stack from '@mui/material/Stack';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import RefreshIcon from '@mui/icons-material/Refresh';
import ViewListIcon from '@mui/icons-material/ViewList';
import ViewModuleIcon from '@mui/icons-material/ViewModule';
import * as api from './api';
import { NewTodoForm } from './NewTodoForm';
import { TodoNote } from './TodoNote';
import { TodoRow } from './TodoRow';
import { CORK_DARK, CORK_LIGHT, HAND_FONT, INK, NOTE_PAPER, PAPER_TEXTURE } from './board';
import type { RepoSummary, StatusFilter, Todo, TodoListItem } from './types';

const STATUS_FILTER_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'active', label: 'Aktívak (nyitott + folyamatban)' },
  { value: 'open', label: 'Csak nyitott' },
  { value: 'in_progress', label: 'Csak folyamatban' },
  { value: 'closed', label: 'Csak lezárt' },
  { value: 'all', label: 'Mind (lezártakkal)' },
];

/** `board` = post-it wall, `list` = the original flat accordion list. Both are first-class. */
type ViewMode = 'board' | 'list';

const VIEW_KEY = 'todo-mcp:view';

function readView(): ViewMode {
  try {
    return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'board';
  } catch {
    return 'board';
  }
}

/** White-on-cork text needs a shadow to stay readable over the texture. */
const ON_CORK = { color: '#fff9ec', textShadow: '0 1px 3px rgba(0,0,0,0.55)' };

export function App() {
  const [todos, setTodos] = useState<TodoListItem[]>([]);
  const [repos, setRepos] = useState<RepoSummary[]>([]);
  const [repoFilter, setRepoFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');
  const [view, setView] = useState<ViewMode>(readView);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const board = view === 'board';

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

  const changeView = (next: ViewMode) => {
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      // private mode or blocked storage: the choice just won't survive a reload
    }
  };

  /** Keep an edited item in place even if it no longer matches the filter — it vanishes on Refresh. */
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

  const itemProps = {
    onChange: handleChange,
    onDelete: handleDelete,
    onCommentCountChange: handleCommentCountChange,
    onError: setError,
  };

  const filterControls = (
    <Stack
      direction={{ xs: 'column', sm: 'row' }}
      spacing={2}
      sx={{ alignItems: { xs: 'stretch', sm: 'center' } }}
    >
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

      {board && <Box sx={{ flexGrow: 1 }} />}

      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        {board && (
          <>
            <Legend status="open" label="nyitott" />
            <Legend status="in_progress" label="folyamatban" />
            <Legend status="closed" label="lezárt" />
          </>
        )}
        <Typography variant="body2" color="text.secondary">
          {todos.length} találat{statusFilter === 'all' ? ` · ${activeCount} aktív` : ''}
        </Typography>
      </Stack>
    </Stack>
  );

  return (
    <Container maxWidth={board ? 'xl' : 'lg'} sx={{ py: 3 }}>
      {/* the wall behind everything — only in board view */}
      {board && (
        <GlobalStyles
          styles={(theme) => ({
            body: { minHeight: '100vh', ...CORK_LIGHT, ...theme.applyStyles('dark', CORK_DARK) },
          })}
        />
      )}

      <Stack spacing={board ? 2.5 : 2}>
        <Stack direction="row" spacing={2} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <Box sx={{ flexGrow: 1 }}>
            {board ? (
              <Typography
                component="h1"
                sx={{ ...ON_CORK, fontFamily: HAND_FONT, fontSize: '1.9rem', fontWeight: 700 }}
              >
                Todo MCP
              </Typography>
            ) : (
              <Typography variant="h5" component="h1">
                Todo MCP
              </Typography>
            )}
            <Typography
              variant="body2"
              {...(board
                ? { sx: { ...ON_CORK, opacity: 0.85 } }
                : { color: 'text.secondary' as const })}
            >
              Emberi döntést igénylő feladatok a coding agent munkájából
            </Typography>
          </Box>

          <ToggleButtonGroup
            exclusive
            size="small"
            value={view}
            onChange={(_event, value) => value && changeView(value as ViewMode)}
            sx={
              board
                ? {
                    backgroundColor: 'rgba(255,255,255,0.12)',
                    '& .MuiToggleButton-root': {
                      color: ON_CORK.color,
                      borderColor: 'rgba(255,249,236,0.4)',
                    },
                    '& .MuiToggleButton-root.Mui-selected': {
                      backgroundColor: 'rgba(255,255,255,0.3)',
                      color: ON_CORK.color,
                    },
                  }
                : undefined
            }
          >
            <ToggleButton value="board" aria-label="Post-it fal">
              <ViewModuleIcon fontSize="small" sx={{ mr: 0.5 }} />
              Fal
            </ToggleButton>
            <ToggleButton value="list" aria-label="Lista">
              <ViewListIcon fontSize="small" sx={{ mr: 0.5 }} />
              Lista
            </ToggleButton>
          </ToggleButtonGroup>

          <Button
            startIcon={<RefreshIcon />}
            onClick={() => void load()}
            disabled={loading}
            sx={board ? { ...ON_CORK, '&.Mui-disabled': { color: 'rgba(255,249,236,0.5)' } } : undefined}
          >
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
            sheet={board}
            onCreated={handleCreated}
            onCancel={() => setShowForm(false)}
            onError={setError}
          />
        )}

        {board ? (
          /* the filters, pinned to the board like a paper label */
          <Paper
            elevation={3}
            sx={(theme) => ({
              p: 1.5,
              backgroundImage: PAPER_TEXTURE,
              backgroundBlendMode: 'multiply',
              boxShadow: '0 10px 18px -12px rgba(0,0,0,0.6)',
              ...theme.applyStyles('dark', { backgroundColor: '#2b261c' }),
            })}
          >
            {filterControls}
          </Paper>
        ) : (
          filterControls
        )}

        {todos.length === 0 && !loading ? (
          <EmptyState board={board} />
        ) : board ? (
          <Box
            sx={{
              display: 'grid',
              gap: 3,
              gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))',
              alignItems: 'start',
              py: 1,
            }}
          >
            {todos.map((todo) => (
              <TodoNote key={todo.id} todo={todo} {...itemProps} />
            ))}
          </Box>
        ) : (
          <Box>
            {todos.map((todo) => (
              <TodoRow key={todo.id} todo={todo} {...itemProps} />
            ))}
          </Box>
        )}
      </Stack>
    </Container>
  );
}

function EmptyState({ board }: { board: boolean }) {
  const text = (
    <>
      Nincs megjeleníthető todo. Az agent az <code>add_todo</code> toollal tud ide írni.
    </>
  );

  if (!board) {
    return (
      <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
        <Typography color="text.secondary">{text}</Typography>
      </Paper>
    );
  }

  return (
    <Box
      sx={(theme) => ({
        maxWidth: 380,
        mx: 'auto',
        mt: 4,
        p: 3,
        textAlign: 'center',
        color: INK,
        backgroundColor: NOTE_PAPER.open.light,
        backgroundImage: PAPER_TEXTURE,
        backgroundBlendMode: 'multiply',
        fontFamily: HAND_FONT,
        transform: 'rotate(-1.5deg)',
        boxShadow: '0 1px 2px rgba(0,0,0,0.28), 0 14px 20px -14px rgba(0,0,0,0.6)',
        ...theme.applyStyles('dark', { backgroundColor: NOTE_PAPER.open.dark }),
      })}
    >
      Üres a fal. Az agent az <code>add_todo</code> toollal tud ide tűzni egy cetlit.
    </Box>
  );
}

/** Tiny paper swatch so the note colours are self-explanatory. */
function Legend({ status, label }: { status: keyof typeof NOTE_PAPER; label: string }) {
  return (
    <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
      <Box
        sx={(theme) => ({
          width: 12,
          height: 12,
          backgroundColor: NOTE_PAPER[status].light,
          border: '1px solid rgba(0,0,0,0.25)',
          ...theme.applyStyles('dark', { backgroundColor: NOTE_PAPER[status].dark }),
        })}
      />
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
    </Stack>
  );
}
