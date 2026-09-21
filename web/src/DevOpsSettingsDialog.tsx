import { useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import LinearProgress from '@mui/material/LinearProgress';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import * as api from './api';
import type { DevOpsSettings } from './types';

type Props = {
  settings: DevOpsSettings;
  onClose: () => void;
  onSaved: (settings: DevOpsSettings) => void;
};

/**
 * The Azure DevOps connection panel. Two halves with a deliberate order between them:
 *
 * 1. organization + token, saved first — every lookup below needs them on the server side;
 * 2. the two state names, picked from what DevOps itself reports as valid.
 *
 * The state names are defined per work item type inside a project, so a project and a type have to
 * be chosen here as a *reference* for the lists. Neither is stored: a work item id is unique across
 * the whole organization, so nothing else in this feature needs to know which project it is in.
 */
export function DevOpsSettingsDialog({ settings, onClose, onSaved }: Props) {
  const [org, setOrg] = useState(settings.org);
  /** Empty means "leave the stored token alone" once one exists. */
  const [pat, setPat] = useState('');
  const [clearPat, setClearPat] = useState(false);
  const [stateInProgress, setStateInProgress] = useState(settings.stateInProgress);
  const [stateClosed, setStateClosed] = useState(settings.stateClosed);
  const [hasPat, setHasPat] = useState(settings.hasPat);

  const [projects, setProjects] = useState<string[] | null>(null);
  const [project, setProject] = useState('');
  const [types, setTypes] = useState<string[]>([]);
  const [type, setType] = useState('');
  const [states, setStates] = useState<string[]>([]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /** The token is the one field the server will not give back, so it is never pre-filled. */
  const patToSend = clearPat ? '' : pat.trim() || undefined;
  const canConnect = org.trim() !== '' && (hasPat || pat.trim() !== '');

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /**
   * Save what we have, then ask DevOps what it knows. Saving first is not a convenience: the
   * lookups run server-side with the stored credentials, so the token has to be there already.
   */
  const connect = () =>
    void run(async () => {
      const saved = await api.saveDevOpsSettings({
        org: org.trim(),
        pat: patToSend,
        stateInProgress,
        stateClosed,
      });
      setHasPat(saved.hasPat);
      setPat('');
      setClearPat(false);
      onSaved(saved);

      const list = await api.fetchDevOpsProjects();
      setProjects(list);
      setNotice(`Kapcsolat rendben – ${list.length} projekt.`);
    });

  // A project choice only matters for the type list, and a type only for the state list.
  useEffect(() => {
    if (!project) {
      setTypes([]);
      setType('');
      return;
    }
    let live = true;
    api
      .fetchDevOpsTypes(project)
      .then((list) => live && setTypes(list))
      .catch((caught: unknown) => live && setError((caught as Error).message));
    return () => {
      live = false;
    };
  }, [project]);

  useEffect(() => {
    if (!project || !type) {
      setStates([]);
      return;
    }
    let live = true;
    api
      .fetchDevOpsStates(project, type)
      .then((list) => live && setStates(list))
      .catch((caught: unknown) => live && setError((caught as Error).message));
    return () => {
      live = false;
    };
  }, [project, type]);

  const save = () =>
    void run(async () => {
      const saved = await api.saveDevOpsSettings({
        org: org.trim(),
        pat: patToSend,
        stateInProgress,
        stateClosed,
      });
      onSaved(saved);
      onClose();
    });

  return (
    <Dialog open fullWidth maxWidth="sm" onClose={onClose}>
      <DialogTitle>Azure DevOps kapcsolat</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <DialogContentText variant="body2">
            A lezárt todók a DevOps-ban a megadott „megoldva", a folyamatban lévők a „folyamatban"
            állapotba kerülnek. A nyitott állapot sosem ír a DevOps-ba.
          </DialogContentText>

          <TextField
            size="small"
            fullWidth
            label="Organization"
            placeholder="pl. hphdigital"
            value={org}
            onChange={(event) => setOrg(event.target.value)}
            helperText="A dev.azure.com/<organization> névrész. Projektet nem kell megadni."
          />

          <TextField
            size="small"
            fullWidth
            type="password"
            label={hasPat ? 'Új hozzáférési token (PAT)' : 'Hozzáférési token (PAT)'}
            value={pat}
            onChange={(event) => {
              setPat(event.target.value);
              setClearPat(false);
            }}
            helperText={
              hasPat
                ? 'Van elmentett token. Üresen hagyva marad a régi.'
                : 'Work Items olvasás + írás jogosultság elég.'
            }
          />

          {hasPat && (
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <Button size="small" color="error" onClick={() => setClearPat(true)} disabled={clearPat}>
                Token törlése
              </Button>
              {clearPat && (
                <Typography variant="caption" color="error">
                  Mentéskor törlődik, és a DevOps funkciók eltűnnek.
                </Typography>
              )}
            </Stack>
          )}

          <Button variant="outlined" onClick={connect} disabled={busy || !canConnect}>
            Mentés és kapcsolódás
          </Button>

          {busy && <LinearProgress />}
          {error && <Alert severity="error">{error}</Alert>}
          {notice && !error && <Alert severity="success">{notice}</Alert>}

          <Divider />

          <Typography variant="subtitle2">Állapotok megfeleltetése</Typography>
          <DialogContentText variant="body2">
            Az érvényes állapotnevek munkaelem-típusonként térnek el, ezért válassz egy projektet és
            egy típust mintának. Ezt a kettőt nem tároljuk – csak a kiválasztott két állapotnevet.
          </DialogContentText>

          {projects === null ? (
            <Typography variant="body2" color="text.secondary">
              A listákhoz előbb kapcsolódj a fenti gombbal.
            </Typography>
          ) : (
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <FormControl size="small" fullWidth>
                <InputLabel id="devops-project-label">Minta projekt</InputLabel>
                <Select
                  labelId="devops-project-label"
                  label="Minta projekt"
                  value={project}
                  onChange={(event) => setProject(event.target.value)}
                >
                  {projects.map((name) => (
                    <MenuItem key={name} value={name}>
                      {name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              <FormControl size="small" fullWidth disabled={types.length === 0}>
                <InputLabel id="devops-type-label">Minta típus</InputLabel>
                <Select
                  labelId="devops-type-label"
                  label="Minta típus"
                  value={type}
                  onChange={(event) => setType(event.target.value)}
                >
                  {types.map((name) => (
                    <MenuItem key={name} value={name}>
                      {name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Stack>
          )}

          {/* Free text as a fallback: a state name typed by hand still works, it just cannot be
              checked before the first push. The dropdown fills the same field. */}
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <StateField
              label={'„Folyamatban” állapot'}
              value={stateInProgress}
              states={states}
              onChange={setStateInProgress}
            />
            <StateField
              label={'„Megoldva” állapot'}
              value={stateClosed}
              states={states}
              onChange={setStateClosed}
            />
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Mégse</Button>
        <Button variant="contained" onClick={save} disabled={busy}>
          Mentés
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/**
 * One state name. A dropdown once DevOps has told us the valid names, a plain text field before
 * that — so the panel is usable even if the lookups fail, at the cost of a typo only surfacing on
 * the first push.
 */
function StateField({
  label,
  value,
  states,
  onChange,
}: {
  label: string;
  value: string;
  states: string[];
  onChange: (value: string) => void;
}) {
  if (states.length === 0) {
    return (
      <TextField
        size="small"
        fullWidth
        label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }

  // A name saved earlier may not be in this reference type's list; keep it selectable anyway.
  const options = states.includes(value) || value === '' ? states : [value, ...states];

  return (
    <FormControl size="small" fullWidth>
      <InputLabel id={`state-${label}`}>{label}</InputLabel>
      <Select
        labelId={`state-${label}`}
        label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <MenuItem value="">
          <em>Nincs (ne írjon DevOps-ba)</em>
        </MenuItem>
        {options.map((name) => (
          <MenuItem key={name} value={name}>
            {name}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}
