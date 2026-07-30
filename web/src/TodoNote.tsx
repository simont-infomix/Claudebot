import { useState } from 'react';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutlined';
import { TodoDetailDialog } from './TodoDetailDialog';
import { formatAbsolute, formatRelative, plainPreview } from './format';
import {
  HAND_FONT,
  INK,
  INK_SOFT,
  NOTE_PAPER,
  PAPER_TEXTURE,
  noteTilt,
  pinColor,
} from './board';
import { STATUS_LABELS, type Todo, type TodoListItem } from './types';

type Props = {
  todo: TodoListItem;
  onChange: (todo: Todo) => void;
  onDelete: (id: number) => void;
  onCommentCountChange: (id: number, delta: number) => void;
  onError: (message: string) => void;
};

/** One sticky note on the wall. Clicking it opens the full item in a dialog. */
export function TodoNote({ todo, onChange, onDelete, onCommentCountChange, onError }: Props) {
  const [open, setOpen] = useState(false);

  const paper = NOTE_PAPER[todo.status];
  const tilt = noteTilt(todo.id);
  const pin = pinColor(todo.id);
  const closed = todo.status === 'closed';
  const preview = plainPreview(todo.description);

  return (
    <>
      <Box
        role="button"
        tabIndex={0}
        aria-label={`#${todo.id} ${todo.title}`}
        onClick={() => setOpen(true)}
        onKeyDown={(event) => {
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
          boxShadow:
            '0 1px 2px rgba(0,0,0,0.28), 0 14px 20px -14px rgba(0,0,0,0.6)',
          transform: `rotate(${tilt}deg)`,
          transition: theme.transitions.create(['transform', 'box-shadow'], { duration: 180 }),
          '&:hover, &:focus-visible': {
            transform: 'rotate(0deg) translateY(-4px) scale(1.03)',
            boxShadow: '0 2px 4px rgba(0,0,0,0.3), 0 22px 30px -16px rgba(0,0,0,0.65)',
            zIndex: 2,
          },
          '&:focus-visible': { outline: `2px solid ${INK}`, outlineOffset: 3 },
          // dog-eared bottom-right corner
          '&::after': {
            content: '""',
            position: 'absolute',
            right: 0,
            bottom: 0,
            width: 26,
            height: 26,
            background:
              'linear-gradient(315deg, rgba(0,0,0,0.16) 0 13px, rgba(255,255,255,0.35) 13px)',
          },
          ...theme.applyStyles('dark', { backgroundColor: paper.dark }),
        })}
      >
        {/* pushpin */}
        <Box
          aria-hidden
          sx={{
            position: 'absolute',
            top: -7,
            left: '50%',
            width: 15,
            height: 15,
            ml: '-7.5px',
            borderRadius: '50%',
            background: `radial-gradient(circle at 35% 30%, #fff 0 2px, ${pin} 3px 100%)`,
            boxShadow: '0 2px 3px rgba(0,0,0,0.45)',
          }}
        />

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
            {todo.repo}
          </Typography>
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
        onClose={() => setOpen(false)}
        onChange={onChange}
        onDelete={onDelete}
        onCommentCountChange={onCommentCountChange}
        onError={onError}
      />
    </>
  );
}
