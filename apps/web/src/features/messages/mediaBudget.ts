// Bound decoded history media across channel, DM and focused-source panels.
const owners = new Map<symbol, () => void>();
export function releaseMedia(owner: symbol) { owners.delete(owner); }
export function claimMedia(owner: symbol, close: () => void) {
  owners.delete(owner);
  while (owners.size >= 6) { const [first, stop] = owners.entries().next().value!; owners.delete(first); stop(); }
  owners.set(owner, close);
}
