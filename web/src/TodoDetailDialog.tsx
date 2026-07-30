import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import CloseIcon from '@mui/icons-material/Close';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import * as api from './api';
import { CommentThread } from './CommentThread';
import { Markdown } from './Markdown';
import { HAND_FONT, NOTE_PAPER, PAPER_TEXTURE, SHEET } from './board';
import { formatAbsolute } from './format';
import { STATUS_LABELS, STATUSES, type Status, type Todo, type TodoListItem } from './types';

type Props = {
  open: boolean;
  todo: TodoListItem;
  onClose: () => void;
  onChange: (todo: Todo) => void;
  onDelete: (id: number) => void;
  onCommentCountChange: (id: number, delta: number) => void;
  onError: (message: string) => void;
};

/** The note taken off the wall: full description, status, edit, comments. */
export function TodoDetailDialog({
  open,
  todo,
  onClose,
  onChange,
  onDelete,
  onCommentCountChange,
  onError,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState(todo.title);
  const [descriptionDraft, setDescriptionDraft] = useState(todo.description);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  /** Drop a half-finished edit when the note goes back on the wall. */
  useEffect(() => {
    if (!open) setEditing(false);
  }, [open]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      onError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const changeStatus = (status: Status) => {
    if (status === todo.status) return;
    void run(async () => onChange(await api.updateTodo(todo.id, { status })));
  };

  const startEdit = () => {
    setTitleDraft(todo.title);
    setDescriptionDraft(todo.description);
    setEditing(true);
  };

  const saveEdit = () => {
    const title = titleDraft.trim();
    if (!title) return;
    void run(async () => {
      onChange(await api.updateTodo(todo.id, { title, description: descriptionDraft }));
      setEditing(false);
    });
  };

  const remove = () => {
    void run(async () => {
      await api.deleteTodo(todo.id);
      setConfirmDelete(false);
      onClose();
      onDelete(todo.id);
    });
  };

  const tape = NOTE_PAPER[todo.status];

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="md"
      slotProps={{
        paper: {
          sx: (theme) => ({
            backgroundColor: SHEET.light,
            backgroundImage: PAPER_TEXTURE,
            backgroundBlendMode: 'multiply',
            borderTop: '6px solid',
            borderTopColor: tape.light,
            boxShadow: '0 24px 48px -18px rgba(0,0,0,0.7)',
            ...theme.applyStyles('dark', {
              backgroundColor: SHEET.dark,
              borderTopColor: tape.dark,
            }),
          }),
        },
      }}
    >
      {/* component=div: the real heading is the handwritten title inside */}
      <DialogTitle component="div" sx={{ pb: 1 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
            <Typography variant="caption" color="text.secondary">
              #{todo.id} · {todo.repo} · {formatAbsolute(todo.created_at)}
            </Typography>
            <Typography
              component="h2"
              sx={{
                fontFamily: HAND_FONT,
                fontSize: '1.35rem',
                fontWeight: 600,
                lineHeight: 1.3,
                textDecoration: todo.status === 'closed' ? 'line-through' : 'none',
              }}
            >
              {todo.title}
            </Typography>
          </Box>
          <Tooltip title="Bezárás">
            <IconButton size="small" aria-label="Bezárás" onClick={onClose}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
      </DialogTitle>

      <DialogContent>
        <Stack spacing={2}>
          {editing ? (
            <Stack spacing={1}>
              <TextField
                label="Cím"
                size="small"
                fullWidth
                value={titleDraft}
                onChange={(event) => setTitleDraft(event.target.value)}
              />
              <TextField
                label="Leírás (markdown)"
                size="small"
                fullWidth
                multiline
                minRows={4}
                value={descriptionDraft}
                onChange={(event) => setDescriptionDraft(event.target.value)}
              />
              <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
                <Button size="small" onClick={() => setEditing(false)}>
                  Mégse
                </Button>
                <Button
                  size="small"
                  variant="contained"
                  disabled={busy || !titleDraft.trim()}
                  onClick={saveEdit}
                >
                  Mentés
                </Button>
              </Stack>
            </Stack>
          ) : (
            <Box>
              {todo.description.trim() ? (
                <Markdown>{todo.description}</Markdown>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  Nincs leírás.
                </Typography>
              )}
            </Box>
          )}

          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1}
            sx={{ justifyContent: 'space-between', alignItems: { xs: 'stretch', sm: 'center' } }}
          >
            <ToggleButtonGroup
              exclusive
              size="small"
              value={todo.status}
              onChange={(_event, value) => value && changeStatus(value as Status)}
              disabled={busy}
            >
              {STATUSES.map((status) => (
                <ToggleButton key={status} value={status}>
                  {STATUS_LABELS[status]}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>

            <Stack direction="row" spacing={1}>
              {!editing && (
                <Button size="small" startIcon={<EditOutlinedIcon />} onClick={startEdit}>
                  Szerkesztés
                </Button>
              )}
              <Button
                size="small"
                color="error"
                startIcon={<DeleteOutlineIcon />}
                onClick={() => setConfirmDelete(true)}
              >
                Törlés
              </Button>
            </Stack>
          </Stack>

          <CommentThread
            todoId={todo.id}
            onSheet
            onCountChange={(delta) => onCommentCountChange(todo.id, delta)}
            onError={onError}
          />
        </Stack>
      </DialogContent>

      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)}>
        <DialogTitle>Todo törlése</DialogTitle>
        <DialogContent>
          <DialogContentText>
            A(z) #{todo.id} „{todo.title}" todo és minden bejegyzése véglegesen törlődik. Nem
            visszavonható.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDelete(false)}>Mégse</Button>
          <Button color="error" variant="contained" disabled={busy} onClick={remove}>
            Törlés
          </Button>
        </DialogActions>
      </Dialog>
    </Dialog>
  );
}
