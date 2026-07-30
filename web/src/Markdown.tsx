import ReactMarkdown from 'react-markdown';
import Box from '@mui/material/Box';

/**
 * Renders agent-written text. No rehype-raw, so embedded HTML stays inert.
 */
export function Markdown({ children }: { children: string }) {
  return (
    <Box
      sx={{
        '& > :first-of-type': { mt: 0 },
        '& > :last-child': { mb: 0 },
        '& p, & ul, & ol, & pre, & blockquote': { my: 1 },
        '& ul, & ol': { pl: 3 },
        '& code': {
          fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
          fontSize: '0.875em',
          bgcolor: 'action.hover',
          px: 0.5,
          py: 0.125,
          borderRadius: 0.5,
        },
        '& pre': {
          bgcolor: 'action.hover',
          p: 1.5,
          borderRadius: 1,
          overflowX: 'auto',
          '& code': { bgcolor: 'transparent', p: 0 },
        },
        '& blockquote': {
          borderLeft: 3,
          borderColor: 'divider',
          pl: 1.5,
          ml: 0,
          color: 'text.secondary',
        },
        '& table': { borderCollapse: 'collapse', '& td, & th': { border: 1, borderColor: 'divider', px: 1 } },
        '& a': { color: 'primary.main' },
      }}
    >
      <ReactMarkdown>{children}</ReactMarkdown>
    </Box>
  );
}
