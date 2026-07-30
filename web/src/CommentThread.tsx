import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import SendIcon from '@mui/icons-material/Send';
import * as api from './api';
import type { Comment } from './types';
import { formatAbsolute, formatRelative } from './format';
import { Markdown } from './Markdown';

type Props = {
  todoId: number;
  /** True when the thread sits on the post-it board's paper sheet: entries become paper slips. */
  onSheet?: boolean;
  onCountChange: (delta: number) => void;
  onError: (message: string) => void;
};

export function CommentThread({ todoId, onSheet = false, onCountChange, onError }: Props) {
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    api
      .fetchComments(todoId)
      .then((loaded) => {
        if (active) setComments(loaded);
      })
      .catch((error: Error) => {
        if (active) {
          setComments([]);
          onError(error.message);
        }
      });
    return () => {
      active = false;
    };
    // onError is stable enough for this small app; reloading on identity changes would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todoId]);

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

  const submit = () => {
    const body = draft.trim();
    if (!body) return;
    void run(async () => {
      const created = await api.createComment(todoId, body);
      setComments((current) => [...(current ?? []), created]);
      setDraft('');
      onCountChange(1);
    });
  };

  const saveEdit = (id: number) => {
    const body = editDraft.trim();
    if (!body) return;
    void run(async () => {
      const updated = await api.updateComment(id, body);
      setComments((current) => (current ?? []).map((c) => (c.id === id ? updated : c)));
      setEditingId(null);
    });
  };

  const remove = (id: number) => {
    void run(async () => {
      await api.deleteComment(id);
      setComments((current) => (current ?? []).filter((c) => c.id !== id));
      onCountChange(-1);
    });
  };

  if (comments === null) {
    return (
      <Box sx={{ py: 2, display: 'flex', justifyContent: 'center' }}>
        <CircularProgress size={20} />
      </Box>
    );
  }

  return (
    <Stack spacing={1.5}>
      <Divider textAlign="left">
        <Typography variant="overline" color="text.secondary">
          Bejegyzések ({comments.length})
        </Typography>
      </Divider>

      {comments.length === 0 && (
        <Typography variant="body2" color="text.secondary">
          Még nincs bejegyzés. Ide írhatod, hol áll a dolog, vagy mit döntöttél.
        </Typography>
      )}

      {comments.map((comment) => (
        <Paper
          key={comment.id}
          variant="outlined"
          sx={(theme) => ({
            p: 1.5,
            ...(onSheet && {
              backgroundColor: 'rgba(255,255,255,0.55)',
              ...theme.applyStyles('dark', { backgroundColor: 'rgba(255,255,255,0.05)' }),
            }),
          })}
        >
          {editingId === comment.id ? (
            <Stack spacing={1}>
              <TextField
                multiline
                minRows={2}
                fullWidth
                size="small"
                value={editDraft}
                onChange={(event) => setEditDraft(event.target.value)}
              />
              <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
                <Button size="small" onClick={() => setEditingId(null)}>
                  Mégse
                </Button>
                <Button
                  size="small"
                  variant="contained"
                  disabled={busy || !editDraft.trim()}
                  onClick={() => saveEdit(comment.id)}
                >
                  Mentés
                </Button>
              </Stack>
            </Stack>
          ) : (
            <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
              <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                <Markdown>{comment.body}</Markdown>
                <Tooltip title={formatAbsolute(comment.created_at)} placement="right">
                  <Typography variant="caption" color="text.secondary">
                    {formatRelative(comment.created_at)}
                    {comment.updated_at !== comment.created_at ? ' · szerkesztve' : ''}
                  </Typography>
                </Tooltip>
              </Box>
              <Stack direction="row">
                <IconButton
                  size="small"
                  aria-label="Bejegyzés szerkesztése"
                  onClick={() => {
                    setEditingId(comment.id);
                    setEditDraft(comment.body);
                  }}
                >
                  <EditOutlinedIcon fontSize="small" />
                </IconButton>
                <IconButton
                  size="small"
                  aria-label="Bejegyzés törlése"
                  disabled={busy}
                  onClick={() => remove(comment.id)}
                >
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </Stack>
            </Stack>
          )}
        </Paper>
      ))}

      <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-end' }}>
        <TextField
          multiline
          minRows={2}
          fullWidth
          size="small"
          placeholder="Új bejegyzés (Ctrl+Enter a küldéshez)"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              submit();
            }
          }}
        />
        <Button
          variant="contained"
          startIcon={<SendIcon />}
          disabled={busy || !draft.trim()}
          onClick={submit}
        >
          Küldés
        </Button>
      </Stack>
    </Stack>
  );
}
