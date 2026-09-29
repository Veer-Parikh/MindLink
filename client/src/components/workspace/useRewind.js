import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "../../lib/api.js";

export const SPEEDS = [
  { label: "1×", ms: 1000 },
  { label: "2×", ms: 500 },
  { label: "4×", ms: 220 },
];

/**
 * Rewind: browse the project's snapshot timeline.
 * Snapshots are listed once, then their file contents are fetched lazily (and prefetched around the playhead).
 */
export function useRewind(projectId, room) {
  const [timeline, setTimeline] = useState(null); // summaries, oldest → newest
  const [active, setActive] = useState(false);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(0);
  const [compare, setCompare] = useState(false);
  const [, setCacheVersion] = useState(0);
  const cache = useRef(new Map());
  const inflight = useRef(new Map());

  const loadTimeline = useCallback(async () => {
    const { snapshots } = await api(`/projects/${projectId}/timeline`);
    setTimeline(snapshots);
    return snapshots;
  }, [projectId]);

  const fetchSnapshot = useCallback(
    (id) => {
      if (cache.current.has(id)) return Promise.resolve(cache.current.get(id));
      if (inflight.current.has(id)) return inflight.current.get(id);
      const p = api(`/projects/${projectId}/snapshots/${id}`)
        .then(({ snapshot }) => {
          cache.current.set(id, snapshot);
          inflight.current.delete(id);
          setCacheVersion((v) => v + 1);
          return snapshot;
        })
        .catch((err) => {
          inflight.current.delete(id);
          throw err;
        });
      inflight.current.set(id, p);
      return p;
    },
    [projectId],
  );

  // Keep the list fresh as the server announces new snapshots.
  useEffect(() => {
    if (!room) return undefined;
    return room.onEvent((event) => {
      if (event.type === "snapshot") {
        setTimeline((list) => (list && !list.some((s) => s.id === event.snapshot.id) ? [...list, event.snapshot] : list));
      }
    });
  }, [room]);

  const enter = useCallback(
    async ({ snapshotId, autoplay = false } = {}) => {
      try {
        const list = await loadTimeline();
        if (!list.length) {
          toast("Nothing on the timeline yet — start typing!");
          return;
        }
        let i = list.length - 1;
        if (snapshotId != null) {
          const found = list.findIndex((s) => s.id === snapshotId);
          if (found !== -1) i = found;
        }
        setIndex(i);
        setCompare(false);
        setActive(true);
        setPlaying(autoplay);
      } catch (err) {
        toast.error(err.message);
      }
    },
    [loadTimeline],
  );

  const exit = useCallback(() => {
    setActive(false);
    setPlaying(false);
    setCompare(false);
  }, []);

  const current = active && timeline ? timeline[Math.min(index, timeline.length - 1)] : null;
  const previous = active && timeline && index > 0 ? timeline[index - 1] : null;

  // Fetch the snapshot under the playhead plus a few neighbours.
  useEffect(() => {
    if (!active || !timeline) return;
    const ids = [index, index - 1, index + 1, index + 2, index + 3]
      .filter((i) => i >= 0 && i < timeline.length)
      .map((i) => timeline[i].id);
    ids.forEach((id) => fetchSnapshot(id).catch(() => {}));
  }, [active, index, timeline, fetchSnapshot]);

  // Playback
  useEffect(() => {
    if (!playing || !active || !timeline) return undefined;
    const t = setTimeout(() => {
      const nextId = timeline[index + 1]?.id;
      if (index >= timeline.length - 1) {
        setPlaying(false);
        return;
      }
      // Don't outrun the network: wait for the next snapshot to arrive.
      if (nextId != null && !cache.current.has(nextId)) {
        fetchSnapshot(nextId)
          .then(() => setIndex((i) => i + 1))
          .catch(() => setPlaying(false));
        return;
      }
      setIndex((i) => i + 1);
    }, SPEEDS[speed].ms);
    return () => clearTimeout(t);
  }, [playing, active, timeline, index, speed, fetchSnapshot]);

  return {
    active,
    timeline: timeline ?? [],
    index,
    setIndex: (i) => {
      setPlaying(false);
      setIndex(Math.max(0, Math.min(i, (timeline?.length ?? 1) - 1)));
    },
    playing,
    setPlaying,
    speed,
    cycleSpeed: () => setSpeed((s) => (s + 1) % SPEEDS.length),
    compare,
    setCompare,
    current,
    currentFull: current ? (cache.current.get(current.id) ?? null) : null,
    previousFull: previous ? (cache.current.get(previous.id) ?? null) : null,
    enter,
    exit,
    loadTimeline,
    fetchSnapshot,
  };
}
