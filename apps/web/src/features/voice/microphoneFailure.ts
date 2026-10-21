export function microphoneFailure(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return 'Microphone access is blocked. Allow it in your browser and system privacy settings, then try again.';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'No microphone was found. Connect one or select another input in audio settings.';
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return 'Microphone capture failed. Check your system input settings, close other apps using the microphone, then try again.';
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return 'The microphone settings could not be applied. Select another input or turn off noise suppression, then try again.';
    default:
      return 'Microphone unavailable. Check your input in audio settings and try again.';
  }
}
