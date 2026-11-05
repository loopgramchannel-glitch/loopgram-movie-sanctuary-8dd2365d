// Small on-device store (localStorage) for viewer preferences.
import { useSyncExternalStore } from "react";

export type State = { lowData: boolean };
const KEY = "loopgram:v1";
const initial = (): State => ({ lowData: false });

let state: State = initial();
let loaded = false;
const subs = new Set<() => void>();
function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try { const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}"); state = { lowData: saved?.lowData === true }; } catch { /* ignore */ }
}
export function setState(fn: (s: State) => State) {
  load();
  state = fn(state);
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* quota */ }
  subs.forEach((f) => f());
}
const server = initial();
export function useStore<T>(sel: (s: State) => T): T {
  return useSyncExternalStore(
    (cb) => { subs.add(cb); return () => subs.delete(cb); },
    () => { load(); return sel(state); },
    () => sel(server),
  );
}
export const getState = () => { load(); return state; };
