import { useState, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutlined';
import CheckIcon from '@mui/icons-material/Check';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PushPinIcon from '@mui/icons-material/PushPin';
import PushPinOutlinedIcon from '@mui/icons-material/PushPinOutlined';
import ReplayIcon from '@mui/icons-material/Replay';
import * as api from './api';
import { TodoDetailDialog } from './TodoDetailDialog';
import { formatAbsolute, formatRelative, plainPreview } from './format';
import { copyTicketPrompt } from './prompt';
import {
  HAND_FONT,
  INK,
  INK_SOFT,
  NOTE_PAPER,
  PAPER_TEXTURE,
  PINNED_PIN,
  ageOverlay,
  ageStain,
  noteTilt,
  pinColor,
} from './board';
import { STATUS_LABELS, type Status, type Todo, type TodoListItem } from './types';

type Props = {
  todo: TodoListItem;
  /** Repo names already in use, offered while editing in the dialog. */
  repoOptions: string[];
  onChange: (todo: Todo) => void;
  onDelete: (id: number) => void;
  onCommentCountChange: (id: number, delta: number) => void;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
};

/** One sticky note on the wall. Clicking it opens the full item in a dialog. */
export function TodoNote({
  todo,
  repoOptions,
  onChange,
  onDelete,
  onCommentCountChange,
  onNotice,
  onError,
}: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const paper = NOTE_PAPER[todo.status];
  const tilt = noteTilt(todo.id);
  const closed = todo.status === 'closed';
  const preview = plainPreview(todo.description);
  // A finished note is not neglected, however long ago it was finished.
  const stain = closed ? 0 : ageStain(todo.updated_at);

  const run = (action: () => Promise<Todo>) => {
    setBusy(true);
    action()
      .then(onChange)
      .catch((error: unknown) => onError((error as Error).message))
      .finally(() => setBusy(false));
  };

  const setStatus = (status: Status) => run(() => api.updateTodo(todo.id, { status }));

  return (
    <>
      <Box
        role="button"
        tabIndex={0}
        aria-label={`#${todo.id} ${todo.title}`}
        onClick={() => setOpen(true)}
        onKeyDown={(event) => {
          // Only the note itself opens; Enter/Space on one of its action buttons is that button's.
          if (event.target !== event.currentTarget) return;
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setOpen(true);
          }
        }}
        sx={(theme) => ({
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 208,
          px: 2,
          pt: 3,
          pb: 1.5,
          cursor: 'pointer',
          color: INK,
          opacity: closed ? 0.82 : 1,
          backgroundColor: paper.light,
          backgroundImage: `${PAPER_TEXTURE}, linear-gradient(160deg, rgba(255,255,255,0.5), rgba(0,0,0,0.06))`,
          backgroundBlendMode: 'multiply, normal',
          boxShadow: todo.pinned
            ? '0 2px 3px rgba(0,0,0,0.32), 0 20px 26px -14px rgba(0,0,0,0.7)'
            : '0 1px 2px rgba(0,0,0,0.28), 0 14px 20px -14px rgba(0,0,0,0.6)',
          transform: `rotate(${tilt}deg)`,
          transition: theme.transitions.create(['transform', 'box-shadow'], { duration: 180 }),
          '&:hover, &:focus-visible': {
            transform: 'rotate(0deg) translateY(-4px) scale(1.03)',
            boxShadow: '0 2px 4px rgba(0,0,0,0.3), 0 22px 30px -16px rgba(0,0,0,0.65)',
            zIndex: 2,
          },
          '&:focus-visible': { outline: `2px solid ${INK}`, outlineOffset: 3 },
          // the actions stay out of the way until you reach for the note
          '& .note-actions': { opacity: 0, transition: theme.transitions.create('opacity') },
          '&:hover .note-actions, &:focus-within .note-actions': { opacity: 1 },
          // ...except where there is no hover to reach with
          '@media (hover: none)': { '& .note-actions': { opacity: 1 } },
          // paper yellowing with neglect
          '&::before': ageOverlay(stain),
          // dog-eared bottom-right corner, curling further as the note ages
          '&::after': {
            content: '""',
            position: 'absolute',
            right: 0,
            bottom: 0,
            width: 26 + stain * 40,
            height: 26 + stain * 40,
            background:
              'linear-gradient(315deg, rgba(0,0,0,0.16) 0 50%, rgba(255,255,255,0.35) 50%)',
          },
          ...theme.applyStyles('dark', { backgroundColor: paper.dark }),
        })}
      >
        {/* pushpin */}
        <Box
          aria-hidden
          sx={{
            position: 'absolute',
            top: todo.pinned ? -9 : -7,
            left: '50%',
            width: todo.pinned ? 19 : 15,
            height: todo.pinned ? 19 : 15,
            ml: todo.pinned ? '-9.5px' : '-7.5px',
            borderRadius: '50%',
            background: `radial-gradient(circle at 35% 30%, #fff 0 2px, ${
              todo.pinned ? PINNED_PIN : pinColor(todo.id)
            } 3px 100%)`,
            boxShadow: todo.pinned
              ? `0 2px 4px rgba(0,0,0,0.5), 0 0 0 3px rgba(184,134,11,0.28)`
              : '0 2px 3px rgba(0,0,0,0.45)',
          }}
        />

        <Stack
          className="note-actions"
          direction="row"
          sx={{ position: 'absolute', top: 4, right: 4, zIndex: 1 }}
        >
          <NoteAction title="Prompt másolása" disabled={busy}
            onClick={() => void copyTicketPrompt(todo, onNotice, onError)}
          >
            <ContentCopyIcon sx={{ fontSize: 15 }} />
          </NoteAction>
          <NoteAction
            title={todo.pinned ? 'Kitűzés levétele' : 'Kitűzés'}
            disabled={busy}
            onClick={() => run(() => api.updateTodo(todo.id, { pinned: !todo.pinned }))}
          >
            {todo.pinned ? (
              <PushPinIcon sx={{ fontSize: 15 }} />
            ) : (
              <PushPinOutlinedIcon sx={{ fontSize: 15 }} />
            )}
          </NoteAction>
          {todo.status !== 'in_progress' && (
            <NoteAction title="Folyamatban" disabled={busy} onClick={() => setStatus('in_progress')}>
              <PlayArrowIcon sx={{ fontSize: 16 }} />
            </NoteAction>
          )}
          {closed ? (
            <NoteAction title="Újranyitás" disabled={busy} onClick={() => setStatus('open')}>
              <ReplayIcon sx={{ fontSize: 15 }} />
            </NoteAction>
          ) : (
            <NoteAction title="Lezárás" disabled={busy} onClick={() => setStatus('closed')}>
              <CheckIcon sx={{ fontSize: 16 }} />
            </NoteAction>
          )}
        </Stack>

        <Stack
          direction="row"
          spacing={1}
          sx={{ alignItems: 'baseline', justifyContent: 'space-between', mb: 0.5 }}
        >
          <Typography
            variant="caption"
            sx={{ color: INK_SOFT, fontVariantNumeric: 'tabular-nums' }}
          >
            #{todo.id}
          </Typography>
          {/* the whole list only fits on the widest notes, so the full one lives in the tooltip */}
          <Tooltip title={todo.repos.length > 1 ? todo.repos.join(', ') : ''}>
            <Typography
              variant="caption"
              sx={{
                color: INK_SOFT,
                maxWidth: '70%',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
              }}
            >
              {todo.repos[0]}
              {todo.repos.length > 1 ? ` +${todo.repos.length - 1}` : ''}
            </Typography>
          </Tooltip>
        </Stack>

        <Typography
          sx={{
            fontFamily: HAND_FONT,
            fontSize: '1.05rem',
            lineHeight: 1.35,
            fontWeight: 600,
            textDecoration: closed ? 'line-through' : 'none',
            display: '-webkit-box',
            WebkitBoxOrient: 'vertical',
            WebkitLineClamp: 4,
            overflow: 'hidden',
          }}
        >
          {todo.title}
        </Typography>

        {preview && (
          <Typography
            sx={{
              mt: 1,
              fontFamily: HAND_FONT,
              fontSize: '0.82rem',
              lineHeight: 1.4,
              color: INK_SOFT,
              display: '-webkit-box',
              WebkitBoxOrient: 'vertical',
              WebkitLineClamp: 3,
              overflow: 'hidden',
            }}
          >
            {preview}
          </Typography>
        )}

        <Box sx={{ flexGrow: 1, minHeight: 8 }} />

        <Stack
          direction="row"
          spacing={1}
          sx={{ alignItems: 'center', justifyContent: 'space-between', pr: 2.5 }}
        >
          <Box
            component="span"
            sx={{
              px: 0.75,
              py: 0.125,
              fontSize: '0.68rem',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              border: '1px solid',
              borderColor: 'rgba(51,48,31,0.35)',
              borderRadius: 0.5,
              color: INK_SOFT,
            }}
          >
            {STATUS_LABELS[todo.status]}
          </Box>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', color: INK_SOFT }}>
            {todo.comment_count > 0 && (
              <Stack direction="row" spacing={0.25} sx={{ alignItems: 'center' }}>
                <ChatBubbleOutlineIcon sx={{ fontSize: 13 }} />
                <Typography variant="caption">{todo.comment_count}</Typography>
              </Stack>
            )}
            <Tooltip title={`Létrehozva: ${formatAbsolute(todo.created_at)}`}>
              <Typography variant="caption" sx={{ whiteSpace: 'nowrap' }}>
                {formatRelative(todo.updated_at)}
              </Typography>
            </Tooltip>
          </Stack>
        </Stack>
      </Box>

      <TodoDetailDialog
        open={open}
        todo={todo}
        repoOptions={repoOptions}
        onClose={() => setOpen(false)}
        onChange={onChange}
        onDelete={onDelete}
        onCommentCountChange={onCommentCountChange}
        onNotice={onNotice}
        onError={onError}
      />
    </>
  );
}

/** A note's corner button: small, inky, and careful not to open the note it sits on. */
function NoteAction({
  title,
  disabled,
  onClick,
  children,
}: {
  title: string;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip title={title}>
      <span>
        <IconButton
          size="small"
          aria-label={title}
          disabled={disabled}
          onClick={(event) => {
            event.stopPropagation();
            onClick();
          }}
          sx={{
            p: 0.375,
            color: INK_SOFT,
            '&:hover': { color: INK, backgroundColor: 'rgba(255,255,255,0.55)' },
          }}
        >
          {children}
        </IconButton>
      </span>
    </Tooltip>
  );
}
