import Autocomplete from '@mui/material/Autocomplete';
import TextField from '@mui/material/TextField';

type Props = {
  value: string[];
  /** Repo names already in use — suggestions only, anything can be typed in. */
  options: string[];
  onChange: (repos: string[]) => void;
  helperText?: string;
  disabled?: boolean;
};

/** Trimmed, de-duplicated, order preserved — mirrors `normaliseRepos` on the server. */
function normalise(repos: string[]): string[] {
  const result: string[] = [];
  for (const repo of repos) {
    const trimmed = repo.trim();
    if (trimmed !== '' && !result.includes(trimmed)) result.push(trimmed);
  }
  return result;
}

/**
 * The one control for "which repos does this belong to". Free-solo on purpose: a todo can be
 * pinned to a project that has no items yet, and the agent's spelling is the one to match.
 */
export function RepoPicker({ value, options, onChange, helperText, disabled }: Props) {
  return (
    <Autocomplete
      multiple
      freeSolo
      disableClearable
      size="small"
      options={options}
      value={value}
      disabled={disabled}
      onChange={(_event, next) => onChange(normalise(next as string[]))}
      sx={{ minWidth: 220 }}
      renderInput={(params) => (
        <TextField {...params} label="Repo(k)" size="small" helperText={helperText} />
      )}
    />
  );
}
