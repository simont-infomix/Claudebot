import { useCallback, useEffect, useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import Container from '@mui/material/Container';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import FormControl from '@mui/material/FormControl';
import GlobalStyles from '@mui/material/GlobalStyles';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import InputLabel from '@mui/material/InputLabel';
import LinearProgress from '@mui/material/LinearProgress';
import ListItemText from '@mui/material/ListItemText';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Select from '@mui/material/Select';
import Snackbar from '@mui/material/Snackbar';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import CancelIcon from '@mui/icons-material/Cancel';
import ClearIcon from '@mui/icons-material/Clear';
import CloudOffIcon from '@mui/icons-material/CloudOff';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import InstallDesktopIcon from '@mui/icons-material/InstallDesktop';
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';
import NotificationsNoneIcon from '@mui/icons-material/NotificationsNone';
import RefreshIcon from '@mui/icons-material/Refresh';
import SearchIcon from '@mui/icons-material/Search';
import ViewListIcon from '@mui/icons-material/ViewList';
import ViewModuleIcon from '@mui/icons-material/ViewModule';
import * as api from './api';
import { NewTodoForm } from './NewTodoForm';
import { TodoNote } from './TodoNote';
import { TodoRow } from './TodoRow';
import { CORK_DARK, CORK_LIGHT, HAND_FONT, INK, NOTE_PAPER, PAPER_TEXTURE } from './board';
import { notifyNewTodos, useInstallPrompt, useNotificationPrompt, useOnline } from './pwa';
import type { RepoSummary, StatusFilter, Todo, TodoHead, TodoListItem } from './types';

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

/** How often to ask "has anything arrived?". Cheap enough that the answer is a single row. */
const POLL_MS = 30_000;

export function App() {
  const [todos, setTodos] = useState<TodoListItem[]>([]);
  const [repos, setRepos] = useState<RepoSummary[]>([]);
  /** Empty = every repo; several entries show the selected repos' todos together. */
  const [repoFilter, setRepoFilter] = useState<string[]>([]);
  const [repoMenuOpen, setRepoMenuOpen] = useState(false);
  /** The repo whose rename dialog is open, if any. */
  const [renaming, setRenaming] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');
  /** What is typed, and what has actually been sent — the second one lags by a keystroke pause. */
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [view, setView] = useState<ViewMode>(readView);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  /** True when the service worker served the last load from its cache (server down / no network). */
  const [stale, setStale] = useState(false);
  /** Set by the poll when the server's list no longer matches what is on screen. */
  const [pending, setPending] = useState<TodoHead | null>(null);
  /** What the list looked like at the last successful load — the thing the poll compares against. */
  const baseline = useRef<TodoHead | null>(null);
  /** The freshest arrival already announced, so one batch is not notified twice. */
  const notifiedAt = useRef(0);
  const install = useInstallPrompt();
  const askNotifications = useNotificationPrompt();
  const online = useOnline();

  const board = view === 'board';

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    api.cacheFlag.stale = false;
    try {
      const [loadedTodos, loadedRepos] = await Promise.all([
        api.fetchTodos({ repos: repoFilter, status: statusFilter, query }),
        api.fetchRepos(),
      ]);
      setTodos(loadedTodos);
      setRepos(loadedRepos);
      setError(null);
      baseline.current = {
        count: loadedTodos.length,
        latest: loadedTodos.reduce((max, todo) => Math.max(max, todo.updated_at), 0),
      };
      setPending(null);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setStale(api.cacheFlag.stale);
      setLoading(false);
    }
  }, [repoFilter, statusFilter, query]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Re-read where the server stands without touching the screen — used after our own writes. */
  const syncBaseline = useCallback(() => {
    api
      .fetchTodosHead({ repos: repoFilter, status: statusFilter, query })
      .then((head) => {
        baseline.current = head;
        setPending(null);
      })
      .catch(() => {
        // Nothing to do: the next poll or refresh will sort it out.
      });
  }, [repoFilter, statusFilter, query]);

  // Your own edit bumps updated_at too, so without this every save would announce itself.
  useEffect(() => {
    api.onMutation(syncBaseline);
    return () => api.onMutation(null);
  }, [syncBaseline]);

  // The list still never changes on its own — this only lights up a chip saying it could.
  useEffect(() => {
    if (!online) return;
    const check = async () => {
      const base = baseline.current;
      if (!base) return;
      try {
        const head = await api.fetchTodosHead({ repos: repoFilter, status: statusFilter, query });
        // `>` on purpose: a baseline that briefly runs ahead of the server (a write we just made)
        // must not latch the chip on forever.
        setPending(head.latest > base.latest || head.count !== base.count ? head : null);
      } catch {
        // Server down: the offline chip already says so, and a failed poll changes nothing.
      }
    };
    const timer = setInterval(() => void check(), POLL_MS);
    return () => clearInterval(timer);
  }, [online, repoFilter, statusFilter, query]);

  // Only actual arrivals are worth a popup; an edit made elsewhere is not.
  useEffect(() => {
    const base = baseline.current;
    if (!pending || !base) return;
    const added = pending.count - base.count;
    if (added > 0 && pending.latest > notifiedAt.current) {
      notifiedAt.current = pending.latest;
      notifyNewTodos(added);
    }
  }, [pending]);

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
    // A brand new repo name has to reach the filter and the pickers without a round trip.
    setRepos((current) => {
      const missing = created.repos.filter((repo) => !current.some((entry) => entry.repo === repo));
      if (missing.length === 0) return current;
      return [...current, ...missing.map((repo) => ({ repo, active_count: 1 }))].sort((a, b) =>
        a.repo.localeCompare(b.repo, 'hu'),
      );
    });
  };

  /** Rename or merge a repo, then keep the filter pointing at whatever the todos moved to. */
  const renameRepo = async (from: string, to: string) => {
    try {
      const { updated } = await api.renameRepo(from, to);
      setRenaming(null);
      setRepoFilter((current) => {
        if (!current.includes(from)) return current;
        const without = current.filter((repo) => repo !== from);
        return without.includes(to) ? without : [...without, to];
      });
      setNotice(updated === 0 ? 'Nem változott semmi.' : `${updated} todo átkerült ide: ${to}`);
      await load();
    } catch (caught) {
      setError((caught as Error).message);
    }
  };

  const activeCount = todos.filter((todo) => todo.status !== 'closed').length;

  const repoOptions = repos.map((entry) => entry.repo);

  const itemProps = {
    repoOptions,
    onChange: handleChange,
    onDelete: handleDelete,
    onCommentCountChange: handleCommentCountChange,
    onNotice: setNotice,
    onError: setError,
  };

  const added = pending && baseline.current ? pending.count - baseline.current.count : 0;

  const filterControls = (
    <Stack
      direction={{ xs: 'column', sm: 'row' }}
      spacing={2}
      sx={{ alignItems: { xs: 'stretch', sm: 'center' } }}
    >
      <FormControl size="small" sx={{ minWidth: 220, maxWidth: { sm: 420 } }}>
        <InputLabel id="repo-filter-label">Repo</InputLabel>
        <Select
          multiple
          labelId="repo-filter-label"
          label="Repo"
          open={repoMenuOpen}
          onOpen={() => setRepoMenuOpen(true)}
          onClose={() => setRepoMenuOpen(false)}
          value={repoFilter}
          onChange={(event) => {
            const value = event.target.value;
            const next = typeof value === 'string' ? value.split(',') : value;
            // the "Mind" entry is a clear-all, not a repo
            setRepoFilter(next.includes('') ? [] : next);
          }}
          renderValue={(selected) => (
            <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: 'wrap' }}>
              {selected.map((repo) => (
                <Chip
                  key={repo}
                  size="small"
                  label={repo}
                  onDelete={() => setRepoFilter((current) => current.filter((r) => r !== repo))}
                  /* the icon must not reach the Select, or removing a repo would open the menu */
                  deleteIcon={<CancelIcon onMouseDown={(event) => event.stopPropagation()} />}
                />
              ))}
            </Stack>
          )}
          MenuProps={{ slotProps: { paper: { sx: { maxHeight: 360 } } } }}
        >
          <MenuItem value="">Mind</MenuItem>
          {repos.map((entry) => (
            <MenuItem key={entry.repo} value={entry.repo}>
              <Checkbox size="small" sx={{ mr: 1, p: 0 }} checked={repoFilter.includes(entry.repo)} />
              <ListItemText primary={`${entry.repo} (${entry.active_count})`} />
              {/* mousedown too: the Select picks items up on mousedown, before any click lands */}
              <Tooltip title="Átnevezés / összevonás">
                <IconButton
                  size="small"
                  aria-label={`${entry.repo} átnevezése`}
                  sx={{ ml: 1 }}
                  onMouseDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    setRepoMenuOpen(false);
                    setRenaming(entry.repo);
                  }}
                >
                  <EditOutlinedIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      <TextField
        size="small"
        label="Keresés"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        sx={{ minWidth: 200 }}
        slotProps={{
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            ),
            endAdornment: search ? (
              <IconButton size="small" aria-label="Keresés törlése" onClick={() => setSearch('')}>
                <ClearIcon fontSize="small" />
              </IconButton>
            ) : null,
          },
        }}
      />

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

          {/* the shell keeps working without the server, but then the data on screen is the cached one */}
          {(stale || !online) && (
            <Chip
              size="small"
              color="warning"
              icon={<CloudOffIcon />}
              label={online ? 'Mentett adatok – a szerver nem fut' : 'Offline – mentett adatok'}
            />
          )}

          {/* the only thing that moves without you: a nudge that the list is worth reloading */}
          {pending && (
            <Chip
              size="small"
              color="info"
              clickable
              icon={<NotificationsActiveIcon />}
              onClick={() => void load()}
              label={added > 0 ? `${added} új tétel · Frissítés` : 'Változott · Frissítés'}
            />
          )}

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

          {/* asked once: after that the browser remembers the answer and the button is gone */}
          {askNotifications && (
            <Tooltip title="Értesítés, ha új tétel érkezik, amíg máshol jársz">
              <Button
                startIcon={<NotificationsNoneIcon />}
                onClick={askNotifications}
                sx={board ? ON_CORK : undefined}
              >
                Értesítés
              </Button>
            </Tooltip>
          )}

          {/* only shown while the browser considers the app installable — gone once it is installed */}
          {install && (
            <Button
              startIcon={<InstallDesktopIcon />}
              onClick={() => void install()}
              sx={board ? ON_CORK : undefined}
            >
              Telepítés
            </Button>
          )}
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
            repos={repoOptions}
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
          <EmptyState board={board} searching={query !== ''} />
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

      {renaming && (
        <RepoRenameDialog
          repo={renaming}
          repos={repoOptions}
          onCancel={() => setRenaming(null)}
          onSubmit={(name) => void renameRepo(renaming, name)}
        />
      )}

      {/* bottom-left, so it never lands on top of the update prompt */}
      <Snackbar
        open={notice !== null}
        autoHideDuration={2500}
        onClose={() => setNotice(null)}
        message={notice ?? ''}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      />
    </Container>
  );
}

/**
 * Renaming is also the merge tool: typing a name that already exists folds the two together, which
 * is the fix for an agent that spelled the folder differently once.
 */
function RepoRenameDialog({
  repo,
  repos,
  onCancel,
  onSubmit,
}: {
  repo: string;
  repos: string[];
  onCancel: () => void;
  onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState(repo);
  const trimmed = name.trim();
  const merging = trimmed !== repo && repos.includes(trimmed);

  return (
    <Dialog open fullWidth maxWidth="xs" onClose={onCancel}>
      <DialogTitle>Repo átnevezése</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>
          A(z) „{repo}" nevű repo minden todójára érvényes. Az agent ezután is a saját nevén veszi
          fel az újakat, azok külön repóként jelennek meg.
        </DialogContentText>
        <TextField
          autoFocus
          fullWidth
          size="small"
          label="Új név"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && trimmed) onSubmit(trimmed);
          }}
          helperText={merging ? `Összevonás a meglévő „${trimmed}" repóval.` : ' '}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>Mégse</Button>
        <Button variant="contained" disabled={!trimmed} onClick={() => onSubmit(trimmed)}>
          {merging ? 'Összevonás' : 'Átnevezés'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function EmptyState({ board, searching }: { board: boolean; searching: boolean }) {
  const text = searching ? (
    <>Nincs találat a keresésre.</>
  ) : (
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
      {searching ? (
        'Egy cetli sem illik a keresésre.'
      ) : (
        <>
          Üres a fal. Az agent az <code>add_todo</code> toollal tud ide tűzni egy cetlit.
        </>
      )}
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
