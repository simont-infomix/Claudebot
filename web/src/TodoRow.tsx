import { useState } from 'react';
import Accordion from '@mui/material/Accordion';
import AccordionDetails from '@mui/material/AccordionDetails';
import AccordionSummary from '@mui/material/AccordionSummary';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutlined';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import PushPinIcon from '@mui/icons-material/PushPin';
import PushPinOutlinedIcon from '@mui/icons-material/PushPinOutlined';
import * as api from './api';
import { CommentThread } from './CommentThread';
import { Markdown } from './Markdown';
import { RepoPicker } from './RepoPicker';
import { formatAbsolute, formatRelative } from './format';
import { copyTicketPrompt } from './prompt';
import { STATUS_COLORS, STATUS_LABELS, STATUSES, type Status, type Todo, type TodoListItem } from './types';

type Props = {
  todo: TodoListItem;
  /** Repo names already in use, offered while editing. */
  repoOptions: string[];
  onChange: (todo: Todo) => void;
  onDelete: (id: number) => void;
  onCommentCountChange: (id: number, delta: number) => void;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
};

export function TodoRow({
  todo,
  repoOptions,
  onChange,
  onDelete,
  onCommentCountChange,
  onNotice,
  onError,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [reposDraft, setReposDraft] = useState(todo.repos);
  const [titleDraft, setTitleDraft] = useState(todo.title);
  const [descriptionDraft, setDescriptionDraft] = useState(todo.description);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

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
    setReposDraft(todo.repos);
    setTitleDraft(todo.title);
    setDescriptionDraft(todo.description);
    setEditing(true);
  };

  const saveEdit = () => {
    const title = titleDraft.trim();
    if (!title || reposDraft.length === 0) return;
    void run(async () => {
      onChange(
        await api.updateTodo(todo.id, {
          repos: reposDraft,
          title,
          description: descriptionDraft,
        }),
      );
      setEditing(false);
    });
  };

  const remove = () => {
    void run(async () => {
      await api.deleteTodo(todo.id);
      setConfirmDelete(false);
      onDelete(todo.id);
    });
  };

  return (
    <Accordion
      expanded={expanded}
      onChange={(_event, isExpanded) => setExpanded(isExpanded)}
      slotProps={{ transition: { unmountOnExit: true } }}
      sx={{ opacity: todo.status === 'closed' ? 0.7 : 1 }}
    >
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1}
          sx={{ width: '100%', pr: 1, alignItems: { xs: 'flex-start', sm: 'center' } }}
        >
          <Typography variant="body2" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>
            #{todo.id}
          </Typography>
          <Typography
            sx={{
              flexGrow: 1,
              minWidth: 0,
              textDecoration: todo.status === 'closed' ? 'line-through' : 'none',
            }}
          >
            {todo.title}
          </Typography>
          {/* several repo chips can be on one row, so let them wrap instead of squeezing the title */}
          <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
            {todo.repos.map((repo) => (
              <Chip key={repo} label={repo} size="small" variant="outlined" />
            ))}
            <Chip
              label={STATUS_LABELS[todo.status]}
              size="small"
              color={STATUS_COLORS[todo.status]}
            />
            {todo.comment_count > 0 && (
              <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', color: 'text.secondary' }}>
                <ChatBubbleOutlineIcon sx={{ fontSize: 14 }} />
                <Typography variant="caption">{todo.comment_count}</Typography>
              </Stack>
            )}
            <Tooltip title={`Létrehozva: ${formatAbsolute(todo.created_at)}`}>
              <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
                {formatRelative(todo.updated_at)}
              </Typography>
            </Tooltip>
            {/* the summary is a div[role=button], so these nested buttons only need to not bubble */}
            <Tooltip title="Prompt másolása az agentnek">
              <IconButton
                size="small"
                aria-label="Prompt másolása az agentnek"
                onClick={(event) => {
                  event.stopPropagation();
                  void copyTicketPrompt(todo, onNotice, onError);
                }}
              >
                <ContentCopyIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title={todo.pinned ? 'Kitűzés levétele' : 'Kitűzés a lista tetejére'}>
              <IconButton
                size="small"
                aria-label={todo.pinned ? 'Kitűzés levétele' : 'Kitűzés'}
                disabled={busy}
                onClick={(event) => {
                  event.stopPropagation();
                  void run(async () =>
                    onChange(await api.updateTodo(todo.id, { pinned: !todo.pinned })),
                  );
                }}
              >
                {todo.pinned ? (
                  <PushPinIcon fontSize="small" color="warning" />
                ) : (
                  <PushPinOutlinedIcon fontSize="small" />
                )}
              </IconButton>
            </Tooltip>
          </Stack>
        </Stack>
      </AccordionSummary>

      <AccordionDetails>
        <Stack spacing={2}>
          {editing ? (
            <Stack spacing={1}>
              <RepoPicker
                value={reposDraft}
                options={repoOptions}
                onChange={setReposDraft}
                disabled={busy}
                helperText="Egy todo több repóhoz is tartozhat"
              />
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
                  disabled={busy || !titleDraft.trim() || reposDraft.length === 0}
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
            onCountChange={(delta) => onCommentCountChange(todo.id, delta)}
            onError={onError}
          />
        </Stack>
      </AccordionDetails>

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
    </Accordion>
  );
}
