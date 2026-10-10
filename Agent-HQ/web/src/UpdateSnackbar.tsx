import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Snackbar from '@mui/material/Snackbar';
import { useAppUpdate } from './pwa';

/**
 * Registers the service worker and, when a newer build is waiting, offers to switch to it. Rendered
 * once next to `App` — the reload is never automatic, so it can't interrupt an edit in progress.
 */
export function UpdateSnackbar() {
  const applyUpdate = useAppUpdate();

  return (
    <Snackbar open={applyUpdate !== null} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
      <Alert
        severity="info"
        variant="filled"
        action={
          <Button color="inherit" size="small" onClick={() => applyUpdate?.()}>
            Újratöltés
          </Button>
        }
      >
        Új verzió elérhető.
      </Alert>
    </Snackbar>
  );
}
